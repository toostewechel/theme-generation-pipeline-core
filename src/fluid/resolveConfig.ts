export interface FluidRange {
  min: string;
  max: string;
}

/** Line-height: unitless number, or { min, max } unitless range for ratio shifts */
export type LineHeightConfig = number | { min: number; max: number };

export interface FluidStyleConfig {
  fontSize: FluidRange;
  lineHeight?: LineHeightConfig;
  viewports?: { min: number; max: number };
  fontFamily?: string;
}

export interface FluidTypographyConfig {
  baseFontSize: number;
  viewports: { min: number; max: number };
  styles: Record<string, FluidStyleConfig>;
}

export interface ResolvedFluidRange {
  minPx: number;
  maxPx: number;
}

/** Resolved line-height: unitless number, or unitless range */
export type ResolvedLineHeight = number | { min: number; max: number };

export interface ResolvedFluidStyle {
  fontSize: ResolvedFluidRange;
  lineHeight?: ResolvedLineHeight;
  viewports: { min: number; max: number };
  fontFamily?: string;
}

export interface ResolvedFluidConfig {
  baseFontSize: number;
  viewports: { min: number; max: number };
  styles: Record<string, ResolvedFluidStyle>;
}

/**
 * Builds a token-name → px-value lookup from a flat DTCG primitives object.
 * Non-dimension tokens are skipped.
 */
export function buildTokenLookup(
  primitives: Record<string, any>,
): Map<string, number> {
  const lookup = new Map<string, number>();

  for (const [key, token] of Object.entries(primitives)) {
    if (token?.$type !== "dimension" || !token.$value) continue;
    if (typeof token.$value === "object" && token.$value.value !== undefined) {
      lookup.set(key, token.$value.value);
    } else if (typeof token.$value === "number") {
      lookup.set(key, token.$value);
    }
  }

  return lookup;
}

/**
 * Resolves a token reference or raw px value to a number.
 * Accepts: "{font-size-1200}" or "14px" or "14"
 */
function resolveValue(value: string, lookup: Map<string, number>): number {
  const refMatch = value.match(/^\{(.+)\}$/);
  if (refMatch) {
    const tokenName = refMatch[1];
    const px = lookup.get(tokenName);
    if (px === undefined) {
      throw new Error(`Token reference "${tokenName}" not found in primitives`);
    }
    return px;
  }

  const num = parseFloat(value);
  if (isNaN(num)) {
    throw new Error(`Cannot parse value: "${value}"`);
  }
  return num;
}

/**
 * Resolves a fluid typography config against a token lookup.
 * Line-height is unitless and passed through as-is (no token resolution).
 */
export function resolveConfig(
  config: FluidTypographyConfig,
  lookup: Map<string, number>,
): ResolvedFluidConfig {
  const styles: Record<string, ResolvedFluidStyle> = {};

  for (const [styleName, style] of Object.entries(config.styles)) {
    const resolved: ResolvedFluidStyle = {
      fontSize: {
        minPx: resolveValue(style.fontSize.min, lookup),
        maxPx: resolveValue(style.fontSize.max, lookup),
      },
      viewports: style.viewports ?? config.viewports,
    };
    if (style.lineHeight !== undefined) {
      resolved.lineHeight = style.lineHeight;
    }
    if (style.fontFamily) {
      resolved.fontFamily = style.fontFamily;
    }
    styles[styleName] = resolved;
  }

  return {
    baseFontSize: config.baseFontSize,
    viewports: config.viewports,
    styles,
  };
}
