// Regression guard for scripts/build/undiciDecompressZstdGuardLoader.cjs and its webpack rule
// (next.config.mjs), added with fix commit f572ffe4e.
//
// Why this file exists: undici >= 8.12.2 evaluates
//   zstd: createZstdDecompress.bind(null, { params: { [constants.ZSTD_d_windowLogMax]: 23 } })
// at module scope. Next.js 16.4.6 collects page data in workers whose `node:zlib` namespace has
// no `createZstdDecompress`, so that line aborted the webpack build with
//   TypeError: Cannot read properties of undefined (reading 'bind')
//   -> "Failed to collect page data for /api/..."
// The loader rewrites only that one property into a runtime guard. If the loader ever degrades to
// a passthrough, is unwired from next.config.mjs, or the upstream shape moves on without the
// loader being updated, the build breaks again - these tests are what must fail first.
//
// The behaviour fixtures are loaded with a plain `require` of generated .cjs files in a temp dir;
// no eval / new Function / node:vm is used (Hard Rule #3).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const require = createRequire(import.meta.url);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOADER_PATH = path.join(REPO_ROOT, "scripts", "build", "undiciDecompressZstdGuardLoader.cjs");
const UPSTREAM_DECOMPRESS = path.join(
  REPO_ROOT,
  "node_modules",
  "undici",
  "lib",
  "interceptor",
  "decompress.js"
);
// Path only - the loader's scope check compares resource paths, so no copy has to exist on disk.
const NESTED_UNDICI_DECOMPRESS = path.join(
  REPO_ROOT,
  "node_modules",
  "jsdom",
  "node_modules",
  "undici",
  "lib",
  "interceptor",
  "decompress.js"
);
const NEXT_CONFIG = path.join(REPO_ROOT, "next.config.mjs");

const loader = require(LOADER_PATH);

// Verbatim upstream property the loader targets (undici 8.12.3,
// lib/interceptor/decompress.js:78). A literal on purpose: an undici bump that changes this
// expression must fail this suite loudly instead of silently disarming the loader.
const UPSTREAM_ZSTD_EXPRESSION =
  "zstd: createZstdDecompress.bind(null, { params: { [constants.ZSTD_d_windowLogMax]: 23 } })";
const UPSTREAM_PARAMS_FRAGMENT = "{ params: { [constants.ZSTD_d_windowLogMax]: 23 } }";
const GUARD_RE = /typeof createZstdDecompress === "function"/;
const GUARD_MARKER = "OMNIROUTE_UNDICI_ZSTD_GUARD";
const ZSTD_WINDOW_LOG_MAX = 100; // Node docs: zlib.constants.ZSTD_d_windowLogMax

const runLoader = (resourcePath, source) => loader.call({ resourcePath }, source);

// ---------------------------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------------------------
const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "undici-zstd-guard-"));
after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

let fixtureSerial = 0;
const requireGeneratedFixture = (label, source) => {
  fixtureSerial += 1;
  const file = path.join(fixtureRoot, `${label}-${fixtureSerial}.cjs`);
  writeFileSync(file, source, "utf8");
  return require(file);
};

// Mirrors what the Next.js webpack page-data worker sees: a node:zlib namespace without the zstd
// factory, so the unguarded module-scope `.bind()` throws while the module is being evaluated.
const workerLikePrelude = [
  'const { constants } = require("node:zlib");',
  "const createZstdDecompress = undefined;",
].join("\n");

const encodingTableSource = (prelude) =>
  [
    '"use strict";',
    prelude,
    "const supportedEncodings = {",
    "  __proto__: null,",
    '  gzip: () => "gzip",',
    `  ${UPSTREAM_ZSTD_EXPRESSION}`,
    "};",
    "module.exports = { supportedEncodings };",
    "",
  ].join("\n");

// ---------------------------------------------------------------------------------------------
// Upstream coupling + rewrite
// ---------------------------------------------------------------------------------------------
test("installed undici still carries the unguarded module-scope zstd bind the loader targets", () => {
  const upstream = readFileSync(UPSTREAM_DECOMPRESS, "utf8");
  assert.ok(
    upstream.includes(UPSTREAM_ZSTD_EXPRESSION),
    "undici's decompress interceptor no longer contains the expression this loader rewrites; " +
      "update or remove the loader and its next.config.mjs rule instead of leaving the build unguarded"
  );
});

