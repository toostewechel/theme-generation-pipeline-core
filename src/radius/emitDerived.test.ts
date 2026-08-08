import { describe, it, expect } from "vitest";
import { emitDerivedRadiusCss } from "./emitDerived.js";
import { SIZES } from "./compute.js";

describe("emitDerivedRadiusCss", () => {
  const css = emitDerivedRadiusCss();

  it("wraps the block in :root by default", () => {
    expect(css.trimStart().startsWith(":root {")).toBe(true);
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
    // Every declaration must reference other custom properties, never a number.
    const declarations = [...css.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)];
    expect(declarations.length).toBeGreaterThan(0);
    for (const [, name, value] of declarations) {
      expect(value, `${name} must not contain a literal number`).not.toMatch(
        /(^|[\s(])\d/,
      );
    }
  });

  it("accepts a custom selector", () => {
    expect(emitDerivedRadiusCss(".theme").trimStart().startsWith(".theme {")).toBe(true);
  });
});
