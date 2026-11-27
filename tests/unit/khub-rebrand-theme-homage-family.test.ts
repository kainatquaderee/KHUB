/**
 * A4 (KHUB rebrand) — the theme family `Parody` is renamed to `Homage`, with
 * no user-visible `Parody` string left behind and every theme ID frozen.
 *
 * Theme IDs are a persisted contract: `localStorage.theme` / the appearance
 * store holds an ID such as `gutgub`, and `normalizeAppearancePalette()` resolves
 * it on read. Renaming the *family* must not touch those IDs.
 *
 * `parodyOf` is internal metadata (it records which brand a homage references)
 * and may remain — asserted here as a negative control so the rename is not
 * mistaken for a licence to delete the source attribution.
 *
 * Bite: the guard is run over the verbatim pre-change excerpt in the last test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  isAppearancePalette,
  normalizeAppearancePalette,
  canonicalizeAppearancePalette,
} from "../../src/shared/constants/appearancePalette.ts";
import { THEME_CATALOG, THEME_FAMILIES } from "../../src/shared/constants/themeCatalog.ts";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** The 14 canonical IDs, transcribed independently from docs/guides/KHUB_THEMES.md. */
const FROZEN_THEME_IDS = [
  "editions",
  "classic",
  "nord",
  "nebula",
  "aurora",
  "gutgub",
  "youyou",
  "gutlib",
  "synthwave",
  "terminal",
  "paper-ink",
  "sunset-fm",
  "cyber-lime",
  "high-contrast-dark",
];

const HOMAGE_BRANDS = ["GitHub", "YouTube", "GitLab"];

/** User-visible strings that must never read `Parody` again. */
const USER_VISIBLE_SURFACES = [
  "src/shared/constants/themeCatalog.ts",
  "src/app/(dashboard)/dashboard/settings/components/AppearanceTab.tsx",
  "src/app/khub-themes.css",
  "docs/guides/KHUB_THEMES.md",
];

function findVisibleParody(source: string): string[] {
  // Case-sensitive on purpose: the retained internal metadata is `parodyOf`
  // (lowercase p, camelCase) and must not be reported.
  return source.includes("Parody") ? ["Parody"] : [];
}

test("the 14 canonical theme IDs and their order are unchanged", () => {
  assert.deepEqual(
    THEME_CATALOG.map((entry) => entry.id),
    FROZEN_THEME_IDS
  );
});

test("every persisted theme ID still resolves", () => {
  for (const id of FROZEN_THEME_IDS) {
    assert.equal(isAppearancePalette(id), true, `${id} is no longer accepted`);
    assert.equal(canonicalizeAppearancePalette(id), id, `${id} no longer canonicalizes`);
    assert.equal(
      normalizeAppearancePalette(id),
      id,
      `a persisted value of '${id}' must still resolve to itself`
    );
  }
  // Unknown values still fail closed to the branded default.
  assert.equal(normalizeAppearancePalette("gutgub-typo"), "editions");
});

test("the family set is Homage, not Parody, and every row is closed over it", () => {
  assert.ok(THEME_FAMILIES.includes("Homage"), "the family enum must expose Homage");
  assert.equal(
    (THEME_FAMILIES as readonly string[]).includes("Parody"),
    false,
    "the family enum must not expose Parody"
  );
  assert.deepEqual(
    THEME_CATALOG.filter((entry) => entry.family === "Homage").map((entry) => entry.id),
    ["gutgub", "youyou", "gutlib"]
  );
  for (const entry of THEME_CATALOG) {
    assert.ok(THEME_FAMILIES.includes(entry.family), `${entry.id} family is closed`);
    // AppearanceTab renders `${option.family} · ${description}` for the 12 palettes
    // without a dedicated description key, so the family string is user-visible.
    assert.deepEqual(findVisibleParody(entry.family), [], `${entry.id} renders a Parody family`);
    assert.match(entry.family, /^[A-Z][A-Za-z]+$/, `${entry.id} family is a plain label`);
  }
});

test("no user-visible surface still says Parody", () => {
  for (const rel of USER_VISIBLE_SURFACES) {
    assert.deepEqual(findVisibleParody(read(rel)), [], `${rel} still renders "Parody"`);
  }
});

test("homage attribution is retained and documented as Homage", () => {
  const homages = THEME_CATALOG.filter((entry) => entry.parodyOf);
  assert.deepEqual(
    homages.map((entry) => entry.parodyOf?.brand),
    HOMAGE_BRANDS,
    "the internal parodyOf attribution must survive the rename"
  );

  const doc = read("docs/guides/KHUB_THEMES.md");
  for (const entry of homages) {
    const { brand, sourceUrl } = entry.parodyOf!;
    const row = doc.split("\n").find((line) => line.includes(`](${sourceUrl})`));
    assert.ok(row, `KHUB_THEMES.md documents the ${brand} homage row`);
    assert.ok(row!.includes(`\`${entry.id}\``), `the row carries the stable ID \`${entry.id}\``);
    assert.ok(row!.includes("Homage"), `the ${brand} row is filed under Homage`);
    assert.ok(row!.includes(entry.label), `the ${brand} row carries the label ${entry.label}`);
  }

  // The three homage skin blocks keep their IDs and are commented as Homage.
  const css = read("src/app/khub-themes.css");
  for (const id of ["gutgub", "youyou", "gutlib"]) {
    assert.ok(css.includes(`[data-khub-skin="${id}"]`), `khub-themes.css keeps the ${id} skin`);
  }

  // Doc claims carried over from the deleted docs/guides/KHUB_PARODY_THEMES.md. The dev's
  // appearance-catalog.test.ts rewrite dropped both guards; restored here so the claims
  // cannot rot silently (the wording moved into KHUB_THEMES.md).
  assert.match(doc, /attribution-only and ship no third-party assets/);
  assert.match(doc, /aliases are accepted on read only and never\s+rendered as selector tiles/);
});

test("bite — the guard flags the pre-change family row and doc heading", () => {
  // Verbatim pre-change excerpts (git show cd13c8b33:<file>).
  const preChangeCatalog = ["export const THEME_FAMILIES = [", '  "Parody",', "] as const;"].join(
    "\n"
  );
  const preChangeDoc = "# KHUB Parody themes — Parody";
  assert.deepEqual(findVisibleParody(preChangeCatalog), ["Parody"]);
  assert.deepEqual(findVisibleParody(preChangeDoc), ["Parody"]);
});
