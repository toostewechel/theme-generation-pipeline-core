// ─── DTCG name walker (carried over from the retired figma-drift module) ───

/** A DTCG token node carries `$value` or `$type`. */
function isTokenNode(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && ("$value" in value || "$type" in value);
}

/**
 * Walk a DTCG file object, collecting leaf token names into `into`.
 * Files are flat in this repo, so names equal top-level keys; nested groups
 * (if ever present) are joined with "-" to match the flat naming convention.
 * `$`-prefixed metadata keys are skipped.
 */
export function collectTokenNames(
  node: Record<string, unknown>,
  into: Set<string>,
  prefix = "",
): void {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    const name = prefix ? `${prefix}-${key}` : key;
    if (isTokenNode(value)) into.add(name);
    else if (typeof value === "object" && value !== null)
      collectTokenNames(value as Record<string, unknown>, into, name);
  }
}

// ─── Name diff (temporal: before → after) ──────────────────────────────────

export interface NameDiff {
  /** In before, not after — renames-away + removals (BREAKING). */
  removed: string[];
  /** In after, not before — additions + renames-to (safe). */
  added: string[];
  /** Count of names present in both. */
  unchanged: number;
  /** Matched an ignore pattern; excluded from removed/added. */
  ignored: string[];
  /** True when removed is non-empty after ignores. */
  hasBreaking: boolean;
}

export function diffNames(
  before: Set<string>,
  after: Set<string>,
  opts: { ignore?: (string | RegExp)[] } = {},
): NameDiff {
  const ignore = opts.ignore ?? [];
  const isIgnored = (name: string) =>
    ignore.some((p) => (typeof p === "string" ? p === name : p.test(name)));

  const removed: string[] = [];
  const added: string[] = [];
  const ignored: string[] = [];
  let unchanged = 0;

  for (const name of new Set([...before, ...after])) {
    if (isIgnored(name)) {
      ignored.push(name);
      continue;
    }
    const inBefore = before.has(name);
    const inAfter = after.has(name);
    if (inBefore && inAfter) unchanged++;
    else if (inBefore) removed.push(name);
    else added.push(name);
  }

  for (const arr of [removed, added, ignored]) arr.sort();

  return { removed, added, unchanged, ignored, hasBreaking: removed.length > 0 };
}

// ─── Name reading at a git source (reader injected; core stays pure) ────────

export type NameSource = { ref: string } | { worktree: true };

/** Returns file content at the source, or null if the file does not exist there. */
export type FileReader = (source: NameSource, relPath: string) => string | null;

interface Manifest {
  collections: Record<string, { modes: Record<string, string[]> }>;
}

/**
 * Reads manifest.json at `source`, walks each file under manifest.collections,
 * and unions all token names. A null from the reader (file absent at that
 * source) contributes nothing. Returns an empty set if no manifest exists at
 * the source. The `styles` block is intentionally not read.
 */
export function namesAt(source: NameSource, read: FileReader): Set<string> {
  const names = new Set<string>();
  const manifestRaw = read(source, "manifest.json");
  if (manifestRaw === null) return names;
  const manifest = JSON.parse(manifestRaw) as Manifest;
  for (const collection of Object.values(manifest.collections)) {
    for (const files of Object.values(collection.modes)) {
      for (const filename of files) {
        const raw = read(source, filename);
        if (raw !== null) collectTokenNames(JSON.parse(raw) as Record<string, unknown>, names);
      }
    }
  }
  return names;
}
