/**
 * Shared CSS/SCSS platform config and the custom dimension transforms it depends on.
 *
 * Lives here (rather than inline in scripts/buildTokens.ts) so the transform order
 * — which is load-bearing, see the notes on `cssPlatformConfig` — is unit-testable.
 */

/**
 * Round away the float32 round-trip noise in Figma's exports.
 *
 * Figma stores numbers as float32 and serialises them back as float64, so an
 * authored 0.85 ships as 0.8500000238418579 and a bezier control point of
 * 0.7342 as 0.7341729402542114. Four decimal places removes that noise while
 * preserving every value authored in this repo exactly — the unitless scale
 * runs 0.5, 0.75, 1, 1.25, 1.5, 9999, none of which needs more.
 */
const FIGMA_FLOAT_DECIMALS = 4;
const roundFigmaFloat = (value: number) => {
  const factor = 10 ** FIGMA_FLOAT_DECIMALS;
  return Math.round(value * factor) / factor;
};

/**
 * Unitless dimensions.
 * Tokens with $description: 'unitless' output as raw numbers without units.
 */
export const dimensionUnitlessTransform = {
  name: "dimension/unitless",
  type: "value" as const,
  // Transitive means the transform should follow and apply to token references
  transitive: true,
  filter: (token: any) =>
    token.$type === "dimension" && token.$description === "unitless",
  transform: (token: any) => {
    // Read from the ORIGINAL DTCG value so this is immune to any earlier
    // dimension transform (dimension/css) that may have already stringified
    // the value with a unit. This transform must run LAST so nothing
    // re-appends a unit afterwards.
    const source = token.original?.$value ?? token.$value;
    const raw =
      typeof source === "object" && source.value !== undefined
        ? source.value
        : String(source).replace(/(px|rem|em)$/, "");
    const numeric = Number(raw);
    // Non-numeric values (a var() chain, say) pass through as-is.
    return Number.isFinite(numeric) ? String(roundFigmaFloat(numeric)) : String(raw);
  },
};

/**
 * em dimensions.
 * Tokens with $description: 'em' output in em units (px / basePxFontSize).
 */
export const dimensionEmTransform = {
  name: "dimension/em",
  type: "value" as const,
  transitive: true,
  filter: (token: any) =>
    token.$type === "dimension" && token.$description === "em",
  transform: (token: any, config: any) => {
    const baseFontSize = config?.basePxFontSize ?? 16;
    const pxValue =
      typeof token.$value === "object" && token.$value.value !== undefined
        ? Number(token.$value.value)
        : parseFloat(String(token.$value));
    const emValue = Math.round((pxValue / baseFontSize) * 1000) / 1000;
    return `${emValue}em`;
  },
};

/**
 * Duration in milliseconds.
 *
 * Figma authors durations in seconds and exports them as float32 round-trips
 * (0.2s ships as 0.20000000298023224). style-dictionary-utils' `duration/css`
 * preserves the authored value and unit verbatim, so that noise would reach
 * the stylesheet. Normalising to whole milliseconds here makes it structurally
 * impossible, and ms is the conventional unit for UI motion.
 *
 * Must run BEFORE `duration/css`, which short-circuits on string input — the
 * same arrangement `dimension/em` has with `dimension/css`.
 */
export const durationMsTransform = {
  name: "duration/ms",
  type: "value" as const,
  // Transitive so a token referencing another duration is normalised too.
  transitive: true,
  filter: (token: any) => token.$type === "duration",
  transform: (token: any) => {
    const source = token.$value;
    const toMs = (value: number, unit: string) =>
      unit === "s" ? value * 1000 : value;

    let ms: number;
    if (typeof source === "object" && source !== null && source.value !== undefined) {
      ms = toMs(Number(source.value), String(source.unit ?? "ms"));
    } else {
      // A resolved reference arrives already stringified ("200ms"), so parse
      // it back rather than passing it through — this keeps the transform
      // idempotent.
      const match = /^(-?\d*\.?\d+)(ms|s)?$/.exec(String(source).trim());
      if (!match) return source;
      ms = toMs(Number(match[1]), match[2] ?? "ms");
    }
    if (!Number.isFinite(ms)) return source;
    return `${Math.round(ms)}ms`;
  },
};

