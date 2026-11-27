#!/usr/bin/env node
/**
 * WP-C boundary gate (AC-15): fail on any change to an agent-instruction surface,
 * a deferred docs/i18n mirror, a frozen wire-token file, or an out-of-scope generated
 * mirror. Concurrent WP-A / WP-B edits elsewhere are ignored by design.
 *
 * An approval is only accepted from the tracked marker named in
 * scripts/i18n/rebrand-deferred-allowlist.json. The marker must carry status=approved,
 * an operator, a reason and the exact repo-relative path for every approved change.
 * WP-C carries no marker, so all of these paths must be absent from the diff.
 *
 * Usage:
 *   node scripts/check/check-khub-protected-paths.mjs
 *   node scripts/check/check-khub-protected-paths.mjs --range origin/main...HEAD
 * Exit 1 with the offending paths on any violation; 0 otherwise.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(SCRIPT_DIR, "..", "..");
export const DEFERRED_PATH = path.resolve(
  SCRIPT_DIR,
  "..",
  "i18n",
  "rebrand-deferred-allowlist.json"
);

function normalizeRepoPath(value) {
  return path.posix.normalize(String(value).replace(/\\/g, "/").replace(/^\.\//, ""));
}

function escapeLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assert(condition, message) {
  if (!condition) throw new Error(`check-khub-protected-paths: ${message}`);
}

export function loadDeferredPolicy(file = DEFERRED_PATH) {
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  assert(doc?.version === 1, "unsupported deferred-policy version");
  for (const key of [
    "deferredMirrors",
    "protectedSurfaces",
    "wireTokenFiles",
    "outOfScopeGeneratedMirrors",
  ]) {
    assert(Array.isArray(doc[key]), `${key} must be an array`);
  }
  assert(
    typeof doc.approvalMarker === "string" && doc.approvalMarker.length > 0,
    "approvalMarker is required"
  );
  assert(
    doc.deferredMirrors.every((entry) => typeof entry.pattern === "string" && entry.reason),
    "deferredMirrors entries need a pattern and a reason"
  );
  assert(
    doc.protectedSurfaces.every((entry) => typeof entry.pattern === "string" && entry.kind),
    "protectedSurfaces entries need a pattern and a kind"
  );
  assert(
    doc.wireTokenFiles.every((entry) => typeof entry === "string"),
    "wireTokenFiles must be exact repo-relative paths"
  );
  assert(
    doc.outOfScopeGeneratedMirrors.every(
      (entry) => typeof entry.pattern === "string" && entry.kind
    ),
    "outOfScopeGeneratedMirrors entries need a pattern and a kind"
  );
  return doc;
}

export function matchesPattern(relativePath, pattern) {
  const target = normalizeRepoPath(relativePath);
  const normalizedPattern = normalizeRepoPath(pattern);
  if (!normalizedPattern.includes("*") && !normalizedPattern.includes("?")) {
    return target === normalizedPattern;
  }
  let source = "^";
  for (let i = 0; i < normalizedPattern.length; i += 1) {
    const char = normalizedPattern[i];
    if (char === "*") {
      if (normalizedPattern[i + 1] === "*") {
        source += ".*";
        i += 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeLiteral(char);
    }
  }
  return new RegExp(`${source}$`).test(target);
}

/** Return the boundary category of one changed path, or null for unrelated WP edits. */
export function classifyChangedPath(relativePath, policy) {
  const target = normalizeRepoPath(relativePath);
  if (!target || target === ".") return null;
  const groups = [
    { category: "protected-surface", entries: policy.protectedSurfaces },
    { category: "deferred-mirror", entries: policy.deferredMirrors },
    {
      category: "wire-token-file",
      entries: policy.wireTokenFiles.map((entry) => ({ pattern: entry, kind: "wire-contract" })),
    },
    { category: "out-of-scope-generated-mirror", entries: policy.outOfScopeGeneratedMirrors },
  ];
  for (const group of groups) {
    for (const entry of group.entries) {
      if (matchesPattern(target, entry.pattern)) {
        return { category: group.category, kind: entry.kind, pattern: entry.pattern, path: target };
      }
    }
  }
  return null;
}

