import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APPEARANCE_PALETTES,
  DEFAULT_APPEARANCE_PALETTE,
  PALETTE_ALIASES,
  appearancePaletteSchema,
  canonicalizeAppearancePalette,
  isAppearancePalette,
  normalizeAppearancePalette,
} from "../../src/shared/constants/appearancePalette.ts";
import {
  CI_APPEARANCE_BY_PALETTE,
  FORCED_DARK_PALETTES,
  SELECTABLE_THEME_IDS,
  THEME_CATALOG,
  THEME_CATALOG_BY_ID,
  THEME_FAMILIES,
  type ThemeTokens,
} from "../../src/shared/constants/themeCatalog.ts";
import {
  EDITIONS_PAGE_BACKGROUND,
  PAGE_BACKGROUND_BY_PALETTE,
} from "../../src/shared/constants/pwaThemeColors.ts";
import { THEME_BOOT_SCRIPT } from "../../src/shared/utils/themeBootScript.ts";

// AC-5/6/7/11/17: one canonical catalogue, five mirrors (Zod, store, boot script, meta resolver,
// CSS/PWA backgrounds) and no aliases or orphan IDs in the selector.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const css = read("src/app/khub-themes.css");

const TOKEN_DECL: Record<keyof ThemeTokens, string> = {
  background: "khub-background",
  text: "khub-text",
  textSecondary: "khub-text-secondary",
  controlText: "khub-control-text",
  controlBorder: "khub-control-border",
  focus: "khub-focus",
  accentLight: "khub-accent-light",
  accentDark: "khub-accent-dark",
};

function cssBlock(selector: string) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `khub-themes.css declares ${selector}`);
  const end = css.indexOf("\n}", start);
  assert.ok(end > start, `${selector} is a complete block`);
  return css.slice(start, end);
}

function declaration(block: string, name: string): string {
  const match = new RegExp(`^\\s*--${name}:\\s*([^;]+);`, "m").exec(block);
  assert.ok(match, `--${name} is declared`);
  return match[1].trim().toLowerCase();
}

test("exactly 14 canonical palette IDs, unique labels and unique aliases", () => {
  assert.deepEqual(
    [...APPEARANCE_PALETTES],
    [
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
    ]
  );
  assert.equal(DEFAULT_APPEARANCE_PALETTE, "editions");
  assert.equal(THEME_CATALOG.length, APPEARANCE_PALETTES.length);
  assert.deepEqual(
    THEME_CATALOG.map((entry) => entry.id),
    [...APPEARANCE_PALETTES]
  );
  assert.equal(new Set(THEME_CATALOG.map((entry) => entry.label)).size, THEME_CATALOG.length);
  assert.deepEqual([...SELECTABLE_THEME_IDS], [...APPEARANCE_PALETTES]);
  assert.deepEqual(Object.keys(THEME_CATALOG_BY_ID).sort(), [...APPEARANCE_PALETTES].sort());
  assert.deepEqual(Object.keys(CI_APPEARANCE_BY_PALETTE).sort(), [...APPEARANCE_PALETTES].sort());
  assert.deepEqual(Object.keys(PAGE_BACKGROUND_BY_PALETTE).sort(), [...APPEARANCE_PALETTES].sort());

  assert.deepEqual(
    [...THEME_FAMILIES],
    ["Signature", "Atmospheric", "Parody", "Creative", "Accessibility"]
  );
  for (const entry of THEME_CATALOG) {
    assert.ok(THEME_FAMILIES.includes(entry.family), `${entry.id} uses a closed family`);
    assert.ok(entry.description.length > 10, `${entry.id} has a description`);
    assert.ok(entry.source.label && entry.source.href, `${entry.id} cites a source`);
    const href = entry.source.href.split("#")[0];
    if (!href.startsWith("https://")) {
      assert.ok(fs.existsSync(path.join(ROOT, href)), `${entry.id} source link resolves: ${href}`);
    }
  }
  assert.deepEqual(PALETTE_ALIASES, {
    nevula: "nebula",
    highcontrast: "high-contrast-dark",
    "hc-dark": "high-contrast-dark",
  });
  for (const alias of Object.keys(PALETTE_ALIASES)) {
    assert.equal(isAppearancePalette(alias), false, "aliases never enter the Zod allowlist");
    assert.ok(isAppearancePalette(normalizeAppearancePalette(alias)), "alias resolves canonically");
  }
  assert.equal(appearancePaletteSchema.safeParse("khub-signature").success, false);
  assert.equal(canonicalizeAppearancePalette("khub-signature"), null);
  assert.equal(normalizeAppearancePalette("khub-signature"), "editions");
});

test("parody rows cite source brand → original label → lowercase ASCII ID", () => {
  const doc = read("docs/guides/KHUB_PARODY_THEMES.md");
  const parodies = THEME_CATALOG.filter((entry) => entry.parodyOf);
  assert.deepEqual(
    parodies.map((entry) => entry.id),
    ["gutgub", "youyou", "gutlib"]
  );
  for (const entry of parodies) {
    const { brand, sourceUrl } = entry.parodyOf!;
    assert.match(entry.id, /^[a-z]+(?:-[a-z]+)*$/);
    assert.equal(entry.source.href, sourceUrl);
    const row = doc.split("\n").find((line) => line.includes(`[${brand}](${sourceUrl})`));
    assert.ok(row, `the convention doc has a row for ${brand}`);
    assert.ok(
      row.includes(entry.label) && row.includes(`\`${entry.id}\``),
      `the convention doc records ${brand} → ${entry.label} → ${entry.id}`
    );
  }
  assert.match(doc, /No third-party logo, icon, wordmark/);
  assert.match(doc, /aliases.*never rendered as tiles/s);
});