/**
 * Opacity as a percentage.
 *
 * Figma's opacity primitives are `$type: number` authored 0-100, which would
 * otherwise emit as a bare `16` — not a valid CSS opacity. 0-100 maps 1:1 onto
 * percent, so no arithmetic is needed. Percent (rather than a 0-1 decimal) is
 * what `color-mix()` requires, and it is equally valid in the `opacity`
 * property and in an alpha slot: `rgb(from X r g b / var(--opacity-16))`.
 *
 * Keyed on the `opacity-` name prefix, following the `sp-<digits>` precedent in
 * src/build/buildTokens.ts. A `number` token without that prefix is left as a
 * bare number, which is itself valid CSS — nothing is dropped, so nothing is
 * reported.
 */
export const opacityPercentTransform = {
  name: "opacity/percent",
  type: "value" as const,
  transitive: true,
  filter: (token: any) =>
    token.$type === "number" &&
    String(token.path?.[0] ?? token.name ?? "").startsWith("opacity-"),
  transform: (token: any) => {
    // parseFloat also re-reads an already-transformed "16%" reaching this
    // transform through a resolved reference, keeping it idempotent.
    const value = parseFloat(String(token.$value));
    if (!Number.isFinite(value)) return token.$value;
    return `${value}%`;
  },
};

/**
 * Rounded cubic-bezier control points.
 *
 * Figma exports a timing curve's control points with the same float32 noise as
 * every other number — 0.7342 ships as 0.7341729402542114. The values are
 * unitless ratios, so the extra digits change nothing a browser can render;
 * they just make the stylesheet unreadable.
 *
 * Must run BEFORE `cubicBezier/css`, which formats the array into
 * `cubic-bezier(...)` — the rounding has to happen while the value is still an
 * array of numbers.
 */
export const cubicBezierRoundTransform = {
  name: "cubicBezier/round",
  type: "value" as const,
  transitive: true,
  filter: (token: any) =>
    token.$type === "cubicBezier" && Array.isArray(token.$value),
  transform: (token: any) =>
    token.$value.map((point: unknown) => {
      const numeric = Number(point);
      return Number.isFinite(numeric) ? roundFigmaFloat(numeric) : point;
    }),
};

/**
 * Shared platform configuration, applied to every CSS/SCSS build.
 *
 * Transform order is load-bearing in three places:
 *
 * 1. `dimension/em` must run BEFORE `dimension/css` — it emits a string, which
 *    `dimension/css` then passes through untouched.
 * 2. `dimension/unitless` must run LAST so no other dimension transform
 *    re-appends a unit afterwards.
 * 3. `duration/ms` must run BEFORE `duration/css` — same reason as (1):
 *    `duration/css` keeps Figma's authored float verbatim, and passes a string
 *    through untouched.
 * 4. `cubicBezier/round` must run BEFORE `cubicBezier/css`, which turns the
 *    control-point array into a string.
 *
 * `dimension/css` (style-dictionary-utils) is what performs the px -> rem
 * conversion, honouring `outputUnit` and `basePxFontSize` below.
 *
 * Do NOT add Style Dictionary's built-in `size/rem` here. Despite the name it
 * does not convert px to rem — it only reads a *unitless* number as a rem count,
 * and for a DTCG dimension carrying an explicit unit it returns the value with
 * that unit as a string (e.g. {value:14, unit:'px'} -> "14px"). Because
 * `dimension/css` short-circuits on string input, that stringification silently
 * disables px -> rem conversion for every dimension token.
 */
export const cssPlatformConfig = {
  transforms: [
    "attribute/cti",
    "name/kebab",
    "time/seconds",
    "html/icon",
    "dimension/em",
    "asset/url",
    "fontFamily/css",
    // Must run BEFORE cubicBezier/css, which formats the array into
    // cubic-bezier(...) — rounding needs the numbers, not the string.
    "cubicBezier/round",
    "cubicBezier/css",
    "strokeStyle/css/shorthand",
    "border/css/shorthand",
    "typography/css/shorthand",
    "transition/css/shorthand",
    "oklch/css",
    "dimension/css",
    // Must run BEFORE duration/css, which preserves the authored unit verbatim
    // and short-circuits on string input.
    "duration/ms",
    "duration/css",
    "opacity/percent",
    "shadow/css",
    "strokeStyle/css",
    "transition/css",
    "typography/css",
    "fontWeight/css",
    "w3c-border/css",
    "gradient/css",
    // Must run LAST: strips the unit from dimension tokens marked
    // $description: "unitless" so later transforms can't re-append a unit.
    "dimension/unitless",
  ],
  outputUnit: "rem",
  basePxFontSize: 16,
};
