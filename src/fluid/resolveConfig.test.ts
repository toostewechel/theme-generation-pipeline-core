import { describe, it, expect } from "vitest";
import {
  buildTokenLookup,
  resolveConfig,
  type FluidTypographyConfig,
} from "./resolveConfig.js";

const primitives = {
  "font-size-100": { $type: "dimension", $value: { value: 14, unit: "px" } },
  "font-size-1200": { $type: "dimension", $value: { value: 48, unit: "px" } },
  "font-weight-bold": { $type: "fontWeight", $value: 700 },
};

describe("buildTokenLookup", () => {
  it("indexes dimension tokens by name in px", () => {
    const lookup = buildTokenLookup(primitives);
    expect(lookup.get("font-size-100")).toBe(14);
    expect(lookup.get("font-size-1200")).toBe(48);
  });

  it("ignores non-dimension tokens", () => {
    expect(buildTokenLookup(primitives).has("font-weight-bold")).toBe(false);
  });
});

describe("resolveConfig", () => {
  const lookup = buildTokenLookup(primitives);

  const config: FluidTypographyConfig = {
    baseFontSize: 16,
    viewports: { min: 320, max: 1440 },
    styles: {
      "display-xl": {
        fontSize: { min: "{font-size-100}", max: "{font-size-1200}" },
        lineHeight: 1.2,
      },
    },
  };

  it("resolves token references to px", () => {
    const resolved = resolveConfig(config, lookup);
    expect(resolved.styles["display-xl"].fontSize).toEqual({ minPx: 14, maxPx: 48 });
  });

  it("passes line-height through unresolved", () => {
    expect(resolveConfig(config, lookup).styles["display-xl"].lineHeight).toBe(1.2);
  });

  it("falls back to the global viewports", () => {
    expect(resolveConfig(config, lookup).styles["display-xl"].viewports)
      .toEqual({ min: 320, max: 1440 });
  });

  it("honours a per-style viewport override", () => {
    const overridden: FluidTypographyConfig = {
      ...config,
      styles: {
        "display-xl": { ...config.styles["display-xl"], viewports: { min: 400, max: 1200 } },
      },
    };
    expect(resolveConfig(overridden, lookup).styles["display-xl"].viewports)
      .toEqual({ min: 400, max: 1200 });
  });

  it("accepts raw px values as well as references", () => {
    const raw: FluidTypographyConfig = {
      ...config,
      styles: { body: { fontSize: { min: "14px", max: "18" } } },
    };
    expect(resolveConfig(raw, lookup).styles.body.fontSize).toEqual({ minPx: 14, maxPx: 18 });
  });

  it("carries fontFamily through to the resolved style", () => {
    const withFamily: FluidTypographyConfig = {
      ...config,
      styles: {
        "display-xl": { ...config.styles["display-xl"], fontFamily: "Signifier" },
      },
    };
    expect(resolveConfig(withFamily, lookup).styles["display-xl"].fontFamily).toBe("Signifier");
  });

  it("throws on an unknown token reference", () => {
    const bad: FluidTypographyConfig = {
      ...config,
      styles: { body: { fontSize: { min: "{nope}", max: "18px" } } },
    };
    expect(() => resolveConfig(bad, lookup)).toThrow(/nope/);
  });
});
