#!/usr/bin/env node
/**
 * WP-C controlled display-catalog regeneration (AC-14).
 *
 * Rewrites ONLY the JSON value strings of the two allowlisted catalog families:
 *   src/i18n/messages/*.json
 *   bin/cli/locales/*.json
 *
 * The transformation is token-aware: wire tokens (headers, sk_omniroute, omniroute/*
 * model prefixes, omniroute: cache prefixes, ~/.omniroute, omniroute_* MCP tools,
 * OMNIROUTE_* env vars), interpolation tokens and every object key are copied through
 * byte-for-byte. No shell command, no network call, no credential read, no repo-wide
 * sed. `--check` never writes; `--write` preflights the whole plan before writing.
 *
 * Usage:
 *   node scripts/i18n/rebrand-display-catalogs.mjs --check
 *   node scripts/i18n/rebrand-display-catalogs.mjs --write
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(SCRIPT_DIR, "..", "..");
export const ALLOWLIST_PATH = path.join(SCRIPT_DIR, "rebrand-display-allowlist.json");

const ALLOWED_ROOTS = new Set(["src/i18n/messages", "bin/cli/locales"]);

function normalizeRepoPath(value) {
  return path.posix.normalize(value.replace(/\\/g, "/").replace(/^\.\//, ""));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(`rebrand-display-catalogs: ${message}`);
}

export async function loadAllowlist(file = ALLOWLIST_PATH) {
  const parsed = JSON.parse(await fs.readFile(file, "utf8"));
  assert(parsed?.version === 1, "unsupported allowlist version");
  assert(
    Array.isArray(parsed.catalogRoots) &&
      parsed.catalogRoots.every((spec) => ALLOWED_ROOTS.has(normalizeRepoPath(spec.root))),
    "catalogRoots must be limited to src/i18n/messages and bin/cli/locales"
  );
  assert(
    Array.isArray(parsed.replacements) &&
      parsed.replacements.length > 0 &&
      parsed.replacements.every(
        (rule) => rule.from && rule.to && rule.scope === "string-values-only"
      ),
    "replacements must be string-values-only with non-empty from/to"
  );
  assert(
    Array.isArray(parsed.protectedTokens) &&
      parsed.protectedTokens.length > 0 &&
      parsed.protectedTokens.every(
        (token) => typeof token?.label === "string" && typeof token?.pattern === "string"
      ),
    "protectedTokens must be labelled regex fragments"
  );
  assert(
    Array.isArray(parsed.forbiddenTokens) &&
      parsed.forbiddenTokens.every((t) => typeof t === "string"),
    "forbiddenTokens must be a string list"
  );
  assert(
    Array.isArray(parsed.interpolationPatterns) && parsed.interpolationPatterns.length > 0,
    "interpolationPatterns must be a non-empty list"
  );
  assert(
    parsed.outputFormat?.indent === 2 && parsed.outputFormat?.trailingNewline === true,
    "outputFormat must be canonical JSON (2-space indent, trailing newline)"
  );
  return parsed;
}

export function assertAllowlisted(relativePath, allowlist) {
  const normalized = normalizeRepoPath(relativePath);
  const allowed = allowlist.catalogRoots.some((spec) => {
    const root = normalizeRepoPath(spec.root);
    if (!normalized.startsWith(`${root}/`)) return false;
    const tail = normalized.slice(root.length + 1);
    return tail.length > 0 && !tail.includes("/") && tail.endsWith(".json");
  });
  assert(allowed, `refusing to touch non-allowlisted path: ${normalized}`);
  return normalized;
}

/** One regex for every byte span the generator must reproduce verbatim. */
export function buildPreserveRegex(allowlist) {
  const tokens = [...allowlist.protectedTokens].sort((a, b) => b.pattern.length - a.pattern.length);
  const source = [
    ...tokens.map((token) => `(?:${token.pattern})`),
    ...allowlist.interpolationPatterns.map((pattern) => `(?:${pattern})`),
  ].join("|");
  return new RegExp(source, "g");
}

function collectPaths(node, prefix, out) {
  if (isPlainObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      collectPaths(value, prefix ? `${prefix}.${key}` : key, out);
    }
  } else if (Array.isArray(node)) {
    node.forEach((value, index) => collectPaths(value, `${prefix}[${index}]`, out));
  } else {
    out.push(`${prefix}:${node === null ? "null" : typeof node}`);
  }
}

