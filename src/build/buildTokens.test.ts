import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, rmSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildTokens } from "./buildTokens.js";

let css: string;
let mixins: string;
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "tokens-build-"));
  const result = await buildTokens({
    cssOutDir: join(outDir, "css"),
    scssOutDir: join(outDir, "scss"),
  });
  css = readFileSync(result.cssPath, "utf-8");
  mixins = readFileSync(result.typographyMixinsPath, "utf-8");
}, 60_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

/**
 * Collect `--name: value` pairs from the emitted CSS.
 *
 * Some custom properties (e.g. `--radius-intensity`) are intentionally
 * redeclared per mode selector (`[data-radius-mode='pill']` etc.) as
 * overrides of the `:root` default. Since this helper has no notion of CSS
 * selector scoping, first occurrence (the `:root` default, which is always
 * emitted first) wins over later per-mode overrides.
 */
function vars(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const m of source.matchAll(/^\s*(--[\w-]+):\s*(.+?);/gm)) {
    if (!(m[1] in result)) result[m[1]] = m[2];
  }
  return result;
}

describe("emitted tokens.css unit contract", () => {
  it("emits no px values at all", () => {
    const offenders = [...css.matchAll(/^\s*(--[\w-]+):\s*[^;]*\bpx\b[^;]*;/gm)]
      .map((m) => m[0].trim())
      // calc()/min() expressions legitimately mention px-valued vars, not literals
      .filter((line) => !/calc\(|min\(/.test(line));
    expect(offenders).toEqual([]);
  });

  it("emits font sizes in rem", () => {
    const v = vars(css);
    expect(v["--font-size-100"]).toBe("0.875rem");
    expect(v["--font-size-200"]).toBe("1rem");
  });

  it("emits line heights in rem", () => {
    expect(vars(css)["--font-line-height-700"]).toBe("1.75rem");
  });

  it("emits letter spacing in em", () => {
    expect(vars(css)["--font-letter-spacing-tight"]).toBe("-0.015em");
  });

  it("emits unitless-marked tokens as bare numbers", () => {
    const v = vars(css);
    expect(v["--radius-scale-sm"]).toBe("0.75");
    expect(v["--radius-intensity"]).toBe("1");
  });

  it("emits the dark mode selector", () => {
    expect(css).toContain("[data-color-mode='dark']");
  });

  it("emits all four radius mode selectors", () => {
    for (const mode of ["sharp", "default", "rounded", "pill"]) {
      expect(css).toContain(`[data-radius-mode='${mode}']`);
    }
  });

  it("emits the derived radius layer", () => {
    expect(css).toContain(
      "--radius-base: calc(var(--radius-unit) * var(--radius-intensity));",
    );
    expect(css).toContain("--radius-adaptive-md:");
    expect(css).toContain("--radius-geometric-md:");
  });

  it("scopes the derived radius layer to :root and every mode selector, not just :root", () => {
    // A custom property substitutes var() where it's declared, so a block
    // emitted only under :root never re-resolves for a nested
    // [data-radius-mode] subtree. The selector must cover both, or mode
    // switching silently breaks anywhere but the document root.
    expect(css).toContain(":root, [data-radius-mode] {");
  });

  it("emits the derived spacing layer", () => {
    expect(css).toContain("--space-scale: 1;");
    expect(css).toContain("--space-16: calc(var(--sp-16) * var(--space-scale));");
  });

  it("scopes the derived spacing layer to :root and every [data-density] scope", () => {
    // Same substitution-site rule as radius: a block emitted only under
    // :root never re-resolves --space-scale for a nested subtree.
    expect(css).toContain(":root, [data-density] {");
  });

  it("derives a --space-N for every sp-N primitive in the source", () => {
    // Guards against the step list silently falling out of sync with the
    // Figma export — a new sp-* step must flow through with no code change.
    const primitives = [...css.matchAll(/^\s*--(sp-\d+):/gm)].map((m) => m[1]);
    expect(primitives.length).toBeGreaterThan(0);
    for (const step of primitives) {
      const n = step.slice("sp-".length);
      expect(css).toContain(`--space-${n}: calc(var(--${step}) * var(--space-scale));`);
    }
  });

  it("emits exactly one --space-<n> declaration per --sp-<n> declaration", () => {
    // Cheap reverse-direction check: the test above confirms every --sp-N has
    // a --space-N, but not that the counts match — this would miss a step
    // dropped by the discovery predicate in buildTokens.ts (e.g. a
    // non-numeric name like sp-0-5) while a differently-named one still
    // slipped through.
    const spCount = [...css.matchAll(/^\s*--sp-\d+:/gm)].length;
    const spaceCount = [...css.matchAll(/^\s*--space-\d+:/gm)].length;
    expect(spaceCount).toBe(spCount);
  });
});

describe("opacity and animation tokens", () => {
  it("emits opacity primitives as percentages", () => {
    const v = vars(css);
    expect(v["--opacity-0"]).toBe("0%");
    expect(v["--opacity-16"]).toBe("16%");
    expect(v["--opacity-100"]).toBe("100%");
  });

  it("emits durations in whole milliseconds", () => {
    // Figma exports 0.2s as the float32 round-trip 0.20000000298023224.
    expect(vars(css)["--duration-fast"]).toBe("200ms");
  });

  it("emits no duration carrying Figma's float noise", () => {
    const offenders = [...css.matchAll(/^\s*--[\w-]+:\s*[\d.]{8,}m?s;/gm)].map(
      (m) => m[0].trim(),
    );
    expect(offenders).toEqual([]);
  });

  it("emits every cubicBezier token as cubic-bezier() with rounded points", () => {
    // Read the expected set from the source rather than pinning literals, so
    // a re-export that retunes a curve or drops one does not fail here — only
    // a genuine transform regression does.
    const source = JSON.parse(
      readFileSync("src/tokens/animation.mode-1.tokens.json", "utf-8"),
    ) as Record<string, { $type: string; $value: unknown }>;
    const beziers = Object.entries(source).filter(
      ([, t]) => t.$type === "cubicBezier",
    );
    expect(beziers.length).toBeGreaterThan(0);

    const v = vars(css);
    for (const [name, token] of beziers) {
      const points = (token.$value as number[]).map(
        (n) => Math.round(n * 10_000) / 10_000,
      );
      expect(v[`--${name}`]).toBe(`cubic-bezier(${points.join(", ")})`);
    }
  });

  it("folds the single-mode opacity and animation collections into :root", () => {
    // Both are single-mode, so they must land in :root with no selector of
    // their own — a multi-mode declaration would hit the silent-collision
    // path documented in the README.
    const root = css.slice(css.indexOf(":root {"), css.indexOf("\n}"));
    expect(root).toContain("--opacity-16:");
    expect(root).toContain("--duration-fast:");
  });
});

describe("float noise", () => {
  it("emits no value carrying Figma's float32 round-trip noise", () => {
    // Figma exports 0.85 as 0.8500000238418579 and 0.2s as
    // 0.20000000298023224. Every value authored in this repo is exact at four
    // decimal places, so anything longer is noise that leaked through.
    const offenders = [...css.matchAll(/^\s*--[\w-]+:[^;]*\.\d{5,}[^;]*;/gm)].map(
      (m) => m[0].trim(),
    );
    expect(offenders).toEqual([]);
  });
});

describe("composite typography tokens", () => {
  /** The composite token names, read from the source rather than hardcoded. */
  const compositeNames = Object.keys(
    JSON.parse(
      readFileSync("src/tokens/typography.styles.tokens.json", "utf-8"),
    ) as Record<string, unknown>,
  );

  it("emits no composite typography shorthand into the stylesheet", () => {
    // These duplicate typography-mixins.scss exactly, so they are dead weight
    // in the stylesheet. The per-property customs below are the real API.
    const offenders = [
      ...css.matchAll(/^\s*(--[\w-]+):\s*var\(--typography-[\w-]+-font-weight\)/gm),
    ].map((m) => m[1]);
    expect(offenders).toEqual([]);
  });

  it("keeps the per-property customs the mixins reference", () => {
    // Dropping the shorthands must not drop what they were built from —
    // removing these would break every generated mixin.
    const v = vars(css);
    expect(v["--typography-body-lg-font-size"]).toBeDefined();
    expect(v["--typography-body-lg-font-weight"]).toBeDefined();
    expect(v["--typography-body-lg-line-height"]).toBeDefined();
    expect(v["--typography-body-lg-font-family"]).toBeDefined();
  });

  it("still generates a mixin for every composite typography token", () => {
    expect(compositeNames.length).toBeGreaterThan(0);
    for (const name of compositeNames) {
      expect(mixins).toContain(`@mixin ${name} {`);
    }
  });
});
