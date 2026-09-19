# Theme generation pipeline

This project turns a list of design choices into files a website can use.

Those choices include colours, text sizes, spacing, and how round corners should be. Each choice has a name and a value. We call that a **design token**. For example, a token might say “medium icons are 24 pixels wide.”

Instead of typing the same values throughout a website, you use those names. Change a value in the source files, rebuild, and the website can use the updated design.

The basic flow is:

```text
Design choices in JSON files → Build command → CSS and SCSS files for a website
```

## Get started

You need Node.js and npm installed. Open a terminal in this project’s folder, then run:

```bash
npm install
npm run build:tokens
npm test
```

These commands install the project’s tools, generate the website files, and check that everything works.

Some tests open an invisible browser to check how the styles actually look to the browser. If the tests say no browser is available, install one and try again:

```bash
npx playwright install chromium
npm test
```

## What you get

The build puts its results in `dist/`:

| File | What it gives you |
|---|---|
| `dist/css/tokens.css` | Named CSS values for colours, spacing, sizes, corners, and more |
| `dist/scss/typography-mixins.scss` | Reusable text styles for Sass projects |
| `dist/scss/fluid-typography-mixins.scss` | Text styles whose sizes smoothly adjust as the browser gets wider or narrower |

CSS is what a browser uses to style a page. SCSS is a format that Sass turns into CSS. A **mixin** is a named bundle of styles you can reuse.

Load the generated CSS in your website before your own styles. You can then use its values like this:

```css
.card {
  padding: var(--space-16);
  border-radius: var(--radius-geometric-md);
}
```

Here, `var(...)` means “use the value with this name.”

**Edit the source files, then rebuild.** Files in `dist/` are generated and will be replaced by the next build.

## Where to make changes

| I want to change… | Where to look |
|---|---|
| Colours, spacing, sizes, fonts, or corner settings | JSON files in [`src/tokens/`](src/tokens/) |
| Which token files and theme modes are included | [`src/tokens/manifest.json`](src/tokens/manifest.json) |
| How text grows and shrinks with the screen | [`src/fluid-typography.config.json`](src/fluid-typography.config.json) |

The **manifest** is the build’s shopping list: it tells the build which files to read.

Many token files come from Figma exports. This project reads those files; it does not invent a colour palette for you. After editing or replacing them, run:

```bash
npm run build:tokens
npm test
```

To generate CSS without the token description comments, use `npm run build:tokens-nd`.

## How the design choices fit together

There are two kinds of token:

- **Basic values**, such as a blue colour or a spacing size. The code calls these “primitives.”
- **Values with a job**, such as the border colour for an error. These can refer to a basic value instead of repeating it.

Token files use a shared format called DTCG. You mainly need to recognise three fields: `$type` says what kind of value it is, `$value` holds the value, and `$description` adds a note. A value like `{font-size-1100}` means “use the token named `font-size-1100`.”

The build uses a tool called Style Dictionary to turn those tokens into CSS. Most sizes are converted from pixels to `rem`, using 16 pixels as the starting font size. This lets sizes follow the website’s root font size. Some special tokens stay as plain numbers or use `em`; the [technical guide](docs/technical-guide.md#the-dimension-unit-contract) explains those rules.

## Light and dark themes

The included theme has light and dark colours. Light is the default. Once the generated stylesheet is loaded, you can choose dark mode on the page:

```html
<html data-color-mode="dark">
```

The build keeps each mode’s values separate so the dark colours do not overwrite the light colours.

Mode names and filenames follow specific rules. For example, dark colours belong in `color.dark.tokens.json`. Adding a new mode takes a code change as well as a new token file. Check the [supported names and filenames](docs/technical-guide.md#what-the-build-recognises) before changing the manifest: unsupported names can leave values out of the result.

## Round corners

There are four corner modes: `sharp`, `default`, `rounded`, and `pill`.

You can apply a mode to the whole page or to part of it:

```html
<section data-radius-mode="pill">
  <!-- Elements using the radius tokens follow this mode. -->
</section>
```

Choose the token family that fits the element:

| Token family | What happens | Typical use |
|---|---|---|
| `--radius-adaptive-*` | Corners keep getting rounder as the mode increases | Buttons, badges, and chips |
| `--radius-geometric-*` | Corners get rounder up to a limit | Cards, dialogs, and containers |

The limit keeps a card from turning into an oval. The endings `xs`, `sm`, `md`, `lg`, and `xl` give you different sizes.

You can nest modes, including using `data-radius-mode="default"` inside a pill section to return to normal corners.

## Tighter or roomier spacing

Use `--space-*` tokens for spacing that should respond to a density setting.

The normal spacing scale is `1`. A value of `0.8` makes spacing 80% of its usual size:

```html
<aside data-density style="--space-scale: 0.8">
  <!-- Elements using --space-* tokens have tighter spacing here. -->
</aside>
```

Keep the `data-density` attribute when changing spacing for part of a page. It tells the stylesheet where to recalculate the spacing. To change spacing everywhere, set `--space-scale` on `:root`.

The original `--sp-*` values stay unchanged. The separate `--size-*` values also stay unchanged, so compact spacing does not shrink the size tokens used for minimum touch targets.

## Text that adapts to the screen

“Fluid typography” means text grows smoothly between a minimum and maximum size as the browser gets wider.

In [`src/fluid-typography.config.json`](src/fluid-typography.config.json), you choose the smallest and largest text sizes, plus the screen widths between which they should grow. The build turns those settings into reusable SCSS mixins.

For a closer look at the calculations, see the [fluid typography notes](docs/fluid-typography-rationale.md).

## Try changes visually

Two small preview apps let you explore text sizes and corner shapes with sliders. Each needs its own install the first time you use it.

For text:

```bash
(cd tools/fluid-preview && npm install)
npm run preview:fluid
```

For corners:

```bash
(cd tools/radius-preview && npm install)
npm run preview:radius
```

Open the local address printed in the terminal. The previews use the same calculations as the build.

**The previews do not save changes.** Once you like a setting, copy the values into the token JSON or fluid typography config yourself, then rebuild.

To preview your actual fonts, place `.woff2` font files in `tools/fluid-preview/public/fonts/`. Otherwise, the text preview uses system fonts.

## Check for renamed or missing tokens

A website may already rely on a token’s name. Removing or renaming it can break styles that still use the old name.

After replacing token files with a Figma export, run:

```bash
npm run check:token-drift
```

This compares the token names in your working files with the latest commit. New names are fine; removed names are flagged for you to review. It checks names in the manifest’s collections, not changes to their values or entries in its separate `styles` block.

To compare against a particular commit, branch, or tag:

```bash
npm run check:token-drift -- --base <ref>
```

Replace `<ref>` with the revision you want to compare against. More options are in the [technical guide](docs/technical-guide.md#token-name-drift-check).

## Find your way around

| Folder | What is inside |
|---|---|
| `src/tokens/` | The original design choices and manifest |
| `src/build/` | The code that runs the build |
| `src/transforms/` | Rules for converting values into CSS |
| `src/radius/`, `src/spacing/`, `src/fluid/` | Calculations for corners, spacing, and responsive text |
| `scripts/` | Entry points for terminal commands |
| `tools/` | The two preview apps |
| `docs/` | Detailed explanations for maintainers |
| `dist/` | Generated files to use in a website |

If you are changing how the build works, read the [technical guide](docs/technical-guide.md). It covers the build order, naming rules, browser behaviour, and tests that protect against past bugs.