/** Dotted leaf paths with their value kind; a key change is always a defect. */
export function collectLeafPaths(node, prefix = "", out = []) {
  collectPaths(node, prefix, out);
  return out.sort();
}

export function extractInterpolationTokens(value, allowlist) {
  const tokens = [];
  for (const pattern of allowlist.interpolationPatterns) {
    const regex = new RegExp(pattern, "g");
    for (const match of value.matchAll(regex)) tokens.push(match[0]);
  }
  return tokens.sort();
}

function applyReplacements(segment, replacements) {
  let out = segment;
  for (const rule of replacements) out = out.split(rule.from).join(rule.to);
  return out;
}

/** Replace display tokens only outside protected wire/interpolation spans. */
export function transformValue(value, allowlist, preserveRegex = buildPreserveRegex(allowlist)) {
  let out = "";
  let cursor = 0;
  preserveRegex.lastIndex = 0;
  for (const match of value.matchAll(preserveRegex)) {
    const start = match.index ?? 0;
    if (start > cursor)
      out += applyReplacements(value.slice(cursor, start), allowlist.replacements);
    out += match[0];
    cursor = start + match[0].length;
  }
  if (cursor < value.length) out += applyReplacements(value.slice(cursor), allowlist.replacements);
  return out;
}

function sameList(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * Pure catalog transformation. Throws on any structural, placeholder or wire-token
 * drift rather than emitting a partially rebranded catalog.
 */
export function transformCatalog(
  catalog,
  allowlist,
  preserveRegex = buildPreserveRegex(allowlist)
) {
  const beforeKeys = collectLeafPaths(catalog);
  const violations = [];
  let changedValues = 0;

  function walk(node, nodePath) {
    if (typeof node === "string") {
      const afterValue = transformValue(node, allowlist, preserveRegex);
      if (node !== afterValue) {
        const before = extractInterpolationTokens(node, allowlist);
        const after = extractInterpolationTokens(afterValue, allowlist);
        if (!sameList(before, after)) violations.push(`${nodePath}: interpolation token changed`);
        changedValues += 1;
      }
      return afterValue;
    }
    if (Array.isArray(node)) return node.map((item, index) => walk(item, `${nodePath}[${index}]`));
    if (isPlainObject(node)) {
      const result = {};
      for (const [key, value] of Object.entries(node)) {
        result[key] = walk(value, nodePath ? `${nodePath}.${key}` : key);
      }
      return result;
    }
    return node;
  }

  const transformed = walk(catalog, "");
  if (!sameList(beforeKeys, collectLeafPaths(transformed))) {
    violations.push("catalog key set or value kinds changed");
  }
  if (violations.length) {
    throw new Error(`unsafe catalog transformation: ${violations.slice(0, 5).join("; ")}`);
  }
  return { catalog: transformed, changedValues };
}

function visitStrings(node, visit, nodePath = "") {
  if (typeof node === "string") {
    visit(node, nodePath);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((value, index) => visitStrings(value, visit, `${nodePath}[${index}]`));
    return;
  }
  if (isPlainObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      visitStrings(value, visit, nodePath ? `${nodePath}.${key}` : key);
    }
  }
}

export function findForbiddenTokens(catalog, allowlist) {
  const findings = [];
  visitStrings(catalog, (value, nodePath) => {
    for (const token of allowlist.forbiddenTokens) {
      if (value.includes(token)) findings.push(`${nodePath}: ${token}`);
    }
  });
  return findings;
}

