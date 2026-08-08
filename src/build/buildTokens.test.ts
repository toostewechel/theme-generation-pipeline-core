import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, rmSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildTokens } from "./buildTokens.js";

let css: string;
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "tokens-build-"));
  const result = await buildTokens({
    cssOutDir: join(outDir, "css"),
    scssOutDir: join(outDir, "scss"),
  });
  css = readFileSync(result.cssPath, "utf-8");
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
});
