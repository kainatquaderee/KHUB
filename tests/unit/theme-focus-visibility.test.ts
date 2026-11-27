import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// AC-15/18: the dedicated Accessibility theme carries its state in borders and outlines, not in
// gradients, shadows or opacity, and nothing auto-switches it from the OS contrast preference.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const css = read("src/app/khub-themes.css");
const start = css.indexOf("/* High Contrast Dark — Accessibility (forced dark) */");
assert.ok(start >= 0, "the Accessibility skin has its own CSS section");
const hc = css.slice(start);

test("High Contrast Dark draws 2px control borders and a 3px offset focus ring", () => {
  assert.match(
    hc,
    /html:root\[data-khub-skin="high-contrast-dark"\][\s\S]*?border: 2px solid var\(--khub-control-border\)/,
    "controls get a 2px cyan border"
  );
  assert.match(
    hc,
    /html:root\[data-khub-skin="high-contrast-dark"\] :focus-visible \{\s*outline: 3px solid var\(--khub-focus\) !important;\s*outline-offset: 2px;/,
    "focus is a 3px white ring offset from the control"
  );
  assert.match(hc, /border-style: dashed/, "disabled state uses a distinct border style");
});

test("the Accessibility skin never signals state with gradients, shadows or opacity", () => {
  assert.doesNotMatch(hc, /linear-gradient|radial-gradient|conic-gradient/);
  assert.doesNotMatch(hc, /opacity\s*:/);
  assert.match(hc, /background-image: none !important/);
  assert.match(hc, /box-shadow: none !important/);
  assert.match(hc, /text-shadow: none !important/);
  assert.doesNotMatch(hc, /box-shadow:\s*(?!\s*none)/);
  assert.doesNotMatch(hc, /text-shadow:\s*(?!\s*none)/);
});

test("no theme surface auto-switches from the OS prefers-contrast setting", () => {
  for (const file of [
    "src/app/khub-themes.css",
    "src/app/globals.css",
    "src/shared/constants/themeCatalog.ts",
    "src/shared/utils/themeBootScript.ts",
    "src/store/themeStore.ts",
    "src/shared/utils/themeColorMeta.ts",
    "src/app/global-error.tsx",
  ]) {
    assert.doesNotMatch(read(file), /prefers-contrast/i, `${file} has no contrast media query`);
  }
});