/** Counts protected token bytes so a hand-rebranded wire token cannot pass the gate. */
export function findProtectedTokenDrift(before, after, allowlist) {
  // Longest fragment first: "~/.omniroute" must not be claimed by "omniroute/".
  const tokens = [...allowlist.protectedTokens].sort((a, b) => b.pattern.length - a.pattern.length);
  const regex = new RegExp(tokens.map((token) => `(${token.pattern})`).join("|"), "g");

  const count = (catalog) => {
    const counts = new Map(tokens.map((_token, index) => [index, 0]));
    visitStrings(catalog, (value) => {
      regex.lastIndex = 0;
      for (const match of value.matchAll(regex)) {
        const group = match.slice(1).findIndex((part) => part !== undefined);
        if (group >= 0) counts.set(group, (counts.get(group) ?? 0) + 1);
      }
    });
    return counts;
  };

  const beforeCounts = count(before);
  const afterCounts = count(after);
  const drifts = [];
  for (const [index, token] of tokens.entries()) {
    const beforeCount = beforeCounts.get(index) ?? 0;
    const afterCount = afterCounts.get(index) ?? 0;
    if (beforeCount !== afterCount) {
      drifts.push(`${token.label}: ${beforeCount} -> ${afterCount}`);
    }
  }
  return drifts;
}

export function serializeCatalog(catalog, allowlist) {
  return (
    JSON.stringify(catalog, null, allowlist.outputFormat.indent) +
    (allowlist.outputFormat.trailingNewline ? "\n" : "")
  );
}

/** Reads and preflights every allowlisted catalog. Never mutates the tree. */
export async function planCatalogs(allowlist, root = ROOT) {
  const plans = [];
  for (const spec of allowlist.catalogRoots) {
    const catalogRoot = path.join(root, spec.root);
    const entries = (await fs.readdir(catalogRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relative = assertAllowlisted(path.posix.join(spec.root, entry.name), allowlist);
      const absolute = path.join(root, relative);
      const beforeRaw = await fs.readFile(absolute, "utf8");
      const before = JSON.parse(beforeRaw);
      const { catalog, changedValues } = transformCatalog(before, allowlist);
      const afterRaw = serializeCatalog(catalog, allowlist);
      plans.push({
        relative,
        absolute,
        before,
        after: catalog,
        beforeRaw,
        afterRaw,
        changedValues,
        forbidden: findForbiddenTokens(catalog, allowlist),
        drift: findProtectedTokenDrift(before, catalog, allowlist),
      });
    }
  }
  return plans.sort((a, b) => a.relative.localeCompare(b.relative));
}

function summarize(items, label) {
  const sample = items.slice(0, 10).map((item) => `  - ${item.relative} (${item.changedValues})`);
  const rest = items.length > sample.length ? `\n  … and ${items.length - sample.length} more` : "";
  return `${label}:\n${sample.join("\n")}${rest}`;
}

async function main(argv) {
  const valid = argv.every((arg) => arg === "--check" || arg === "--write");
  const mode = argv.find((arg) => arg === "--check" || arg === "--write");
  if (!valid || argv.length !== 1 || !mode) {
    throw new Error("usage: rebrand-display-catalogs.mjs --check|--write");
  }

  const allowlist = await loadAllowlist();
  const plans = await planCatalogs(allowlist);
  const unsafe = plans.filter((item) => item.forbidden.length || item.drift.length);
  if (unsafe.length) {
    const detail = unsafe
      .slice(0, 5)
      .map((item) => `  - ${item.relative}: ${[...item.forbidden, ...item.drift].join("; ")}`)
      .join("\n");
    throw new Error(`unsafe token found in allowlisted catalogs:\n${detail}`);
  }

  const changed = plans.filter((item) => item.beforeRaw !== item.afterRaw);
  if (mode === "--check") {
    if (changed.length) {
      console.error(summarize(changed, `FAIL — ${changed.length} catalog(s) would change`));
      console.error("Run: node scripts/i18n/rebrand-display-catalogs.mjs --write");
      process.exitCode = 1;
      return;
    }
    console.log(`PASS — ${plans.length} allowlisted catalogs are current (0 would change)`);
    return;
  }

  // Every file is preflighted above; write only after all plans are known safe.
  for (const item of changed) {
    assertAllowlisted(item.relative, allowlist);
    await fs.writeFile(item.absolute, item.afterRaw, "utf8");
  }
  if (changed.length) {
    const totalValues = changed.reduce((sum, item) => sum + item.changedValues, 0);
    console.log(summarize(changed, `WROTE ${changed.length} catalog(s), ${totalValues} value(s)`));
  } else {
    console.log(`PASS — ${plans.length} allowlisted catalogs already current (0 writes)`);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`FAIL — ${error.message}`);
    process.exitCode = 1;
  });
}
