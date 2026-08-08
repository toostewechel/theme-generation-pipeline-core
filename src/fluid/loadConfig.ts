import { readFileSync, existsSync } from "fs";
import { glob } from "fs/promises";
import {
  buildTokenLookup,
  resolveConfig,
  type FluidTypographyConfig,
  type ResolvedFluidConfig,
} from "./resolveConfig.js";

export interface ResolveOptions {
  configPath: string;
  primitivesGlob: string;
}

/**
 * Reads the fluid typography config plus every primitives file matching the
 * glob, then resolves token references to pixel values.
 * Returns null when the config file doesn't exist.
 */
export async function resolveFluidConfig(
  options: ResolveOptions,
): Promise<ResolvedFluidConfig | null> {
  const { configPath, primitivesGlob } = options;

  if (!existsSync(configPath)) {
    return null;
  }

  const config: FluidTypographyConfig = JSON.parse(
    readFileSync(configPath, "utf-8"),
  );

  // Merge every matching primitives file into one flat object, so the pure
  // core only has to know about a single lookup source.
  const primitives: Record<string, any> = {};
  for await (const entry of glob(primitivesGlob)) {
    Object.assign(primitives, JSON.parse(readFileSync(entry, "utf-8")));
  }

  return resolveConfig(config, buildTokenLookup(primitives));
}
