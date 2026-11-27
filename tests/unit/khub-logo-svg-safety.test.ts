import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertSafeKhubSvg,
  buildKhubIconSvg,
  buildKhubSvg,
  KHUB_BACKGROUND_PATH,
  KHUB_MONOGRAM_FULL_PATHS,
  KHUB_MONOGRAM_ORBIT_PATH,
  KHUB_MONOGRAM_SATELLITE_PATH,
  KHUB_MONOGRAM_SILHOUETTE_PATHS,
  KHUB_MONOGRAM_VIEWBOX,
  KHUB_WORDMARK_PATHS,
  KHUB_WORDMARK_VIEWBOX,
} from "../../src/shared/brand/khubMark.ts";

const root = join(import.meta.dirname, "..", "..");
const readAsset = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("KHUB wordmark keeps the locked LATCH-ORBIT geometry", () => {
  assert.equal(KHUB_WORDMARK_VIEWBOX, "0 0 420 96");
  const paths = KHUB_WORDMARK_PATHS.map((path) => path.d);
  assert.ok(paths.includes("M24 24 H36 V72 H24 Z"), "K stem must be path-drawn as specified");
  assert.match(paths.join(" "), /M36 40 C48 32 60 24 72 24 L72 34 C60 34 48 42 36 50 Z/);
  assert.match(paths.join(" "), /M36 46 C48 54 60 62 72 62 L72 72 C60 72 48 64 36 56 Z/);
  assert.match(paths.join(" "), /M80 24 H92 V72 H80 Z/);
  assert.match(paths.join(" "), /M120 24 H132 V72 H120 Z/);
  assert.match(paths.join(" "), /M140 24 H152/);
  assert.match(paths.join(" "), /M200 24 H212 V72 H200 Z/);
  assert.match(paths.join(" "), /260 72 246 72 H212 Z/);
  assert.match(paths.join(" "), /A30 18 -18 1 1/, "orbit must be the -18° ellipse arc");
  assert.match(paths.join(" "), /M76 32 A4 4/, "satellite radius 4 at (76,36)");
  assert.doesNotMatch(
    paths.join(" "),
    /A30 18 -18 0 1/,
    "the removed 200°..250° sector requires the large-arc flag"
  );
  assert.deepEqual(assertSafeKhubSvg(buildKhubSvg("wordmark")), true);
});

test("K monogram is derived and drops the orbit at 16px", () => {
  assert.equal(KHUB_MONOGRAM_VIEWBOX, "0 0 64 64");
  const silhouette = KHUB_MONOGRAM_SILHOUETTE_PATHS.map((path) => path.d);
  assert.deepEqual(silhouette, [
    "M12 8 H24 V56 H12 Z",
    "M22 13 L52 5 L52 15 L22 23 Z",
    "M22 41 L52 49 L52 59 L22 51 Z",
  ]);
  assert.match(KHUB_MONOGRAM_ORBIT_PATH, /^M18\.8966 20\.4487 A26 16 -18 1 1 /);
  assert.match(KHUB_MONOGRAM_SATELLITE_PATH, /^M54 17 A3 3 /);
  assert.equal(KHUB_MONOGRAM_FULL_PATHS.length, silhouette.length + 2);

  const sixteen = buildKhubIconSvg(16);
  const thirtyTwo = buildKhubIconSvg(32);
  assert.ok(!sixteen.includes(KHUB_MONOGRAM_ORBIT_PATH));
  assert.ok(!sixteen.includes(KHUB_MONOGRAM_SATELLITE_PATH));
  assert.ok(thirtyTwo.includes(KHUB_MONOGRAM_ORBIT_PATH));
  assert.ok(thirtyTwo.includes(KHUB_MONOGRAM_SATELLITE_PATH));
  assert.ok(sixteen.includes(KHUB_BACKGROUND_PATH));
  assert.deepEqual(assertSafeKhubSvg(sixteen), true);
  assert.deepEqual(assertSafeKhubSvg(thirtyTwo), true);
});

test("on-disk icon SVGs are byte-identical to the geometry source", () => {
  assert.equal(readAsset("public/favicon.svg"), buildKhubIconSvg(32));
  assert.equal(readAsset("public/icon-192.svg"), buildKhubIconSvg(192));
  assert.equal(readAsset("public/apple-touch-icon.svg"), buildKhubIconSvg(180));
});

test("every generated SVG is path-only and locally sourced", () => {
  const assets = [
    "public/favicon.svg",
    "public/icon-192.svg",
    "public/apple-touch-icon.svg",
    "public/brand/creative/khub-orbit-gate.svg",
    "public/brand/parody/khub-latency-comet.svg",
  ];
  for (const asset of assets) {
    const svg = readAsset(asset);
    assert.deepEqual(assertSafeKhubSvg(svg, asset), true);
    const tags = [...svg.matchAll(/<\/?([a-zA-Z][\w:-]*)/g)].map((match) => match[1].toLowerCase());
    assert.deepEqual(
      [...new Set(tags)].sort(),
      ["path", "svg"],
      `${asset} uses only path/svg tags`
    );
    assert.doesNotMatch(svg, /<text|<tspan|<image|<script|<foreignObject|<use|<filter/i);
    assert.doesNotMatch(svg, /<circle|<ellipse|<linearGradient|<radialGradient/i);
    assert.doesNotMatch(svg, /font-family|@font-face|@import|href|xlink:href|url\(/i);
    assert.doesNotMatch(svg, /data:image\/|base64,/i);
  }
});

test("SVG validator fails closed on unsafe constructs", () => {
  const safe = buildKhubSvg("glyph", { canvasFill: null });
  const unsafeVariants: Array<[string, string]> = [
    ["<text> KHUB </text>", /text elements/],
    ["<tspan>x</tspan>", /tspan elements/],
    ['<image href="https://example.test/x.png"/>', /image elements/],
    ["<script>alert(1)</script>", /script elements/],
    ["<foreignObject/>", /foreignObject elements/],
    ['<use href="#x"/>', /use elements/],
    ["<filter/>", /filter elements/],
    ["<linearGradient/>", /gradient elements/],
    ['<circle cx="4" cy="4" r="2"/>', /circle elements/],
    ['<ellipse rx="4" ry="2"/>', /ellipse elements/],
    ['style="font-family: serif"', /font and CSS imports/],
    ["@font-face{}", /font and CSS imports/],
    ["@import url(x)", /font and CSS imports/],
    ['href="x"', /href references/],
    ['xlink:href="x"', /href references/],
    ["url(#gradient)", /url\(\) references/],
    ['<image href="data:image/png;base64,AAAA"/>', /image elements/],
    ['onload="x()"', /event handlers/],
    ["<defs/>", /declarative SVG constructs/],
  ];
  for (const [fragment, message] of unsafeVariants) {
    assert.throws(() => assertSafeKhubSvg(safe.replace(">", `>${fragment}`)), message, fragment);
  }
  assert.throws(
    () => assertSafeKhubSvg(safe.replace("<path", '<rect fill="#fff"')),
    /non-path geometry|unsupported/
  );
  assert.throws(
    () => assertSafeKhubSvg(safe.replace("<svg", '<svg data-x="1"')),
    /unsupported attribute/
  );
  assert.throws(
    () => assertSafeKhubSvg(safe.replace("<svg", "<svg") + "</svg><svg/>"),
    /exactly one/
  );
});