test("rewrites the module-scope zstd bind into the runtime guard", () => {
  const upstream = readFileSync(UPSTREAM_DECOMPRESS, "utf8");
  const out = runLoader(UPSTREAM_DECOMPRESS, upstream);
  assert.notEqual(out, upstream, "loader is a no-op on the one file it exists to rewrite");
  assert.doesNotMatch(
    out,
    /createZstdDecompress\.bind\(/,
    "the unguarded .bind() still aborts the page-data worker in the rewritten source"
  );
  assert.match(out, GUARD_RE, "the rewritten property is not guarded by a typeof check");
  assert.ok(out.includes(GUARD_MARKER), "rewritten source lost the loader's idempotency marker");
  assert.ok(
    out.includes(UPSTREAM_PARAMS_FRAGMENT),
    "the guarded zstd factory dropped the upstream window params"
  );
});

test("is idempotent when applied twice", () => {
  const upstream = readFileSync(UPSTREAM_DECOMPRESS, "utf8");
  const once = runLoader(UPSTREAM_DECOMPRESS, upstream);
  const twice = runLoader(UPSTREAM_DECOMPRESS, once);
  assert.equal(twice, once);
  assert.equal(
    (twice.match(/zstd:/g) || []).length,
    (once.match(/zstd:/g) || []).length,
    "a second pass appended another zstd property"
  );
});

test("passes unrelated sources through untouched", () => {
  const source = 'import { x } from "./x";\nexport const y = x + 1;\n';
  assert.equal(runLoader(path.join(REPO_ROOT, "src", "lib", "unrelated.ts"), source), source);
});

test("no-ops on a nested undici copy instead of rewriting it or throwing", () => {
  const source = encodingTableSource(workerLikePrelude);
  const out = runLoader(NESTED_UNDICI_DECOMPRESS, source);
  assert.equal(out, source, "a nested undici copy must be left byte-identical");
  assert.doesNotMatch(out, GUARD_RE);
});

test("throws a self-identifying error when the upstream bind pattern is missing", () => {
  const changedShape = "const supportedEncodings = { zstd: buildZstdFactory() };\n";
  assert.throws(
    () => runLoader(UPSTREAM_DECOMPRESS, changedShape),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /undiciDecompressZstdGuardLoader/);
      assert.match(error.message, /changed shape/);
      assert.ok(error.message.includes(UPSTREAM_DECOMPRESS));
      return true;
    }
  );
});

// ---------------------------------------------------------------------------------------------
// Behaviour: the pair that makes the guard non-vacuous
// ---------------------------------------------------------------------------------------------
test("an unguarded fixture reproduces the page-data worker crash", () => {
  const unguarded = encodingTableSource(workerLikePrelude);
  assert.throws(
    () => requireGeneratedFixture("unguarded", unguarded),
    /Cannot read properties of undefined \(reading 'bind'\)/
  );
});

test("the guarded fixture loads where node:zlib has no zstd factory and omits the zstd encoding", () => {
  const guarded = runLoader(UPSTREAM_DECOMPRESS, encodingTableSource(workerLikePrelude));
  const { supportedEncodings } = requireGeneratedFixture("guarded", guarded);
  assert.equal(Object.hasOwn(supportedEncodings, "zstd"), false);
  assert.equal(typeof supportedEncodings.gzip, "function");
  assert.deepEqual(Object.keys(supportedEncodings), ["gzip"]);
});

test("the guarded factory keeps the upstream window params and forwards call arguments", () => {
  assert.equal(
    zlib.constants.ZSTD_d_windowLogMax,
    ZSTD_WINDOW_LOG_MAX,
    "Node's documented zstd window-log constant changed"
  );
  const spyFixture = [
    '"use strict";',
    'const { constants } = require("node:zlib");',
    "const calls = [];",
    "const createZstdDecompress = (options, ...rest) => {",
    "  calls.push({ options, rest });",
    "  return { stream: options };",
    "};",
    "const supportedEncodings = {",
    "  __proto__: null,",
    '  gzip: () => "gzip",',
    `  ${UPSTREAM_ZSTD_EXPRESSION}`,
    "};",
    "module.exports = { supportedEncodings, calls };",
    "",
  ].join("\n");
  const guarded = runLoader(UPSTREAM_DECOMPRESS, spyFixture);
  assert.doesNotMatch(guarded, /createZstdDecompress\.bind\(/);
  const { supportedEncodings, calls } = requireGeneratedFixture("spy", guarded);

  // `.bind(null, opts)` invoked with no argument == the guarded `(opts, ...args)` invoked with none.
  assert.equal(typeof supportedEncodings.zstd, "function");
  assert.deepEqual(supportedEncodings.zstd(), {
    stream: { params: { [ZSTD_WINDOW_LOG_MAX]: 23 } },
  });
  assert.deepEqual(calls, [{ options: { params: { [ZSTD_WINDOW_LOG_MAX]: 23 } }, rest: [] }]);

  supportedEncodings.zstd("extra-a", "extra-b");
  assert.deepEqual(calls[1], {
    options: { params: { [ZSTD_WINDOW_LOG_MAX]: 23 } },
    rest: ["extra-a", "extra-b"],
  });
});

// ---------------------------------------------------------------------------------------------
// Wiring contract (textual, not behavioural)
// ---------------------------------------------------------------------------------------------
// This asserts the rule exists and points at the loader - it cannot prove webpack honours it
// (only a real build can). It is the only thing that fails if the fix is left in the tree but
// unwired, so it is deliberately narrow.
test("next.config.mjs wires the loader as a pre-rule scoped to undici's decompress interceptor (textual wiring contract)", () => {
  const config = readFileSync(NEXT_CONFIG, "utf8");
  const anchor = config.indexOf("config.module.rules.unshift({");
  assert.notEqual(
    anchor,
    -1,
    "the loader's webpack rule is no longer registered in next.config.mjs"
  );
  const rule = config.slice(anchor, anchor + 400);
  assert.ok(
    rule.includes("undiciDecompressZstdGuardLoader.cjs"),
    "the unshifted rule does not point at the loader"
  );
  assert.ok(
    rule.includes("[\\\\/]lib[\\\\/]interceptor[\\\\/]decompress\\.js$/"),
    "the rule no longer targets undici's decompress interceptor"
  );
  assert.match(rule, /enforce:\s*"pre"/);
  assert.match(rule, /use:\s*\[\{\s*loader:\s*join\(projectRoot,/);
});
