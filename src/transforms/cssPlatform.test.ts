import { describe, it, expect, beforeAll } from "vitest";
import { StyleDictionary } from "style-dictionary-utils";
import {
  cssPlatformConfig,
  dimensionEmTransform,
  cubicBezierRoundTransform,
  dimensionUnitlessTransform,
  durationMsTransform,
  opacityPercentTransform,
} from "./cssPlatform.js";
import { oklchCssTransform } from "./oklchColor.js";

beforeAll(() => {
  StyleDictionary.registerTransform(dimensionUnitlessTransform);
  StyleDictionary.registerTransform(dimensionEmTransform);
  StyleDictionary.registerTransform(durationMsTransform);
  StyleDictionary.registerTransform(cubicBezierRoundTransform);
  StyleDictionary.registerTransform(opacityPercentTransform);
  StyleDictionary.registerTransform(oklchCssTransform);
});

/** Run tokens through the real platform config and return the emitted CSS vars. */
async function transformTokens(
  tokens: Record<string, unknown>,
): Promise<Record<string, string>> {
  const sd = new StyleDictionary({
    tokens,
    log: { verbosity: "silent" },
    platforms: {
      css: {
        ...cssPlatformConfig,
        buildPath: "",
        files: [{ destination: "vars.css", format: "css/variables" }],
      },
    },
  });
  const [file] = await sd.formatPlatform("css");
  // Trailing `/* ... */` is the token's $description, emitted by css/variables.
  return Object.fromEntries(
    [...file.output.matchAll(/^\s*(--[\w-]+):\s*(.+?);/gm)].map((m) => [
      m[1],
      m[2],
    ]),
  );
}

const px = (value: number) => ({
  $type: "dimension" as const,
  $value: { value, unit: "px" },
});

describe("cssPlatformConfig transform order", () => {
  it("does not include size/rem", () => {
    // size/rem stringifies DTCG dimensions with their original unit ("14px"),
    // and dimension/css short-circuits on strings — so its presence silently
    // disables px -> rem conversion for every dimension token.
    expect(cssPlatformConfig.transforms).not.toContain("size/rem");
  });

  it("runs dimension/em before dimension/css", () => {
    const { transforms } = cssPlatformConfig;
    expect(transforms.indexOf("dimension/em")).toBeLessThan(
      transforms.indexOf("dimension/css"),
    );
  });

  it("runs dimension/unitless last", () => {
    const { transforms } = cssPlatformConfig;
    expect(transforms[transforms.length - 1]).toBe("dimension/unitless");
  });

  it("runs cubicBezier/round before cubicBezier/css", () => {
    // cubicBezier/css formats the array into cubic-bezier(...); rounding has
    // to happen while the value is still an array of numbers.
    const { transforms } = cssPlatformConfig;
    expect(transforms.indexOf("cubicBezier/round")).toBeLessThan(
      transforms.indexOf("cubicBezier/css"),
    );
  });

  it("runs duration/ms before duration/css", () => {
    // duration/css preserves the authored unit verbatim and short-circuits on
    // string input, so duration/ms has to normalise the value before it runs.
    const { transforms } = cssPlatformConfig;
    expect(transforms.indexOf("duration/ms")).toBeLessThan(
      transforms.indexOf("duration/css"),
    );
  });
});

