// Re-exported so the preview's other modules keep importing from "./compute.js".
export * from "@project/src/radius/compute.js";

import { SIZES, MODES, type RadiusParams } from "@project/src/radius/compute.js";
import { emitDerivedRadiusCss } from "@project/src/radius/emitDerived.js";

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function px(v: number): string {
  return `${round(v)}px`;
}

/**
 * Standalone CSS for the preview: the primitive layer the token build
 * normally supplies, plus the shared derived layer, plus mode selectors.
 * The derived block comes from the same module the build uses, so the
 * preview and the shipped CSS cannot drift.
 */
export function generateCSS(params: RadiusParams): string {
  const lines: string[] = [];

  lines.push(":root {");
  lines.push(`  --radius-unit: ${px(params.unit)};`);
  lines.push("");
  lines.push("  /* ─── Scale Multipliers (unitless) ─── */");
  for (const size of SIZES) {
    lines.push(`  --radius-scale-${size}: ${round(params.scales[size])};`);
  }
  lines.push("");
  lines.push("  /* ─── Geometric Caps ─── */");
  for (const size of SIZES) {
    lines.push(`  --radius-cap-${size}: ${px(params.caps[size])};`);
  }
  lines.push("}");
  lines.push("");

  lines.push(emitDerivedRadiusCss());
  lines.push("");

  for (const mode of MODES) {
    lines.push(`[data-radius-mode="${mode}"] {`);
    lines.push(`  --radius-intensity: ${round(params.modes[mode])}; /* ${mode} */`);
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}
