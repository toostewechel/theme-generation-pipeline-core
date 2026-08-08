import { describe, it, expect } from "vitest";
import { emitDerivedSpacingCss } from "./emitDerived.js";

const STEPS = ["sp-0", "sp-2", "sp-4", "sp-16", "sp-124"];

/**
 * The derived block only — everything from the derived selector onward.
 * The `:root` knob-default block above it legitimately holds a literal
 * (`--space-scale: 1`), so purity assertions must not see it.
 */
function derivedBlock(css: string, selector = ":root, [data-density]"): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start);
}

describe("emitDerivedSpacingCss", () => {
  const css = emitDerivedSpacingCss(STEPS);

  it("declares the knob default at :root, separate from the derived block", () => {
    // Not in the shared block: that block is re-declared at every
    // [data-density] scope, so a default living there would re-declare
    // --space-scale: 1 on every bare data-density element, resetting any
    // density inherited from an ancestor. See src/spacing/render.test.ts,
    // which gates the behaviour this structure protects.
    expect(css.trimStart().startsWith(":root {")).toBe(true);
    expect(css).toContain("--space-scale: 1;");

    const derived = derivedBlock(css);
    expect(derived).not.toContain("--space-scale:");
  });

  it("covers :root and any [data-density] scope by default", () => {
    // :root alone is not enough: a custom property substitutes var() where
    // it is *declared*, so a block emitted only under :root would never
    // re-resolve --space-scale for a nested [data-density] subtree. This is
    // the exact defect that shipped in the radius layer.
    expect(css).toContain(":root, [data-density] {");
    expect(css.trimEnd().endsWith("}")).toBe(true);
  });

  it("emits one --space-N per sp-N step, in the order given", () => {
    for (const step of STEPS) {
      const n = step.slice("sp-".length);
      expect(css).toContain(
        `--space-${n}: calc(var(--${step}) * var(--space-scale));`,
      );
    }
  });

  it("emits nothing beyond the steps it was given", () => {
    const declared = [...derivedBlock(css).matchAll(/^\s*(--space-[\w-]+):/gm)];
    expect(declared).toHaveLength(STEPS.length);
  });

  it("emits no literal values in the derived block — pure references", () => {
    // Every declaration must reference other custom properties, never a
    // number of its own. Reference names legitimately contain digits
    // (--sp-124), so strip var(--…) before checking what remains.
    const declarations = [
      ...derivedBlock(css).matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm),
    ];
    expect(declarations.length).toBe(STEPS.length);
    for (const [, name, value] of declarations) {
      const withoutRefs = value.replace(/var\(--[\w-]+\)/g, "");
      expect(withoutRefs, `${name} must not contain a literal number`).not.toMatch(/\d/);
    }
  });

  it("throws on a step name that is not prefixed sp-", () => {
    expect(() => emitDerivedSpacingCss(["size-4"])).toThrow(/sp-/);
  });

  it("accepts a custom selector for the derived block only", () => {
    const custom = emitDerivedSpacingCss(STEPS, ".theme");
    expect(custom).toContain(".theme {");
    expect(custom.trimStart().startsWith(":root {")).toBe(true);
    expect(custom).not.toContain(":root, [data-density] {");
  });
});
