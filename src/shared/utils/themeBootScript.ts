import { THEME_CONFIG } from "@/shared/constants/appConfig";
import {
  APPEARANCE_ATTRIBUTE,
  APPEARANCE_PALETTES,
  DEFAULT_APPEARANCE_PALETTE,
  PALETTE_ALIASES,
} from "@/shared/constants/appearancePalette";
import { CI_APPEARANCE_BY_PALETTE, FORCED_DARK_PALETTES } from "@/shared/constants/themeCatalog";
import { PAGE_BACKGROUND_BY_PALETTE } from "@/shared/constants/pwaThemeColors";
import {
  THEME_COLOR_BOOT_ATTRIBUTE,
  THEME_COLOR_FALLBACK_ATTRIBUTE,
  THEME_COLOR_META_SELECTOR,
  THEME_COLOR_PARKED_MEDIA,
  THEME_COLOR_PARKED_MEDIA_ATTRIBUTE,
  themeColorBootValue,
} from "@/shared/utils/themeColorMeta";

/** Compile-time colour maps; stored values are never interpolated into the script source. */
const bootPaletteValues = Object.fromEntries(
  APPEARANCE_PALETTES.map((id) => [id, bootValues(PAGE_BACKGROUND_BY_PALETTE[id])])
);

function bootValues(bg: { light: string; dark: string }) {
  return {
    light: themeColorBootValue(bg.light),
    dark: themeColorBootValue(bg.dark),
  };
}

/**
 * Pre-hydration theme + palette script, inlined in the root layout's <head> so the first paint
 * already has the right look (no flash of the wrong theme or palette).
 *
 * It reads the persisted `theme` store (zustand `persist`: `{ state: { theme, palette } }`) and:
 * - resolves aliases against the canonical allowlist, failing closed to Editions;
 * - resolves light/dark (stored theme, or the system preference for "system"/nothing stored),
 *   forcing dark for Accessibility, onto `.dark`, `data-theme` and `color-scheme`;
 * - keeps the kit's `data-ci-appearance="editions"` for Editions, removes it for Classic, and
 *   otherwise writes the canonical palette ID; `data-khub-skin` always carries the canonical ID;
 * - points the browser chrome (`<meta name="theme-color">`) at the palette's page background for
 *   the active mode — the rule of resolveThemeColor() in src/shared/utils/themeColorMeta.ts —
 *   adding one if the page has none yet. A server tag (Editions) whose colour differs is not
 *   rewritten but parked behind a copy, so React can still adopt it at hydration (see the note in
 *   themeColorMeta.ts, #19066).
 *
 * Keep in sync with applyTheme()/applyPalette() in src/store/themeStore.ts, global-error.tsx and
 * themeColorMeta.ts. Plain ES5 on purpose: it runs before any bundle, in every supported browser.
 */
export const THEME_BOOT_SCRIPT = `try {
  var root = document.documentElement;
  var stored = localStorage.getItem(${JSON.stringify(THEME_CONFIG.storageKey)});
  var parsed = stored ? JSON.parse(stored) : null;
  var state = (parsed && parsed.state) || {};
  var theme = state.theme || ${JSON.stringify(THEME_CONFIG.defaultTheme)};
  var palette = state.palette || ${JSON.stringify(DEFAULT_APPEARANCE_PALETTE)};
  var aliases = ${JSON.stringify(PALETTE_ALIASES)};
  if (Object.prototype.hasOwnProperty.call(aliases, palette)) palette = aliases[palette];
  var canonical = ${JSON.stringify(APPEARANCE_PALETTES)};
  if (canonical.indexOf(palette) < 0) palette = ${JSON.stringify(DEFAULT_APPEARANCE_PALETTE)};
  var forced = ${JSON.stringify(FORCED_DARK_PALETTES)}.indexOf(palette) >= 0;
  var systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  var dark = forced || theme === "dark" || (theme === "system" && systemDark);
  root.classList.toggle("dark", dark);
  root.dataset.theme = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
  root.dataset.khubSkin = palette;
  var appearance = ${JSON.stringify(CI_APPEARANCE_BY_PALETTE)}[palette];
  if (appearance === null) root.removeAttribute(${JSON.stringify(APPEARANCE_ATTRIBUTE)});
  else root.setAttribute(${JSON.stringify(APPEARANCE_ATTRIBUTE)}, appearance);
  var bg = ${JSON.stringify(PAGE_BACKGROUND_BY_PALETTE)}[palette];
  var copyBg = ${JSON.stringify(bootPaletteValues)}[palette];
  var metas = document.querySelectorAll(${JSON.stringify(THEME_COLOR_META_SELECTOR)});
  if (!metas.length) {
    var meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.setAttribute(${JSON.stringify(THEME_COLOR_FALLBACK_ATTRIBUTE)}, "");
    document.head.appendChild(meta);
    metas = [meta];
  }
  for (var i = 0; i < metas.length; i++) {
    var tag = metas[i];
    if (tag.hasAttribute(${JSON.stringify(THEME_COLOR_BOOT_ATTRIBUTE)}) || tag.hasAttribute(${JSON.stringify(THEME_COLOR_PARKED_MEDIA_ATTRIBUTE)})) continue;
    var rawMedia = tag.getAttribute("media") || "";
    var media = rawMedia.replace(/\\s+/g, "");
    var metaDark = forced || theme === "dark" ? true : theme !== "system" ? false
      : media.indexOf("prefers-color-scheme:dark") >= 0 ? true
      : media.indexOf("prefers-color-scheme:light") >= 0 ? false : systemDark;
    var color = metaDark ? bg.dark : bg.light;
    if (tag.hasAttribute(${JSON.stringify(THEME_COLOR_FALLBACK_ATTRIBUTE)})) {
      tag.setAttribute("content", color);
    } else if (tag.getAttribute("content") !== color) {
      var copy = document.createElement("meta");
      copy.setAttribute("name", "theme-color");
      if (rawMedia) copy.setAttribute("media", rawMedia);
      copy.setAttribute(${JSON.stringify(THEME_COLOR_BOOT_ATTRIBUTE)}, "");
      copy.setAttribute("content", metaDark ? copyBg.dark : copyBg.light);
      tag.parentNode.insertBefore(copy, tag);
      tag.setAttribute(${JSON.stringify(THEME_COLOR_PARKED_MEDIA_ATTRIBUTE)}, rawMedia);
      tag.setAttribute("media", ${JSON.stringify(THEME_COLOR_PARKED_MEDIA)});
    }
  }
} catch (e) {}`;
