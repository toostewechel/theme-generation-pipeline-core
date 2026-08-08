import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { generateClamp, generateUnitlessClamp } from "./generateClamp.js";
import { resolveFluidConfig } from "./loadConfig.js";
import type { ResolvedFluidStyle, ResolvedLineHeight } from "./resolveConfig.js";

export interface BuildFluidMixinsOptions {
  configPath: string;
  primitivesGlob: string;
  typographyStylesPath: string;
  outputPath: string;
}

/** Maps typography $value property keys to CSS property names. */
const typographyPropertyMap: Record<string, string> = {
  fontFamily: "font-family",
  fontWeight: "font-weight",
  fontSize: "font-size",
  lineHeight: "line-height",
  letterSpacing: "letter-spacing",
  fontStyle: "font-style",
  textDecoration: "text-decoration",
  textTransform: "text-transform",
};

/**
 * Generates the CSS value for a resolved line-height config.
 * - number → unitless value (e.g., "1.2")
 * - { min, max } → unitless clamp (for intentional ratio shifts)
 */
function formatLineHeight(
  lh: ResolvedLineHeight,
  viewports: { min: number; max: number },
): string {
  if (typeof lh === "number") {
    return String(lh);
  }
  return generateUnitlessClamp({
    min: lh.min,
    max: lh.max,
    minVwPx: viewports.min,
    maxVwPx: viewports.max,
  });
}

/**
 * Extracts a CSS var() reference from a token reference string.
 * "{text-heading-display-font-family}" → "var(--text-heading-display-font-family)"
 */
function toVarRef(value: unknown): string {
  if (typeof value !== "string") return String(value);
  const match = value.match(/^\{(.+)\}$/);
  if (match) {
    const varName = match[1].replace(/\./g, "-");
    return `var(--${varName})`;
  }
  return String(value);
}

/**
 * Builds a single SCSS mixin string for a fluid typography style.
 */
function buildFluidMixin(
  styleName: string,
  resolved: ResolvedFluidStyle,
  compositeValue: Record<string, unknown>,
  baseFontSize: number,
): string {
  const properties: string[] = [];

  for (const [camelKey, refValue] of Object.entries(compositeValue)) {
    const cssProp = typographyPropertyMap[camelKey];
    if (!cssProp) continue;

    if (camelKey === "fontSize") {
      const clamp = generateClamp({
        minPx: resolved.fontSize.minPx,
        maxPx: resolved.fontSize.maxPx,
        minVwPx: resolved.viewports.min,
        maxVwPx: resolved.viewports.max,
        baseFontSize,
      });
      properties.push(`  ${cssProp}: ${clamp};`);
    } else if (camelKey === "lineHeight" && resolved.lineHeight !== undefined) {
      const value = formatLineHeight(resolved.lineHeight, resolved.viewports);
      properties.push(`  ${cssProp}: ${value};`);
    } else {
      // Static property — resolve to var() reference
      properties.push(`  ${cssProp}: ${toVarRef(refValue)};`);
    }
  }

  return `@mixin ${styleName} {\n${properties.join("\n")}\n}`;
}

/**
 * Builds fluid typography SCSS mixins from the config and token files.
 * Returns false without writing anything if the config file doesn't exist,
 * so callers can tell whether `outputPath` was actually produced.
 */
export async function buildFluidTypographyMixins(
  options: BuildFluidMixinsOptions,
): Promise<boolean> {
  const { configPath, primitivesGlob, typographyStylesPath, outputPath } = options;

  // Skip silently if no fluid config exists
  if (!existsSync(configPath)) {
    return false;
  }

  // Resolve the fluid config (token refs → pixel values)
  const resolvedConfig = await resolveFluidConfig({
    configPath,
    primitivesGlob,
  });

  if (!resolvedConfig) {
    return false;
  }

  // Load composite typography tokens for static property references
  let typographyStyles: Record<string, any> = {};
  if (existsSync(typographyStylesPath)) {
    typographyStyles = JSON.parse(readFileSync(typographyStylesPath, "utf-8"));
  } else {
    console.warn(
      `⚠️  Typography styles not found at ${typographyStylesPath}. Fluid mixins will only include fluid properties.`,
    );
  }

  // Validate: every fluid config style name must match a composite typography token.
  // This catches typos and naming drift between the fluid config and the token source.
  const compositeNames = new Set(Object.keys(typographyStyles));
  const fluidNames = Object.keys(resolvedConfig.styles);

  if (compositeNames.size > 0) {
    const unmatched = fluidNames.filter((name) => !compositeNames.has(name));
    if (unmatched.length > 0) {
      console.warn(
        `⚠️  Fluid config has style names not found in typography tokens: ${unmatched.join(", ")}\n` +
        `   Available token names: ${[...compositeNames].join(", ")}\n` +
        `   Fluid mixins for unmatched styles will only include font-size and line-height.`,
      );
    }
  }

  // Generate mixins
  const mixins: string[] = [];
  for (const [styleName, resolved] of Object.entries(resolvedConfig.styles)) {
    const composite = typographyStyles[styleName];
    const compositeValue: Record<string, unknown> = composite?.$value ?? {};

    // If no composite token exists, generate fontSize/lineHeight-only mixin
    if (!composite) {
      const lines: string[] = [];
      const fsClamp = generateClamp({
        minPx: resolved.fontSize.minPx,
        maxPx: resolved.fontSize.maxPx,
        minVwPx: resolved.viewports.min,
        maxVwPx: resolved.viewports.max,
        baseFontSize: resolvedConfig.baseFontSize,
      });
      lines.push(`  font-size: ${fsClamp};`);

      if (resolved.lineHeight !== undefined) {
        const value = formatLineHeight(resolved.lineHeight, resolved.viewports);
        lines.push(`  line-height: ${value};`);
      }
      mixins.push(`@mixin ${styleName} {\n${lines.join("\n")}\n}`);
      continue;
    }

    mixins.push(
      buildFluidMixin(
        styleName,
        resolved,
        compositeValue,
        resolvedConfig.baseFontSize,
      ),
    );
  }

  // Write output
  const header = [
    "// Do not edit directly, this file was auto-generated.",
    `// Fluid typography: ${resolvedConfig.viewports.min}px – ${resolvedConfig.viewports.max}px`,
    "",
  ].join("\n");

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, header + "\n" + mixins.join("\n\n") + "\n", "utf-8");
  return true;
}
