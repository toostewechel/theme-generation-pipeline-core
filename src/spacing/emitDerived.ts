/**
 * Emits the derived spacing layer — the consumer-facing API that components
 * actually use.
 *
 * A custom property's *computed value* is its specified value with every
 * var() already substituted, resolved against the element on which the
 * property is declared — not the element that later consumes it. If
 * --space-16 is declared only on :root, var(--space-scale) is substituted
 * exactly once, using :root's value, and that finished value is what every
 * descendant inherits. A descendant that overrides --space-scale does not
 * change --space-16 on that descendant, because --space-16 was never
 * re-declared — and therefore never re-substituted — there.
 *
 * The fix is to re-declare the block at every scope that can change the
 * knob. The default selector, ":root, [data-density]", does that: any
 * element carrying data-density gets its own copy of every --space-* value,
 * re-substituted against its own cascade. An element with no data-density of
 * its own is unaffected and correctly inherits the finished values from the
 * nearest ancestor that does declare them.
 *
 * This is the same defect, and the same fix, as src/radius/emitDerived.ts.
 *
 * The knob default (--space-scale: 1) is emitted in its OWN :root block,
 * deliberately not in the shared block. [data-density] and a consumer's
 * [data-density="compact"] both have specificity 0,1,0; a default in the
 * shared block would tie with the consumer's rule and win on source order,
 * because generated CSS is imported first. Compact mode would silently do
 * nothing.
 *
 * Depends on the --sp-* primitives, which the token build emits from DTCG
 * sources. This layer performs no unit conversion of its own — values stay
 * in whatever unit the primitives carry (rem, per the unit contract).
 */
export function emitDerivedSpacingCss(
  steps: string[],
  selector = ":root, [data-density]",
): string {
  const lines: string[] = [];

  lines.push(":root {");
  lines.push("  /* Global density knob — override on :root or any [data-density] scope */");
  lines.push("  --space-scale: 1;");
  lines.push("}");
  lines.push("");

  lines.push(`${selector} {`);
  lines.push("  /* Derived spacing layer — generated from src/spacing/emitDerived.ts */");
  for (const step of steps) {
    if (!step.startsWith("sp-")) {
      throw new Error(
        `emitDerivedSpacingCss: expected a step named "sp-<n>", got "${step}"`,
      );
    }
    const n = step.slice("sp-".length);
    lines.push(`  --space-${n}: calc(var(--${step}) * var(--space-scale));`);
  }
  lines.push("}");

  return lines.join("\n");
}
