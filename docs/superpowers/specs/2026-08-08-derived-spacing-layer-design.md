# Derived spacing layer — design

**Date:** 2026-08-08
**Status:** approved, not yet implemented

## Problem

The consuming site maintains a hand-written `_spacing.scss` holding a sixteen-step
spacing scale wrapped in a `--space-scale` density multiplier. Every value in that
file is already emitted by this pipeline from the Figma-exported
`primitives-dimension` collection, as `--sp-0` through `--sp-124`.

So the file is a duplicate of pipeline output. The two copies already disagree:
the pipeline's top step is `sp-124`, the site's is `sp-128`. Nothing detects that.
This is the failure mode CLAUDE.md already records for the fluid clamp math —
a module copied out of `src/` drifted from its source.

What the pipeline does *not* provide is the density knob. That is the gap to close.

## Goals

- Emit a density-aware spacing layer from the pipeline, so the site can delete
  `_spacing.scss` entirely.
- Make the knob work on any subtree, not only on `:root`.
- Keep the Figma-exported primitives untouched, so a re-export cannot break it.

## Non-goals

- Scaling `size-*` or the semantic `sizing-*` tokens. See "Knob scope" below.
- Named density modes (`compact` / `comfortable`) as DTCG token files. The knob is
  a free-form multiplier; discrete modes can be layered on later by a consumer
  writing `[data-density="compact"] { --space-scale: .8 }` in their own CSS.
- Any colour, radius, or typography change.

## Decisions

### Density scope: subtree, via `:root, [data-density]`

A custom property's computed value is its specified value with every `var()`
already substituted, resolved against the element where the property is
*declared* — not where it is later consumed. A block emitted only under `:root`
therefore substitutes `var(--space-scale)` exactly once, against `:root`, and
descendants inherit the finished value. Overriding `--space-scale` on a
descendant does nothing, because `--space-*` was never re-declared there.

This is the identical defect that shipped in the radius layer and is documented
at length in `src/radius/emitDerived.ts`. The fix is the same: re-declare the
block at every scope that can change the knob. Any element carrying
`data-density` gets its own copy and re-substitutes against its own cascade.

### Knob scope: `sp-*` only

`sp-*` and `size-*` are cleanly separated in the current export — nothing
references `{sp-N}`, and the semantic `sizing-icon/control/avatar/touch/container-*`
tokens reference `size-*` exclusively.

The knob multiplies `sp-*` only. `size-*` feeds `sizing-touch-min`, an
accessibility floor; multiplying that by `0.8` in a compact mode would silently
push touch targets under the minimum. Keeping the knob off `size-*` makes that
impossible by construction rather than by a guard that has to be remembered.

### Knob source: hardcoded in the emitter

`--space-scale: 1` is emitted by the generator, not read from a DTCG token.

Everything in `src/tokens/` is overwritten wholesale by the Figma export —
including `manifest.json`, which is how `effects.styles.tokens.json` and its
manifest entry both disappeared in the 2026-08-08 token drop. A hand-authored
token added to any of those files would be destroyed by the next export.

The knob is a CSS API contract rather than a design decision, so the generator
is the honest owner. If a designer later adds a `space-scale` Figma variable,
it can be promoted to a DTCG input without changing the consumer-facing API.

### Naming: `--sp-*` primitive, `--space-*` derived

The base pass already emits `--sp-4: 0.25rem`. A derived block cannot redefine
`--sp-4` as `calc(var(--sp-4) * var(--space-scale))` — that is a self-reference,
and CSS drops the declaration as invalid at computed-value time.

The two layers therefore need distinct names, exactly as radius splits the
primitive `--radius-unit` from the derived `--radius-adaptive-*`:

- **Primitive**, from Figma, unchanged: `--sp-0` … `--sp-124`
- **Derived**, density-aware, what components consume: `--space-0` … `--space-124`

The consuming site does one find-replace, `var(--sp-` to `var(--space-`, and
deletes `_spacing.scss`.

## Architecture

New module `src/spacing/emitDerived.ts`, a sibling of `src/radius/emitDerived.ts`:

```ts
export function emitDerivedSpacingCss(
  steps: string[],
  selector = ":root, [data-density]",
): string
```

`steps` holds full primitive token names as they appear in the DTCG source —
`["sp-0", "sp-2", "sp-4", …]`, not bare numbers. The derived name is formed by
replacing the leading `sp-` with `space-`, so `sp-24` yields `--space-24`
referencing `var(--sp-24)`. A step whose name does not start with `sp-` is a
programming error and should throw rather than emit a malformed declaration.

The step list is discovered from the `primitives-dimension` collection named in
`manifest.json`. Reading it instead of hardcoding means a new step added in Figma
flows through with no code change, and the `sp-124` / `sp-128` discrepancy
resolves itself rather than becoming a constant to maintain.

The function returns **both** blocks shown under "Output" below — the `:root`
knob default and the derived block — as a single string, because they must stay
adjacent and are meaningless apart. Callers append it verbatim.

The function is pure — it takes the step list and returns a string. Discovery
lives in `src/build/buildTokens.ts`, which already parses the manifest, so the
emitter stays trivially testable with no filesystem access.

`buildTokens.ts` appends the result alongside the existing radius call at the
tail of the CSS accumulator (currently line 194). Ordering relative to the
radius block is irrelevant; the two emit disjoint property names.

## Output

