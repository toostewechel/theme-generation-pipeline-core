# theme-generation-pipeline-core

Transforms DTCG design tokens into CSS custom properties and SCSS mixins
using Style Dictionary v5.

## Quickstart

```bash
npm install
npm run build:tokens     # → dist/css/tokens.css, dist/scss/*.scss
npm test
```

Preview tools are separate Vite apps with their own dependencies, so each needs
its own install before its first run:

```bash
(cd tools/fluid-preview && npm install)
npm run preview:fluid    # fluid typography configurator

(cd tools/radius-preview && npm install)
npm run preview:radius   # radius scale configurator
```

## The pipeline

`src/tokens/manifest.json` declares collections and their modes.
`src/build/buildTokens.ts` reads it and runs a separate Style Dictionary build
per mode, then concatenates the results into one stylesheet.

The separation exists because **token names repeat across the modes of a
collection**. `color.light.tokens.json` and `color.dark.tokens.json` define the
same 77 names; all four radius mode files define `radius-intensity`. A single
Style Dictionary pass over every file would collide on those names and the
last file loaded would win. So each mode gets its own pass, sourced from the
shared base files plus that one mode's file, emitted under its own selector,
and the fragments are joined into `dist/css/tokens.css`. The per-pass temp
files are deleted afterwards.

The passes, in output order:

