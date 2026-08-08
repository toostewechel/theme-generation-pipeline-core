import { describe, it, expect } from "vitest";
import { emitDerivedRadiusCss } from "./emitDerived.js";
import { SIZES } from "./compute.js";

describe("emitDerivedRadiusCss", () => {
  const css = emitDerivedRadiusCss();

  it("covers :root and any [data-radius-mode] scope by default", () => {
    // :root alone is not enough: a custom property substitutes var() where
    // it is *declared*, so a block emitted only under :root would never
    // re-resolve --radius-intensity for a nested [data-radius-mode] subtree
    // (see the doc comment on emitDerivedRadiusCss). The default selector
    // must therefore re-declare the block at both scopes.
    expect(css.trimStart().startsWith(":root, [data-radius-mode] {")).toBe(true);
    expect(css.trimEnd().endsWith("}")).toBe(true);
  });

  it("derives the base from unit and intensity", () => {
    expect(css).toContain(
      "--radius-base: calc(var(--radius-unit) * var(--radius-intensity));",
    );
  });

  it("emits an adaptive var for every size", () => {
    for (const size of SIZES) {
      expect(css).toContain(
        `--radius-adaptive-${size}: calc(var(--radius-base) * var(--radius-scale-${size}));`,
      );
    }
  });

  it("emits a capped geometric var for every size", () => {
    for (const size of SIZES) {
      expect(css).toContain(
        `--radius-geometric-${size}: min(calc(var(--radius-base) * var(--radius-scale-${size})), var(--radius-cap-${size}));`,
      );
    }
  });

  it("emits no literal values — the layer is pure references", () => {
    // Every declaration must reference other custom properties, never a
    // number of its own. This is the enforcement point for the "runtime
    // calc(), no build-time radius computation" constraint. var() reference
    // names legitimately contain digits (e.g. --radius-scale-2xl), so those
    // are stripped before checking for a literal digit in what remains —
    // otherwise a size like "2xl" would false-positive against a reference
    // that isn't a literal number at all.
    const declarations = [...css.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)];
    expect(declarations.length).toBeGreaterThan(0);
    for (const [, name, value] of declarations) {
      const withoutRefs = value.replace(/var\(--[\w-]+\)/g, "");
      expect(
        withoutRefs,
        `${name} must not contain a literal number`,
      ).not.toMatch(/\d/);
    }
  });

  it("accepts a custom selector", () => {
    expect(emitDerivedRadiusCss(".theme").trimStart().startsWith(".theme {")).toBe(true);
  });
});