describe("dimension output units", () => {
  it("converts px dimensions to rem at basePxFontSize", async () => {
    const vars = await transformTokens({
      "font-size-100": px(14),
      "font-line-height-700": px(28),
      "size-2": px(8),
      "size-4": px(16),
    });
    expect(vars["--font-size-100"]).toBe("0.875rem");
    expect(vars["--font-line-height-700"]).toBe("1.75rem");
    expect(vars["--size-2"]).toBe("0.5rem");
    expect(vars["--size-4"]).toBe("1rem");
  });

  it("keeps $description: 'unitless' tokens as bare numbers", async () => {
    const vars = await transformTokens({
      "radius-scale-sm": { ...px(0.75), $description: "unitless" },
      "radius-intensity": { ...px(1.5), $description: "unitless" },
    });
    expect(vars["--radius-scale-sm"]).toBe("0.75");
    expect(vars["--radius-intensity"]).toBe("1.5");
  });

  it("rounds float noise out of unitless tokens", async () => {
    // Figma exports 0.85 as the float32 round-trip 0.8500000238418579.
    const vars = await transformTokens({
      "state-active-intensity": {
        ...px(0.8500000238418579),
        $description: "unitless",
      },
      "state-hover-intensity": {
        ...px(1.0499999523162842),
        $description: "unitless",
      },
    });
    expect(vars["--state-active-intensity"]).toBe("0.85");
    expect(vars["--state-hover-intensity"]).toBe("1.05");
  });

  it("leaves exactly-authored unitless values untouched", async () => {
    const vars = await transformTokens({
      "radius-scale-sm": { ...px(0.75), $description: "unitless" },
      "radius-scale-lg": { ...px(1.25), $description: "unitless" },
      "radius-intensity": { ...px(9999), $description: "unitless" },
    });
    expect(vars["--radius-scale-sm"]).toBe("0.75");
    expect(vars["--radius-scale-lg"]).toBe("1.25");
    expect(vars["--radius-intensity"]).toBe("9999");
  });

  it("keeps $description: 'em' tokens in em", async () => {
    const vars = await transformTokens({
      "font-letter-spacing-tight": { ...px(-0.24), $description: "em" },
      "font-letter-spacing-normal": { ...px(0), $description: "em" },
    });
    expect(vars["--font-letter-spacing-tight"]).toBe("-0.015em");
    expect(vars["--font-letter-spacing-normal"]).toBe("0em");
  });

  it("converts px dimensions reached through references", async () => {
    const vars = await transformTokens({
      "font-size-200": px(16),
      "typography-body-font-size": {
        $type: "dimension",
        $value: "{font-size-200}",
      },
    });
    expect(vars["--typography-body-font-size"]).toBe("1rem");
  });
});

const seconds = (value: number) => ({
  $type: "duration" as const,
  $value: { value, unit: "s" },
});

describe("duration output", () => {
  it("converts authored seconds to whole milliseconds", async () => {
    const vars = await transformTokens({ "duration-fast": seconds(0.2) });
    expect(vars["--duration-fast"]).toBe("200ms");
  });

  it("rounds away the float noise Figma exports", async () => {
    // Figma writes 0.2s as a float32 round-trip: 0.20000000298023224.
    const vars = await transformTokens({
      "duration-fast": seconds(0.20000000298023224),
    });
    expect(vars["--duration-fast"]).toBe("200ms");
  });

  it("keeps durations already authored in ms", async () => {
    const vars = await transformTokens({
      "duration-slow": { $type: "duration", $value: { value: 400, unit: "ms" } },
    });
    expect(vars["--duration-slow"]).toBe("400ms");
  });

  it("emits a zero duration as 0ms", async () => {
    const vars = await transformTokens({ "duration-none": seconds(0) });
    expect(vars["--duration-none"]).toBe("0ms");
  });

  it("converts durations reached through references", async () => {
    const vars = await transformTokens({
      "duration-fast": seconds(0.2),
      "motion-enter": { $type: "duration", $value: "{duration-fast}" },
    });
    expect(vars["--motion-enter"]).toBe("200ms");
  });
});

describe("opacity output", () => {
  const opacity = (value: number) => ({
    $type: "number" as const,
    $value: value,
  });

  it("emits opacity-* number tokens as percentages", async () => {
    const vars = await transformTokens({
      "opacity-0": opacity(0),
      "opacity-16": opacity(16),
      "opacity-100": opacity(100),
    });
    expect(vars["--opacity-0"]).toBe("0%");
    expect(vars["--opacity-16"]).toBe("16%");
    expect(vars["--opacity-100"]).toBe("100%");
  });

  it("leaves number tokens that are not opacity-* as bare numbers", async () => {
    const vars = await transformTokens({ "z-index-modal": opacity(400) });
    expect(vars["--z-index-modal"]).toBe("400");
  });

  it("converts opacity reached through references", async () => {
    const vars = await transformTokens({
      "opacity-16": opacity(16),
      "opacity-disabled": { $type: "number", $value: "{opacity-16}" },
    });
    expect(vars["--opacity-disabled"]).toBe("16%");
  });
});

describe("cubicBezier output", () => {
  it("emits cubicBezier tokens as cubic-bezier()", async () => {
    const vars = await transformTokens({
      "easing-fly-in": {
        $type: "cubicBezier",
        $value: [0.34, 1.56, 0.64, 1],
      },
    });
    expect(vars["--easing-fly-in"]).toBe("cubic-bezier(0.34, 1.56, 0.64, 1)");
  });

  it("rounds float noise out of control points", async () => {
    const vars = await transformTokens({
      "easing-fly-in": {
        $type: "cubicBezier",
        $value: [0.7341729402542114, 0.011651400476694107, 1, 1],
      },
    });
    expect(vars["--easing-fly-in"]).toBe("cubic-bezier(0.7342, 0.0117, 1, 1)");
  });
});