export function validateApproval(approval) {
  if (!approval) return new Set();
  assert(approval.status === "approved", "approval marker must have status=approved");
  assert(
    typeof approval.operator === "string" && approval.operator.trim().length > 0,
    "approval marker must name an operator"
  );
  assert(
    typeof approval.reason === "string" && approval.reason.trim().length > 0,
    "approval marker must give a reason"
  );
  assert(
    Array.isArray(approval.approvals) && approval.approvals.length > 0,
    "approval marker must list explicit path entries"
  );
  const approved = new Set();
  for (const entry of approval.approvals) {
    assert(
      typeof entry?.path === "string" && /^[A-Za-z0-9._/-]+$/.test(entry.path),
      "approval entries need an exact repo-relative path"
    );
    assert(
      typeof entry.reason === "string" && entry.reason.trim().length > 0,
      `approval entry ${entry.path} needs a reason`
    );
    approved.add(normalizeRepoPath(entry.path));
  }
  return approved;
}

export function loadApproval(file, policy) {
  if (!fs.existsSync(file)) return null;
  const approval = JSON.parse(fs.readFileSync(file, "utf8"));
  validateApproval(approval);
  assert(
    normalizeRepoPath(path.relative(ROOT, file)) === normalizeRepoPath(policy.approvalMarker),
    `approval marker must be ${policy.approvalMarker}`
  );
  return approval;
}

export function evaluate(changedPaths, policy, approval = null) {
  const approved = validateApproval(approval);
  const checkedPaths = new Set();
  const violations = [];
  for (const raw of changedPaths) {
    const classification = classifyChangedPath(raw, policy);
    if (!classification) continue;
    checkedPaths.add(classification.path);
    if (!approved.has(classification.path)) {
      violations.push({ ...classification, reason: "no explicit approval marker entry" });
    }
  }
  return {
    checkedPaths: [...checkedPaths].sort(),
    approvedPaths: [...approved].sort(),
    violations,
  };
}

function git(args, root = ROOT) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
}

/** Changed paths from the working tree, or from an explicit two-dot/three-dot range. */
export function collectChangedPaths({ root = ROOT, range = null } = {}) {
  if (range) {
    assert(
      /^[A-Za-z0-9._~^/-]+(\.\.\.?)[A-Za-z0-9._~^/-]+$/.test(range),
      `--range must be a git ref range (got ${range})`
    );
    return git(["diff", "--name-only", "--diff-filter=ACDMRTUXB", range], root)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const records = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], root)
    .split("\0")
    .filter(Boolean);
  const paths = [];
  for (let i = 0; i < records.length; i += 1) {
    const entry = records[i];
    const status = entry.slice(0, 2);
    const target = entry.slice(3);
    if (status.includes("R") || status.includes("C")) {
      const renamed = records[i + 1];
      if (renamed) paths.push(target, renamed);
      else paths.push(target);
      i += 1;
    } else {
      paths.push(target);
    }
  }
  return paths;
}

function parseArgs(argv) {
  let range = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== "--range") throw new Error(`unknown argument: ${argv[i]}`);
    range = argv[i + 1];
    if (!range) throw new Error("--range needs a value");
    i += 1;
  }
  return { range };
}

function main(argv) {
  const { range } = parseArgs(argv);
  const policy = loadDeferredPolicy();
  const approval = loadApproval(path.join(ROOT, policy.approvalMarker), policy);
  const changed = collectChangedPaths({ root: ROOT, range });
  const result = evaluate(changed, policy, approval);
  if (result.violations.length) {
    const sample = result.violations
      .slice(0, 20)
      .map((item) => `  - ${item.category} / ${item.path} (${item.reason})`)
      .join("\n");
    const rest =
      result.violations.length > 20 ? `\n  … and ${result.violations.length - 20} more` : "";
    console.error(
      `FAIL — ${result.violations.length} protected-path violation(s) among ${changed.length} changed path(s):\n${sample}${rest}`
    );
    console.error(`Approval marker: ${approval ? policy.approvalMarker : "absent"}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `PASS — ${changed.length} changed path(s) scanned; ${result.checkedPaths.length} boundary path(s) checked; 0 violations (approval marker: ${approval ? "present" : "absent"})`
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`FAIL — ${error.message}`);
    process.exitCode = 1;
  }
}