```css
:root {
  --space-scale: 1; /* global density knob */
}

:root, [data-density] {
  /* Derived spacing layer — generated from src/spacing/emitDerived.ts */
  --space-0: calc(var(--sp-0) * var(--space-scale));
  --space-2: calc(var(--sp-2) * var(--space-scale));
  --space-4: calc(var(--sp-4) * var(--space-scale));
  /* … through --space-124 */
}
```

Two details are load-bearing:

**`--space-scale: 1` sits in its own `:root` block, deliberately not in the
shared block.** The shared block is re-declared at *every* `[data-density]`
scope — that is the whole point of it. If the knob default lived there, every
element carrying a bare `data-density` would re-declare `--space-scale: 1` on
itself, resetting any density inherited from an ancestor. "Re-resolve spacing
at this scope" would silently also mean "reset density to 1".

Verified in Chromium against both layouts:

| | own `:root` block | folded into shared block |
|---|---|---|
| `[data-density="compact"]` | 12.8px | 12.8px |
| bare `data-density` nested inside compact | 12.8px | **16px** |
| bare `data-density` nested inside inline `0.5` | 8px | **16px** |

Note what is *not* the reason. Specificity tie-breaking does not enter into it:
`[data-density]` and a consumer's `[data-density="compact"]` do tie at 0,1,0,
but on a tie the *later* rule wins, and a consumer stylesheet loads after the
generated one — so a consumer override survives in both layouts (row 1). An
earlier draft of this spec had that backwards and cited the tie as the
justification; the real defect is the inherited-density reset in rows 2 and 3.

**`--sp-0` is emitted as `0rem`, not `0`,** so `calc(0rem * var(--space-scale))`
stays valid. The unit contract already guarantees this; no special-casing needed
for the zero step.

## Testing

### `src/spacing/emitDerived.test.ts`

Text-level, mirroring `src/radius/emitDerived.test.ts`:

1. Default selector is exactly `:root, [data-density]`, carrying the comment that
   explains why `:root` alone is inert.
2. Exactly one `--space-N` per `sp-N` step passed in — nothing silently dropped.
3. Every declaration **in the derived block** is pure `var()` references, no
   literal numbers. Reference names contain digits, so strip `var(--…)` before
   checking, as the radius test does. The assertion must be scoped to the second
   block only — `--space-scale: 1` in the `:root` block is a literal by design,
   and a whole-output check would fail on it.
4. A step name not prefixed `sp-` throws.
5. A custom selector argument is honoured, and applies to the derived block —
   the `:root` knob-default block is not affected by it.

### `src/spacing/render.test.ts`

Text assertions structurally cannot observe cascade or substitution behaviour.
That blind spot is precisely how the radius `:root`-only bug shipped. This gate
builds the real stylesheet, loads it in Chromium, and asserts on
`getComputedStyle`, reusing the `launchChromium` fallback helper from
`src/radius/render.test.ts`.

1. A bare element resolves `padding: var(--space-16)` to `16px`.
2. A **nested** `<div data-density style="--space-scale:.8">` resolves it to
   `12.8px`. This is the direct analogue of the radius regression: without the
   `[data-density]` half of the selector it returns `16px` — textually perfect
   output, behaviourally dead.
3. A **bare** `<div data-density>` nested inside a scaled ancestor keeps the
   ancestor's density rather than resetting to 1. This is the case that fails
   if `--space-scale: 1` is ever folded into the shared block — it renders
   16px instead of 12.8px. A consumer-override test does *not* gate that
   decision, because the override survives either layout.
4. A deeper scope can still deliberately reset density by declaring its own
   `--space-scale`.

The `launchChromium` helper is currently private to `src/radius/render.test.ts`.
Implementation should lift it into a shared test helper rather than copy it —
copying a module out of its home is the drift this repo has already been bitten
by twice.

## Documentation

`README.md` gains a `## Spacing` section after `## Radius`, describing the
two-layer split and the `[data-density]` scoping rule.

The README has also drifted from the 2026-08-08 token drop, independently of
this work. Corrected as part of this change:

| README currently says | Export actually has |
|---|---|
| `primitives-dimension` holds the `space-*` / `size-*` scale | `sp-*` / `size-*` |
| `dimension` holds semantic spacing (`spacing-layout-stack-md`, …) | only `sizing-*`; no `spacing-*` exists |
| `styles` includes `effects.styles.tokens.json` (shadow tokens) | file and manifest entry both deleted |

The effects correction was confirmed intentional by the user; the shadow tokens
are not coming back in a later export.

## Migration for the consuming site

1. Rebuild tokens, pull in the new `dist/css/tokens.css`.
2. Find-replace `var(--sp-` to `var(--space-`.
3. Delete `_spacing.scss`.
4. Optionally define named modes in site CSS:
   `[data-density="compact"] { --space-scale: .8 }`.

Step 2 must not be applied to `--sp-*` occurrences that are *definitions* — there
are none in the site once step 3 lands, but ordering matters if the steps are
done out of sequence.

## Risks

- **A future Figma export renames or removes `sp-*` steps.** The derived layer
  follows automatically because the step list is read, not hardcoded — but any
  site CSS referencing a removed `--space-N` breaks silently. The existing
  `npm run check:token-drift` is the intended detector; confirm it covers the
  `sp-*` family during implementation.
- **`--space-scale` set to a non-numeric value** produces an invalid `calc()` and
  the declaration is dropped, falling back to inherited values. Not guarded; CSS
  offers no mechanism to, and the failure is loud in devtools.
