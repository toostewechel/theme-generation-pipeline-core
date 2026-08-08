import { SIZES } from "./compute.js";

/**
 * Emits the derived radius layer — the consumer-facing API that components
 * actually use.
 *
 * Emitted ONCE, not per mode. Custom properties resolve var() at
 * computed-value time per element, so a subtree carrying
 * [data-radius-mode="pill"] — which overrides only --radius-intensity —
 * recomputes --radius-base and everything downstream automatically.
 * One emission therefore covers all four modes, and the computation stays
 * at runtime as docs/radius-system-rationale.md intends.
 *
 * Depends on --radius-unit, --radius-intensity, --radius-scale-*, and
 * --radius-cap-*, all of which the token build emits from DTCG sources.
 */
export function emitDerivedRadiusCss(selector = ":root"): string {
  const lines: string[] = [];

  lines.push(`${selector} {`);
  lines.push("  /* Derived radius layer — generated from src/radius/emitDerived.ts */");
  lines.push("  --radius-base: calc(var(--radius-unit) * var(--radius-intensity));");
  lines.push("");

  lines.push("  /* Adaptive — scales without limit (buttons, badges) */");
  for (const size of SIZES) {
    lines.push(
      `  --radius-adaptive-${size}: calc(var(--radius-base) * var(--radius-scale-${size}));`,
    );
  }
  lines.push("");

  lines.push("  /* Geometric — capped to preserve shape (cards, containers) */");
  for (const size of SIZES) {
    lines.push(
      `  --radius-geometric-${size}: min(calc(var(--radius-base) * var(--radius-scale-${size})), var(--radius-cap-${size}));`,
    );
  }
  lines.push("}");

  return lines.join("\n");
}
