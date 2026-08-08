import { describe, it, expect } from "vitest";
import {
  generateClamp,
  generateUnitlessClamp,
  interpolateAtViewport,
} from "./generateClamp.js";

describe("generateClamp", () => {
  it("builds a clamp across a viewport range", () => {
    const css = generateClamp({
      minPx: 36, maxPx: 54, minVwPx: 320, maxVwPx: 1440, baseFontSize: 16,
    });
    expect(css).toBe("clamp(2.25rem, 1.9286rem + 1.6071vw, 3.375rem)");
  });

  it("returns a single rem value when min equals max", () => {
    const css = generateClamp({
      minPx: 16, maxPx: 16, minVwPx: 320, maxVwPx: 1440, baseFontSize: 16,
    });
    expect(css).toBe("1rem");
  });

  it("omits a zero intercept from the preferred value", () => {
    const css = generateClamp({
      minPx: 0, maxPx: 32, minVwPx: 0, maxVwPx: 1600, baseFontSize: 16,
    });
    expect(css).toBe("clamp(0rem, 2vw, 2rem)");
  });
});

describe("generateUnitlessClamp", () => {
  it("builds a unitless clamp for line-height ratios", () => {
    const css = generateUnitlessClamp({
      min: 1.2, max: 1.4, minVwPx: 320, maxVwPx: 1440,
    });
    expect(css).toBe("clamp(1.2, 1.1429 + 0.0179vw, 1.4)");
  });

  it("returns a bare number when min equals max", () => {
    expect(generateUnitlessClamp({
      min: 1.5, max: 1.5, minVwPx: 320, maxVwPx: 1440,
    })).toBe("1.5");
  });
});

describe("interpolateAtViewport", () => {
  it("clamps below the min viewport", () => {
    expect(interpolateAtViewport(16, 32, 320, 1440, 200)).toBe(16);
  });
  it("clamps above the max viewport", () => {
    expect(interpolateAtViewport(16, 32, 320, 1440, 2000)).toBe(32);
  });
  it("interpolates linearly in between", () => {
    expect(interpolateAtViewport(16, 32, 320, 1440, 880)).toBe(24);
  });
});
