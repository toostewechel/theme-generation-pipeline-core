import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  diffNames,
  namesAt,
  type FileReader,
  type NameSource,
} from "../src/drift/token-drift.js";

const TOKENS_DIR = "src/tokens";

function loadIgnore(path: string): (string | RegExp)[] {
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf-8")) as string[];
  return raw.map((entry) =>
    entry.startsWith("/") && entry.endsWith("/") && entry.length > 2
      ? new RegExp(entry.slice(1, -1))
      : entry,
  );
}

const reader: FileReader = (source, relPath) => {
  const repoPath = join(TOKENS_DIR, relPath);
  if ("worktree" in source) {
    return existsSync(repoPath) ? readFileSync(repoPath, "utf-8") : null;
  }
  try {
    return execFileSync("git", ["show", `${source.ref}:${repoPath}`], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null; // file absent at this ref
  }
};

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function describeSource(s: NameSource): string {
  return "worktree" in s ? "working tree" : s.ref;
}

function verifyRef(ref: string): void {
  try {
    execFileSync("git", ["rev-parse", "--verify", ref], { stdio: "ignore" });
  } catch {
    console.error(`Cannot resolve ref "${ref}" (is this a git repo, with git installed?).`);
    process.exit(2);
  }
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const baseRef = getFlag(args, "--base") ?? "HEAD";
  const headRef = getFlag(args, "--head"); // undefined → working tree

  verifyRef(baseRef);
  if (headRef) verifyRef(headRef);

  const base: NameSource = { ref: baseRef };
  const head: NameSource = headRef ? { ref: headRef } : { worktree: true };

  const before = namesAt(base, reader);
  const after = namesAt(head, reader);

  if (before.size === 0 && after.size === 0) {
    console.error(
      `No tokens found at base (${describeSource(base)}) or head (${describeSource(head)}) — is ${TOKENS_DIR}/manifest.json present?`,
    );
    process.exit(2);
  }

  const ignore = loadIgnore(join("scripts", "token-drift.ignore.json"));
  const diff = diffNames(before, after, { ignore });

  if (json) {
    console.log(JSON.stringify(diff, null, 2));
    process.exit(diff.hasBreaking ? 1 : 0);
  }

  console.log(`🔍 Token name-drift  ${describeSource(base)} → ${describeSource(head)}`);
  console.log(`   ✅ ${diff.unchanged} unchanged`);
  if (diff.removed.length) {
    console.log(`   🚨 ${diff.removed.length} removed (renames-away or removals — break consumers):`);
    for (const n of diff.removed) console.log(`      🔻 ${n}`);
  }
  if (diff.added.length) {
    console.log(`   🆕 ${diff.added.length} added (safe):`);
    for (const n of diff.added) console.log(`      ➕ ${n}`);
  }
  if (diff.ignored.length) console.log(`   🙈 ${diff.ignored.length} ignored`);

  console.log(
    diff.hasBreaking
      ? `\n💥 Breaking drift — ${diff.removed.length} name(s) removed. Review before committing.`
      : `\n🎉 No breaking drift — all clear!`,
  );

  process.exit(diff.hasBreaking ? 1 : 0);
}

main();
