# Fluid Typography — Design Rationale

## Problem

Our design token pipeline exports static typography values from Figma (font sizes, line heights, weights, etc.) and transforms them into CSS custom properties and SCSS mixins via Style Dictionary. These values are fixed — a heading is always 54px regardless of screen size.

Fluid typography uses CSS `clamp()` to smoothly interpolate font sizes between a minimum and maximum value across a viewport range. This creates a responsive, proportional type scale without hard breakpoints.

**Figma can't express computational tokens** like `clamp()`. The min/max relationship between sizes and viewports is an engineering concern that lives outside Figma's variable system. We needed a way to author these relationships and bundle them with the theme.

## Solution Overview

A three-part system:

1. **Config file** (`src/fluid-typography.config.json`) — where design engineers define the fluid scale
2. **Build pipeline extension** (`src/fluid/`) — generates SCSS mixins with `clamp()` values
3. **Preview tool** (`tools/fluid-preview/`) — visual authoring and validation

```
fluid-typography.config.json  ──→  buildFluidMixins.ts  ──→  fluid-typography-mixins.scss
        │                              │
        │                              ├── resolveConfig.ts (token ref → px)
        │                              └── generateClamp.ts (px → clamp())
        │
        └──→  preview tool (Vite app for visual composition)
```

## Key Design Decisions

### 1. Config file, not token extensions

We considered embedding fluid metadata directly in the DTCG tokens via `$extensions`. We chose a **separate config file** because:

- DTCG doesn't have a standard for computational relationships between tokens
- Figma exports would overwrite custom extensions on every sync
- A separate file makes the fluid layer explicit and independently versionable
- The config uses familiar `{token-ref}` syntax, so it feels native to the token ecosystem

### 2. Token references for fontSize, raw values allowed

Font size values in the config use the `{token-name}` reference syntax:

```json
"fontSize": {
  "min": "{font-size-500}",
  "max": "{font-size-1300}"
}
```

- **`max` should always reference a token** — this is the "design intent" size from Figma. If the token value changes, the fluid mixin picks it up automatically.
- **`min` can be a token or raw px** (`"18px"`) — the mobile size often doesn't have a corresponding token since Figma doesn't define it. Raw values are the escape hatch.

At build time, token references are resolved to pixel values by reading the primitives file. This keeps the config readable while producing correct `clamp()` math.

### 3. Unitless line-height (not clamped)

Line-height uses a **unitless number** (e.g., `1.2`), not a clamped px/rem range.

```json
"lineHeight": 1.2
```

Rationale:

- **CSS best practice**: `line-height: 1.2` means "1.2x the computed font-size" — it automatically tracks the fluid font-size
- **Simpler to author**: one number vs. a min/max range with token references
- **Predictable ratios**: clamped line-height scales at a different rate than font-size, causing unpredictable spacing at intermediate viewports
- **Maintenance**: changing a font-size range doesn't require recalculating line-height

For the rare case of intentional ratio shifts (e.g., tighter leading at large display sizes in editorial typography), the config also accepts a `{ "min": 1.4, "max": 1.2 }` range that interpolates the unitless ratio across viewports.

### 4. Coexisting static and fluid mixins

The build produces **two separate SCSS files**:

- `typography-mixins.scss` — static mixins using `var()` references (existing, unchanged)
- `fluid-typography-mixins.scss` — fluid mixins using `clamp()` for font-size

They coexist because:

- Not all styles need fluid behavior (UI styles like `ui-primary-sm` should stay static)
- Consumers can choose which to use
- Existing consuming code is not broken

### 5. Build-time name validation

The build validates that every style name in the fluid config matches a key in `typography.styles.tokens.json`. On mismatch, it warns:

```
⚠️  Fluid config has style names not found in typography tokens: heading-display
   Available token names: display-lg, display-md, heading-3xl, ...
```

This catches typos and naming drift between the fluid config and the token source of truth. The build still succeeds — unmatched styles get font-size/line-height only (no `var()` for font-family, weight, etc.).

### 6. The `fontFamily` field is preview-only

The config supports an optional `fontFamily` field per style:

```json
"fontFamily": "\"Test Signifier VF\", Georgia, serif"
```

This is **only used by the preview tool** to render the specimen with the correct font. The build pipeline ignores it — fluid mixins get their `font-family` from the composite typography tokens via `var()` references, keeping the token system as the single source of truth for static properties.

### 7. Standalone preview tool

The preview tool lives in `tools/fluid-preview/` with its own `package.json` and Vite config. It installs and runs independently of the build pipeline because:

- The main project has no dev server — adding one would pollute the token pipeline's dependency footprint
- Designers/design engineers can use it without understanding Style Dictionary
- It can be run, shared, or deployed independently

Its dependencies are separate, but its *math* is not: the preview imports `generateClamp.ts` and `resolveConfig.ts` from `src/fluid/` through the `@project` Vite alias, so the specimen on screen and the emitted `clamp()` cannot drift apart.

## The Clamp Formula

```
clamp(minRem, interceptRem + slopeVw, maxRem)
```

Where:
- `slope = (maxPx - minPx) / (maxViewport - minViewport)`
- `intercept = minPx - slope * minViewport`
- `slopeVw = slope * 100` (convert to vw units)
- `interceptRem = intercept / baseFontSize`

This produces a linear interpolation between `minPx` at the minimum viewport and `maxPx` at the maximum viewport. Below the min viewport, the font locks to `minRem`. Above the max viewport, it locks to `maxRem`.

Example for `display-lg` (36px → 54px across 320px → 1440px):

```scss
font-size: clamp(2.25rem, 1.9286rem + 1.6071vw, 3.375rem);
```

## File Structure

```
src/
  fluid-typography.config.json    # Fluid scale definition
  fluid/
    generateClamp.ts              # Pure clamp() formula
    resolveConfig.ts              # Token ref → px resolution (pure)
    loadConfig.ts                 # Reads config + primitives, calls resolveConfig
    buildFluidMixins.ts           # SCSS generation + validation
  build/
    buildTokens.ts                # Calls buildFluidMixins after Style Dictionary
tools/
  fluid-preview/
    public/fonts/                 # Drop .woff2 files here
    src/
      fonts.css                   # @font-face declarations
      main.ts                     # App entry — imports generateClamp.ts and
                                  #   resolveConfig.ts from src/fluid via @project
      styles.css                  # Preview UI styles
    index.html
    package.json
    vite.config.ts
dist/
  scss/
    typography-mixins.scss        # Static (existing)
    fluid-typography-mixins.scss  # Fluid (new)
```

## Usage

### Build

```bash
npm run build:tokens
# Produces dist/scss/fluid-typography-mixins.scss
```

### Preview tool

```bash
npm run preview:fluid
# Opens http://localhost:5173 with live type specimen
```

### Consuming in a project

```scss
@use "theme/fluid-typography-mixins" as *;

.hero-title {
  @include display-lg;
}
```
