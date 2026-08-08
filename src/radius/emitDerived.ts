import { SIZES } from "./compute.js";

/**
 * Emits the derived radius layer — the consumer-facing API that components
 * actually use.
 *
 * A custom property's *computed value* is its specified value with every
 * var() already substituted, resolved against the element on which the
 * property is declared — not the element that later consumes it. If
 * --radius-base is declared only on :root, var(--radius-intensity) is
 * substituted exactly once, using :root's value, and that finished value is
 * what every descendant inherits. A descendant that overrides
 * --radius-intensity (e.g. via [data-radius-mode="pill"]) does not change
 * --radius-base on that descendant, because --radius-base was never
 * re-declared — and therefore never re-substituted — there. It only
 * inherited the already-resolved number from :root. So a single :root
 * emission does NOT cover nested mode scopes; it only works when the mode
 * attribute is set on the document root itself.
 *
 * The fix is to re-declare this block at every scope that can change
 * --radius-intensity, so each one substitutes var(--radius-intensity)
 * afresh against its own cascade. The default selector,
 * ":root, [data-radius-mode]", does that: any element carrying
 * data-radius-mode — regardless of its value, including "default" — gets
 * its own copy of --radius-base and everything derived from it. An element
 * with no data-radius-mode attribute of its own is unaffected and correctly
 * inherits the finished values from the nearest ancestor that does declare
 * them (or from :root if there is none).
 *
 * Depends on --radius-unit, --radius-intensity, --radius-scale-*, and
 * --radius-cap-*, all of which the token build emits from DTCG sources.
 */
export function emitDerivedRadiusCss(selector = ":root, [data-radius-mode]"): string {
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
