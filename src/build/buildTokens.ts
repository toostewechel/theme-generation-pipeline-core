import { StyleDictionary } from "style-dictionary-utils";
import { readFileSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { typographyMixinsFormat } from "../formatters/typographyMixins.js";
import { buildFluidTypographyMixins } from "../fluid/buildFluidMixins.js";
import { emitDerivedRadiusCss } from "../radius/emitDerived.js";
import { oklchCssTransform } from "../transforms/oklchColor.js";
import {
  cssPlatformConfig,
  dimensionEmTransform,
  dimensionUnitlessTransform,
} from "../transforms/cssPlatform.js";

interface Manifest {
  collections: { [collectionName: string]: { modes: { [modeName: string]: string[] } } };
  styles: { [styleName: string]: string[] };
}

StyleDictionary.registerTransform(dimensionUnitlessTransform);
StyleDictionary.registerTransform(dimensionEmTransform);
StyleDictionary.registerTransform(oklchCssTransform);
StyleDictionary.registerFormat(typographyMixinsFormat);

const naturalSort = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true });

export interface BuildTokensOptions {
  showDescriptions?: boolean;
  tokensDir?: string;
  cssOutDir?: string;
  scssOutDir?: string;
}

export interface BuildTokensResult {
  cssPath: string;
  typographyMixinsPath: string;
  fluidMixinsPath: string;
}

export async function buildTokens(
  options: BuildTokensOptions = {},
): Promise<BuildTokensResult> {
  const {
    showDescriptions = true,
    tokensDir = "src/tokens",
    cssOutDir = "dist/css",
    scssOutDir = "dist/scss",
  } = options;

  const formatting = showDescriptions ? {} : { commentStyle: "none" as const };

  const manifest: Manifest = JSON.parse(
    readFileSync(join(tokensDir, "manifest.json"), "utf-8"),
  );

  const baseFiles: string[] = [];
  const colorModes: { [mode: string]: string[] } = {};
  const radiusModes: { [mode: string]: string[] } = {};
  const borderModes: { [mode: string]: string[] } = {};

  for (const collectionName of Object.keys(manifest.collections)) {
    const collection = manifest.collections[collectionName];
    const modes = Object.keys(collection.modes);
    const target =
      collectionName === "color" && modes.length > 1 ? colorModes
      : collectionName === "radius" && modes.length > 1 ? radiusModes
      : collectionName === "border" && modes.length > 1 ? borderModes
      : null;

    if (target) {
      for (const mode of modes) {
        target[mode] = collection.modes[mode].map((f) => join(tokensDir, f));
      }
    } else {
      for (const mode of modes) {
        baseFiles.push(...collection.modes[mode].map((f) => join(tokensDir, f)));
      }
    }
  }

  for (const styleName of Object.keys(manifest.styles)) {
    baseFiles.push(...manifest.styles[styleName].map((f) => join(tokensDir, f)));
  }

  mkdirSync(cssOutDir, { recursive: true });
  mkdirSync(scssOutDir, { recursive: true });

  const tempFiles: string[] = [];
  let cssOutput =
    "/**\n * Do not edit directly, this file was auto-generated.\n */\n\n";

  /** Build one Style Dictionary pass and append its CSS to the accumulator. */
  async function emit(
    source: string[],
    destination: string,
    selector: string,
    filter?: (token: any) => boolean,
  ): Promise<void> {
    const sd = new StyleDictionary({
      source,
      log: { verbosity: "silent" },
      platforms: {
        css: {
          ...cssPlatformConfig,
          buildPath: cssOutDir.endsWith("/") ? cssOutDir : `${cssOutDir}/`,
          files: [
            {
              destination,
              format: "css/variables",
              ...(filter ? { filter } : {}),
              options: { outputReferences: true, selector, formatting, sort: naturalSort },
            },
          ],
        },
      },
    });
    await sd.buildAllPlatforms();
    const path = join(cssOutDir, destination);
    cssOutput += readFileSync(path, "utf-8").replace(/\/\*\*[\s\S]*?\*\/\n\n/, "");
    tempFiles.push(path);
  }

  await emit(
    [
      ...baseFiles,
      ...(colorModes["light"] || []),
      ...(radiusModes["default"] || []),
      ...(borderModes["default"] || []),
    ],
    "_temp_root.css",
    ":root",
  );

  if (colorModes["dark"]) {
    await emit(
      [...baseFiles, ...colorModes["dark"]],
      "_temp_dark.css",
      "[data-color-mode='dark']",
      (token) => token.filePath.includes("color.dark.tokens.json"),
    );
  }

  for (const mode of ["sharp", "default", "rounded", "pill"]) {
    if (!radiusModes[mode]) continue;
    await emit(
      [...baseFiles, ...radiusModes[mode]],
      `_temp_radius_${mode}.css`,
      `[data-radius-mode='${mode}']`,
      (token) => token.filePath.includes(`radius.${mode}.tokens.json`),
    );
  }

  for (const mode of ["default", "bold"]) {
    if (!borderModes[mode]) continue;
    await emit(
      [...baseFiles, ...borderModes[mode]],
      `_temp_border_${mode}.css`,
      `[data-border-mode='${mode}']`,
      (token) => token.filePath.includes(`border.${mode}.tokens.json`),
    );
  }

  const sdScss = new StyleDictionary({
    source: baseFiles,
    log: { verbosity: "silent" },
    platforms: {
      scss: {
        ...cssPlatformConfig,
        buildPath: scssOutDir.endsWith("/") ? scssOutDir : `${scssOutDir}/`,
        files: [
          {
            destination: "typography-mixins.scss",
            format: "scss/typography-mixins",
            filter: (token: any) => token.$type === "typography",
          },
        ],
      },
    },
  });
  await sdScss.buildAllPlatforms();

  const fluidMixinsPath = join(scssOutDir, "fluid-typography-mixins.scss");
  await buildFluidTypographyMixins({
    configPath: "src/fluid-typography.config.json",
    primitivesGlob: join(tokensDir, "primitives-font.*.tokens.json"),
    typographyStylesPath: join(tokensDir, "typography.styles.tokens.json"),
    outputPath: fluidMixinsPath,
  });

  // Derived radius layer — see src/radius/emitDerived.ts for why this is
  // emitted once rather than per mode.
  cssOutput += "\n" + emitDerivedRadiusCss() + "\n";

  const cssPath = join(cssOutDir, "tokens.css");
  writeFileSync(cssPath, cssOutput, "utf-8");

  for (const tempFile of tempFiles) {
    try {
      unlinkSync(tempFile);
    } catch {
      // best-effort cleanup
    }
  }

  return {
    cssPath,
    typographyMixinsPath: join(scssOutDir, "typography-mixins.scss"),
    fluidMixinsPath,
  };
}
