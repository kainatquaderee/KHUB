// Build-time webpack loader for the hoisted undici decompress interceptor
// (node_modules/undici/lib/interceptor/decompress.js), wired from next.config.mjs.
//
// Why this exists: undici >= 8.12.2 evaluates
//   zstd: createZstdDecompress.bind(null, { params: { [constants.ZSTD_d_windowLogMax]: 23 } })
// at module scope. Next.js 16.4.6 collects page data in workers whose node:zlib
// namespace has no `createZstdDecompress`, so that call throws
// "Cannot read properties of undefined (reading 'bind')" and the build aborts
// ("Failed to collect page data"). This loader rewrites only that one property
// into a runtime-guarded spread, mirroring the `runtimeFeatures.has('zstd')`
// guard that undici 7.30.x already uses: with a real Node zlib the guard is true
// and the factory is registered with the same params as before, so production
// runtime behaviour is identical. Only the worker path changes, and there zstd
// is unavailable for every consumer anyway.
//
// If the upstream pattern disappears (an undici bump, or upstream guarding it
// itself) this loader throws instead of silently regressing: update or remove
// this loader and its rule in next.config.mjs deliberately.
"use strict";

const path = require("node:path");

// Only the hoisted top-level copy is rewritten. Vendored nested copies
// (jsdom / promptfoo ship undici 7.30.x) already guard zstd themselves and must
// not be modified or fail this loader.
const TOP_LEVEL_DECOMPRESS = path.resolve(
  __dirname,
  "..",
  "..",
  "node_modules",
  "undici",
  "lib",
  "interceptor",
  "decompress.js"
);

const GUARD_MARKER = "OMNIROUTE_UNDICI_ZSTD_GUARD";

const UPSTREAM_ZSTD_BIND =
  /zstd:\s*createZstdDecompress\.bind\(\s*null\s*,\s*\{\s*params:\s*\{\s*\[constants\.ZSTD_d_windowLogMax\]:\s*23\s*\}\s*\}\s*\)/;

// `(...args) => createZstdDecompress(opts, ...args)` is exactly
// `createZstdDecompress.bind(null, opts)`. decompress.js invokes the factory
// with no arguments (supportedEncodings[encoding]()), and the rest-args form
// stays equivalent for any future call signature.
const GUARDED_ZSTD =
  `...((/* ${GUARD_MARKER} */ typeof createZstdDecompress === "function")` +
  " ? { zstd: (...args) => createZstdDecompress({ params: { [constants.ZSTD_d_windowLogMax]: 23 } }, ...args) }" +
  " : {})";

module.exports = function undiciDecompressZstdGuardLoader(source) {
  const resource = path.resolve(this.resourcePath || "");
  if (resource !== TOP_LEVEL_DECOMPRESS) {
    return source;
  }

  // Idempotent: a repeated application of this loader is a no-op.
  if (source.includes(GUARD_MARKER)) {
    return source;
  }

  if (!UPSTREAM_ZSTD_BIND.test(source)) {
    throw new Error(
      `[undiciDecompressZstdGuardLoader] Expected the zstd bind pattern in ${TOP_LEVEL_DECOMPRESS} ` +
        "but did not find it. undici's decompress interceptor changed shape; update or remove " +
        "scripts/build/undiciDecompressZstdGuardLoader.cjs and its rule in next.config.mjs so the " +
        "Next.js webpack page-data build cannot silently regress."
    );
  }

  return source.replace(UPSTREAM_ZSTD_BIND, GUARDED_ZSTD);
};