test("khub-themes.css mirrors every catalog token for both modes; no orphan skin blocks", () => {
  for (const entry of THEME_CATALOG) {
    for (const mode of ["light", "dark"] as const) {
      const selector =
        mode === "light"
          ? `html:root:not([data-theme="dark"])[data-khub-skin="${entry.id}"]`
          : `html:root[data-theme="dark"][data-khub-skin="${entry.id}"]`;
      const block = cssBlock(selector);
      for (const [key, decl] of Object.entries(TOKEN_DECL) as Array<[keyof ThemeTokens, string]>) {
        assert.equal(
          declaration(block, decl),
          entry.tokens[mode][key].toLowerCase(),
          `${entry.id}/${mode} --${decl}`
        );
      }
    }
  }
  const skinIds = new Set([...css.matchAll(/\[data-khub-skin="([a-z-]+)"\]/g)].map((m) => m[1]));
  for (const id of skinIds) {
    assert.ok(isAppearancePalette(id), `CSS has no orphan skin: ${id}`);
  }
  for (const id of APPEARANCE_PALETTES) assert.ok(skinIds.has(id), `${id} has a CSS hook`);
});

test("the browser-chrome mirror uses catalog backgrounds; forced dark is black in both modes", () => {
  for (const entry of THEME_CATALOG) {
    assert.deepEqual(PAGE_BACKGROUND_BY_PALETTE[entry.id], entry.backgrounds, entry.id);
  }
  assert.equal(PAGE_BACKGROUND_BY_PALETTE.editions, EDITIONS_PAGE_BACKGROUND);
  assert.deepEqual(
    { ...PAGE_BACKGROUND_BY_PALETTE["high-contrast-dark"] },
    {
      light: "#000000",
      dark: "#000000",
    }
  );
  assert.deepEqual([...FORCED_DARK_PALETTES], ["high-contrast-dark"]);
  assert.equal(PAGE_BACKGROUND_BY_PALETTE.editions.light, "#f3f1e9");
  assert.equal(PAGE_BACKGROUND_BY_PALETTE.editions.dark, "#11120f");
});

test("four runtime mirrors embed the same canonical maps (no per-mirror hand-written list)", () => {
  assert.ok(THEME_BOOT_SCRIPT.includes(JSON.stringify(APPEARANCE_PALETTES)));
  assert.ok(THEME_BOOT_SCRIPT.includes(JSON.stringify(PALETTE_ALIASES)));
  assert.ok(THEME_BOOT_SCRIPT.includes(JSON.stringify(FORCED_DARK_PALETTES)));
  assert.ok(THEME_BOOT_SCRIPT.includes(JSON.stringify(CI_APPEARANCE_BY_PALETTE)));
  assert.ok(THEME_BOOT_SCRIPT.includes(JSON.stringify(PAGE_BACKGROUND_BY_PALETTE)));
  assert.ok(THEME_BOOT_SCRIPT.includes("root.dataset.khubSkin = palette"));
  assert.doesNotMatch(read("src/shared/utils/themeBootScript.ts"), /#[0-9a-f]{6}/i);

  const meta = read("src/shared/utils/themeColorMeta.ts");
  assert.match(meta, /isForcedDarkPalette, resolvePalette/);
  assert.match(meta, /resolvePalette\(palette\)/);
  const store = read("src/store/themeStore.ts");
  assert.match(store, /from "@\/shared\/constants\/themeCatalog"/);
  assert.match(store, /root\.dataset\.khubSkin = id/);
  const errorPage = read("src/app/global-error.tsx");
  assert.match(errorPage, /data-khub-skin=\{palette\}/);
  assert.match(errorPage, /ciAppearanceValue\(palette\)/);
  const selector = read("src/app/(dashboard)/dashboard/settings/components/AppearanceTab.tsx");
  assert.match(selector, /THEME_CATALOG\.map/);
  assert.doesNotMatch(selector, /APPEARANCE_PALETTES\.map/);
  assert.match(read("src/app/globals.css"), /@import "\.\/khub-themes\.css";/);
});

test("the default palette is the branded Editions look, applied through app-layer CSS", () => {
  const editions = THEME_CATALOG_BY_ID.editions;
  assert.equal(editions.label, "KHUB Editions");
  assert.equal(editions.family, "Signature");
  assert.equal(CI_APPEARANCE_BY_PALETTE.editions, "editions");
  assert.match(
    read("src/app/khub-themes.css"),
    /\[data-khub-skin="editions"\] :is\(\.ci-page-title, h1\)::after/
  );
  assert.match(read("src/app/khub-themes.css"), /--khub-motif-color: var\(--khub-accent-light\)/);
});
