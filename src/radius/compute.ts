// ─── Types ──────────────────────────────────────────────────────────

export type Size = "xs" | "sm" | "md" | "lg" | "xl";
export type Mode = "sharp" | "default" | "rounded" | "pill";

export const SIZES: Size[] = ["xs", "sm", "md", "lg", "xl"];
export const MODES: Mode[] = ["sharp", "default", "rounded", "pill"];

export interface RadiusParams {
  unit: number;
  scales: Record<Size, number>;
  caps: Record<Size, number>;
  modes: Record<Mode, number>; // intensity per mode
}

export interface ComputedRadius {
  base: number;
  adaptive: Record<Size, number>;
  geometric: Record<Size, number>;
}

export type ComputedRadiusTable = Record<Mode, ComputedRadius>;

// ─── Computation ────────────────────────────────────────────────────

export function computeBase(unit: number, intensity: number): number {
  return unit * intensity;
}

export function computeAdaptive(base: number, scale: number): number {
  return base * scale;
}

export function computeGeometric(
  base: number,
  scale: number,
  cap: number,
): number {
  return Math.min(base * scale, cap);
}

export function computeAll(params: RadiusParams): ComputedRadiusTable {
  const result = {} as ComputedRadiusTable;

  for (const mode of MODES) {
    const intensity = params.modes[mode];
    const base = computeBase(params.unit, intensity);
    const adaptive = {} as Record<Size, number>;
    const geometric = {} as Record<Size, number>;

    for (const size of SIZES) {
      adaptive[size] = computeAdaptive(base, params.scales[size]);
      geometric[size] = computeGeometric(
        base,
        params.scales[size],
        params.caps[size],
      );
    }

    result[mode] = { base, adaptive, geometric };
  }

  return result;
}

// ─── Token Loading ──────────────────────────────────────────────────

interface DTCGToken {
  $type?: string;
  $value: { value: number; unit?: string } | number;
  $description?: string;
}

function tokenValue(token: DTCGToken): number {
  if (typeof token.$value === "number") return token.$value;
  return token.$value.value;
}

export function buildDefaultParams(
  primitives: Record<string, DTCGToken>,
  modeTokens: Record<string, Record<string, DTCGToken>>,
): RadiusParams {
  return {
    unit: tokenValue(primitives["radius-unit"]),
    scales: {
      xs: tokenValue(primitives["radius-scale-xs"]),
      sm: tokenValue(primitives["radius-scale-sm"]),
      md: tokenValue(primitives["radius-scale-md"]),
      lg: tokenValue(primitives["radius-scale-lg"]),
      xl: tokenValue(primitives["radius-scale-xl"]),
    },
    caps: {
      xs: tokenValue(primitives["radius-cap-xs"]),
      sm: tokenValue(primitives["radius-cap-sm"]),
      md: tokenValue(primitives["radius-cap-md"]),
      lg: tokenValue(primitives["radius-cap-lg"]),
      xl: tokenValue(primitives["radius-cap-xl"]),
    },
    modes: {
      sharp: modeTokens["sharp"]
        ? tokenValue(modeTokens["sharp"]["radius-intensity"])
        : 0,
      default: modeTokens["default"]
        ? tokenValue(modeTokens["default"]["radius-intensity"])
        : 1,
      rounded: modeTokens["rounded"]
        ? tokenValue(modeTokens["rounded"]["radius-intensity"])
        : 2.5,
      pill: modeTokens["pill"]
        ? tokenValue(modeTokens["pill"]["radius-intensity"])
        : 9999,
    },
  };
}

// ─── Fallback defaults (when token files aren't available) ──────────

export function getHardcodedDefaults(): RadiusParams {
  return {
    unit: 4,
    scales: { xs: 0.5, sm: 0.75, md: 1, lg: 1.25, xl: 1.5 },
    caps: { xs: 2, sm: 4, md: 8, lg: 16, xl: 24 },
    modes: { sharp: 0, default: 1, rounded: 2.5, pill: 9999 },
  };
}