| Pass | Selector | Sources | Output filtered to |
|---|---|---|---|
| Base | `:root` | every single-mode collection, both `styles` files, `color` light, `radius` default | everything |
| Dark colour | `[data-color-mode='dark']` | base + `color.dark` | tokens from `color.dark.tokens.json` |
| Radius × 4 | `[data-radius-mode='<mode>']` | base + `radius.<mode>` | tokens from `radius.<mode>.tokens.json` |
| Derived radius | `:root, [data-radius-mode]` | not a Style Dictionary pass — see [Radius](#radius) | — |

Two consequences of that shape:

- **`:root` carries a working default theme.** `color` light and `radius` default
  are folded into the base pass, so a consumer that sets no attributes still gets a
  complete stylesheet. Light colour gets no selector of its own; `default` radius
  does, because the radius loop runs over all four modes unconditionally — so
  `--radius-intensity: 1` is declared twice, in `:root` and again in
  `[data-radius-mode='default']`. Do not "clean up" that duplicate: `:root`
  matches only the root element, so `[data-radius-mode='default']` is what lets
  a subtree nested inside `[data-radius-mode='pill']` reset itself back to
  default. This genuinely matters, not just in theory: the derived radius layer
  (see [Radius](#radius)) is re-declared on every `[data-radius-mode]` element,
  including ones set to `default`, and it substitutes whatever
  `--radius-intensity` is in scope on that same element. Delete the `default`
  duplicate and a nested `[data-radius-mode='default']` subtree would have no
  `--radius-intensity` of its own to substitute — it would inherit `pill`'s
  `9999` instead of resetting to `1`, and every `--radius-adaptive-*` /
  `--radius-geometric-*` value in that subtree would follow.
- **Mode passes are sourced wide and filtered narrow.** They load the base
  files so `{token}` references resolve, then filter the emitted output down to
  the mode's own tokens. That is why the dark block is 77 declarations — the
  semantic colour layer only — rather than a second copy of the 130-swatch
  primitive palette.

`outputReferences: true` is on for every pass, so semantic tokens emit as
`var()` chains rather than flattened values (`--spacing-layout-stack-md:
var(--space-4)`). Overriding a primitive at runtime therefore propagates to
everything referencing it.

After the CSS passes, two SCSS files are generated:

- A Style Dictionary pass over the base files using the custom
  `scss/typography-mixins` format (`src/formatters/typographyMixins.ts`), which
  turns each composite `$type: typography` token into an `@mixin` of `var()`
  references.
- `buildFluidTypographyMixins` (`src/fluid/`), which is not a Style Dictionary
  pass at all — it has its own generator. See
  [Fluid typography](#fluid-typography).

Three files come out:

| File | Contents |
|---|---|
| `dist/css/tokens.css` | All custom properties: `:root`, `[data-color-mode='dark']`, four `[data-radius-mode='…']` blocks, then the derived radius `:root, [data-radius-mode]` block |
| `dist/scss/typography-mixins.scss` | One `@mixin` per composite typography token, all values `var()` references |
| `dist/scss/fluid-typography-mixins.scss` | The same mixins with `clamp()` font-sizes and unitless line-heights |

`buildTokens.ts` also carries a code path for a `border` collection with
`default`/`bold` modes. The manifest declares no such collection, so that path
emits nothing today; border modes are latent, not a shipping feature.

`scripts/buildTokens.ts` is an 18-line CLI wrapper — it parses
`--no-descriptions`, prints the output paths, and sets the exit code. All build
logic is in `src/build/buildTokens.ts`, exported as `buildTokens(options)` so
`src/build/buildTokens.test.ts` can call it directly and assert the emitted
output contract.

## Token architecture

Tokens use the DTCG format: `$type`, `$value`, and an optional `$description`.
References use curly braces — `"$value": "{font-size-1100}"`. Token files are
flat maps of token name to token; there are no nested groups.

| Collection | Modes | Holds |
|---|---|---|
| `primitives-color` | `mode-1` | The raw palette — neutral, brand, accent and semantic ramps, alpha variants |
| `color` | `light`, `dark` | Semantic colour referencing the primitives |
| `primitives-font` | `mode-1` | Font families, weights, sizes, line heights, letter spacings |
| `typography` | `mode-1` | Per-style typography properties (`typography-display-xl-font-size`, …) |
| `primitives-dimension` | `mode-1` | The `space-*` / `size-*` scale |
| `dimension` | `mode-1` | Semantic spacing (`spacing-layout-stack-md`, …) |
| `primitives-radius` | `mode-1` | `radius-unit`, `radius-scale-*`, `radius-cap-*`, `radius-none`, `radius-full` |
| `radius` | `sharp`, `default`, `rounded`, `pill` | One `radius-intensity` value per mode |

The manifest also has a `styles` block, always folded into the base pass:
`typography.styles.tokens.json` (composite `$type: typography` tokens, the
source of the SCSS mixins) and `effects.styles.tokens.json` (shadow tokens
`brand-low|medium|high`, `neutral-low|medium|high`).

Naming follows two shapes:

- Primitives: `{category}-{scale}` — `color-neutral-500`, `font-size-1300`,
  `space-4`
- Semantic: `{category}-{context}-{variant}` — `color-control-border-error`,
  `spacing-layout-stack-md`

Names reach CSS through `name/kebab` and a numeric-aware sort, so
`--color-accent-50` precedes `--color-accent-100` instead of sorting
lexicographically after it.

Primitive colours carry DTCG object values — a `colorSpace`, a `components`
array normalised to 0–1, and an optional `alpha`. The `oklch/css` transform in
`src/transforms/oklchColor.ts` converts those through culori, clamps chroma
into the P3 gamut, and emits `oklch(L C H)` or `oklch(L C H / A)`.

**Colour tokens are static inputs.** This repo contains no colour generator;
the token files are the source of truth and are typically overwritten from a
Figma export. To change colours, edit the JSON and rebuild.

## The dimension unit contract

Every `dimension` token is emitted in `rem`, converted from its authored `px` value at
`basePxFontSize: 16`. Two escape hatches, both keyed on `$description`:

| `$description` | Output | Used for |
|---|---|---|
| *(none)* | `rem` | sizes, spacing, radius primitives |
| `"unitless"` | bare number | `--radius-scale-*`, `--radius-intensity`, `--color-state-*-intensity`, `--color-state-disabled-opacity` |
| `"em"` | `em` | `--font-letter-spacing-*` |

`$description` carries the unit override because DTCG has no per-token unit
field, and because Figma round-trips `$description` on export — so the marker
survives a token re-export. Any other `$description` value is just a comment
in the output (`/** … */`), which `npm run build:tokens-nd` suppresses.

The rule is absolute, including where it looks odd: `radius-full` is authored
as `9999px` and ships as `624.9375rem`, and the offsets inside the `effects`
shadow tokens are in `rem` too.

**Transform order in `src/transforms/cssPlatform.ts` is load-bearing.** `dimension/em`
must run before `dimension/css`; `dimension/unitless` must run last.

**Never add Style Dictionary's built-in `size/rem` transform.** Despite the name it
does not convert px to rem — it reads a *unitless* number as a rem count, and for a
DTCG dimension carrying an explicit unit it returns that value with its original unit
as a string. `dimension/css` short-circuits on string input, so adding `size/rem`
silently disables px→rem conversion for every dimension token in the repo, with no
error: no warning, no failed build, just an entire stylesheet quietly reverted to px.
It cost a full debugging session to find. `src/transforms/cssPlatform.test.ts` now
guards the transform list against it, alongside the two ordering rules.

## Radius

Radius ships as two layers.

The **primitive layer** comes from the DTCG tokens. `:root` gets
`--radius-unit`, `--radius-scale-xs…xl` (unitless multipliers),
`--radius-cap-xs…xl` (rem ceilings), plus `--radius-none` and `--radius-full`.
Each `[data-radius-mode='…']` block then sets exactly one property:

```css
[data-radius-mode='pill'] { --radius-intensity: 9999; }
```

The **derived layer** is the API components actually consume, and
`src/radius/emitDerived.ts` writes it under `:root, [data-radius-mode]` — one
block, but with a selector that matches `:root` *and* any element carrying a
`data-radius-mode` attribute:

```css
:root, [data-radius-mode] {
  --radius-base: calc(var(--radius-unit) * var(--radius-intensity));
  --radius-adaptive-md: calc(var(--radius-base) * var(--radius-scale-md));
  --radius-geometric-md: min(calc(var(--radius-base) * var(--radius-scale-md)), var(--radius-cap-md));
  /* …xs, sm, lg, xl */
}
```

A custom property's *computed value* is its specified value with `var()`
already substituted, resolved against the element on which the property is
**declared** — not the element that later consumes it. That matters here
because it means a single `:root`-only emission does **not** work for nested
modes: if `--radius-base` were declared only on `:root`, it would substitute
`var(--radius-intensity)` exactly once, against `:root`'s value, and every
descendant would simply inherit that already-resolved number. An element
deeper in the tree that overrides `--radius-intensity` (via
`[data-radius-mode="pill"]`) would have no effect on `--radius-base`, because
`--radius-base` was never re-declared — and therefore never re-substituted —
on that element. Measured in a real browser against a `:root`-only emission:
a `[data-radius-mode="pill"]` wrapper nested under the document root produced
the *same* `4px` `border-radius` as no mode attribute at all — the override
was silently ignored. Mode switching only worked when set on the root
element itself.

The fix is to re-declare the block at every scope that can change
`--radius-intensity`, not just at `:root`. `:root, [data-radius-mode]` does
that: any element carrying the attribute — regardless of its value,
including `default` (see the note on the `default` duplicate above) — gets
its own copy of `--radius-base` and everything derived from it, substituting
`var(--radius-intensity)` freshly against its own cascade. An element with no
`data-radius-mode` attribute of its own needs no declaration of its own: it
correctly inherits the finished values from the nearest ancestor that has
one, or from `:root` if there is none. Computing the arithmetic at build time
instead would avoid the repetition, but would freeze the values — losing
both the runtime mode switch and the ability to nest one mode inside
another.

Which layer a component uses is a component-authoring decision, fixed at
author time and not varied by theme:

| Token family | Behaviour | Use for |
|---|---|---|
| `--radius-adaptive-*` | Scales without limit | Buttons, badges, avatars, tags, chips — anything that should become a capsule in `pill` mode |
| `--radius-geometric-*` | Capped by `--radius-cap-*` to preserve shape | Cards, dialogs, containers, dropdowns — anything that would distort into an oval at high intensity |

`tools/radius-preview` imports `emitDerivedRadiusCss` from the same module the
build uses, so the preview and the shipped CSS cannot disagree about the
formulas.

See [docs/radius-system-rationale.md](docs/radius-system-rationale.md).

## Fluid typography

`src/fluid-typography.config.json` declares the fluid scale: a `baseFontSize`,
a global `viewports` range, and a `styles` map whose keys are expected to match
the composite token names in `typography.styles.tokens.json`. Per style:

- `fontSize.min` / `fontSize.max` — either a raw px string (`"36px"`, which is
  what the config uses today) or a `{token-name}` reference resolved against
  `primitives-font.*.tokens.json`
- `lineHeight` — optional, unitless: a number (`1.1`), or `{ "min": …, "max": … }`
  to interpolate the ratio itself across the viewport range
- `viewports` — optional per-style override of the global range
- `fontFamily` — read only by the preview tool, ignored by the build

`src/fluid/` turns that into `dist/scss/fluid-typography-mixins.scss`, split
four ways:

| Module | Role |
|---|---|
| `generateClamp.ts` | Pure math — `clamp(minRem, interceptRem + slopeVw, maxRem)`, the unitless variant for line-height ratios, and `interpolateAtViewport` for the preview |
| `resolveConfig.ts` | Pure — `buildTokenLookup` and `resolveConfig` turn token references into pixel numbers. No `fs` import |
| `loadConfig.ts` | The filesystem half — reads the config, globs the primitives files, hands a flat object to the pure resolver |
| `buildFluidMixins.ts` | Writes the SCSS: `clamp()` for font-size, the unitless value for line-height, `var()` references for family, weight and letter-spacing pulled from the composite typography token |

The pure/`fs` split is deliberate. The preview tool has to run the *same* clamp
math in the browser, where `fs` does not exist, so it imports `generateClamp.ts`
and `resolveConfig.ts` directly and does its own loading. Keeping the pure
core importable is what stops a second copy of the formula existing in
`tools/` — which is exactly how the clamp math drifted before.

The build is forgiving by design: a missing config file makes it a silent
no-op, and a style name with no matching composite token produces a warning
plus a font-size/line-height-only mixin rather than a failure.

See [docs/fluid-typography-rationale.md](docs/fluid-typography-rationale.md).

## Preview tools

Two standalone Vite apps, each with its own `package.json` and lockfile. They
are separate installs on purpose — the root project has no dev server, and
keeping it that way stops browser tooling from entering the token pipeline's
dependency footprint.

Each `vite.config.ts` aliases `@project` to the repository root and adds it to
`server.fs.allow`. The apps therefore import shared modules as
`@project/src/…` and pull token JSON straight out of `src/tokens/` via
`import.meta.glob`. Nothing is copied or vendored.

| Tool | Reads | Shares |
|---|---|---|
| `tools/fluid-preview` | `src/fluid-typography.config.json`, `primitives-font.*.tokens.json` | `src/fluid/generateClamp.ts`, `src/fluid/resolveConfig.ts` |
| `tools/radius-preview` | `primitives-radius.*.tokens.json`, `radius.*.tokens.json` | `src/radius/compute.ts`, `src/radius/emitDerived.ts` |

Both open on Vite's default port and both are read-only explorers: they render
live specimens as you move the sliders, but they never write token files. A
value you settle on gets typed back into the token JSON or the fluid config by
hand.

`tools/fluid-preview` renders specimens in the real typeface if you drop
`.woff2` files into `tools/fluid-preview/public/fonts/`; without them it falls
back to system fonts.

## Token name-drift check

```bash
npm run check:token-drift                          # HEAD → working tree
npm run check:token-drift -- --base <ref>          # <ref> → working tree
npm run check:token-drift -- --base <ref> --head <ref>
npm run check:token-drift -- --json
```

The check compares DTCG token *names* between two sources — a git revision, or
the working tree. It reads `manifest.json` at each source, walks every file
listed under `collections`, and unions the names across all modes. The
`styles` block is deliberately not walked.

Added names are safe. **Removed** names are renames or deletions, and they
break every consumer referencing them — that is the whole point of the check.

| Exit | Meaning |
|---|---|
| 0 | No names removed |
| 1 | At least one name removed |
| 2 | Misconfigured — a ref that will not resolve, or no `manifest.json` at either source |

`scripts/token-drift.ignore.json` holds ignore patterns as a JSON array of
exact names or `/regex/` strings; matches are excluded from both the added and
removed lists. It is currently empty.

The intended use is right after overwriting token files from a Figma export
and before committing, while the previous names are still one `git show` away.

## Repo layout

```
src/
  build/buildTokens.ts        # the build — manifest → per-mode passes → dist/
  formatters/                 # scss/typography-mixins format
  transforms/cssPlatform.ts   # transform list + unit config (order matters)
  transforms/oklchColor.ts    # DTCG colour → oklch() css
  radius/                     # compute.ts (pure) + emitDerived.ts (css layer)
  fluid/                      # generateClamp, resolveConfig (pure) + loadConfig, buildFluidMixins
  drift/token-drift.ts        # name walker + diff (pure, reader injected)
  tokens/                     # DTCG sources + manifest.json
  fluid-typography.config.json
scripts/                      # CLI entry points: argv, git/fs readers, exit codes
tools/                        # fluid-preview, radius-preview (own installs)
docs/                         # design rationale for radius and fluid typography
dist/                         # generated, gitignored
```

Tests live beside their source as `*.test.ts` and run under Vitest via
`npm test`. Sources are ESM and import each other with `.js` specifiers even
though the files are `.ts`.

`Style Dictionary Utils.md` at the repository root is a vendored copy of the
[style-dictionary-utils](https://github.com/lukasoppermann/style-dictionary-utils)
README, kept as an offline reference for the transforms and formats that
package provides.
