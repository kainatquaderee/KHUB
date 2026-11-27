import { ciTokens } from "@omniroute/ui-kit/tokens";
import type { AppearancePalette } from "@/shared/constants/appearancePalette";
import { THEME_CATALOG_BY_ID } from "@/shared/constants/themeCatalog";

/**
 * The Editions page background, the branded default (appearancePalette.ts). The kit's `ciTokens`
 * export carries only the base (Classic) tokens, so this hex pair is the mirror of
 * `--ci-color-background` in packages/ui-kit/src/ci-editions.css (light and `data-theme="dark"`).
 * tests/unit/pwa-theme-colors.test.ts pins it to that file.
 */
export const EDITIONS_PAGE_BACKGROUND = THEME_CATALOG_BY_ID.editions.backgrounds;

/**
 * The Classic page background: `--ci-color-background` of the kit's base tokens
 * (packages/ui-kit/src/ci-tokens.css: neutral-25 in light, neutral-950 under `data-theme="dark"`),
 * read from the kit's own token export. tests/unit/pwa-theme-colors.test.ts pins it to the CSS.
 */
export const CLASSIC_PAGE_BACKGROUND = {
  light: ciTokens.color.neutral[25],
  dark: ciTokens.color.neutral[950],
} as const;

/** Browser-chrome colour (`theme-color`) per canonical palette and light/dark mode. */
export const PAGE_BACKGROUND_BY_PALETTE: Record<
  AppearancePalette,
  { readonly light: string; readonly dark: string }
> = Object.fromEntries(
  Object.keys(THEME_CATALOG_BY_ID).map((id) => [
    id,
    id === "classic"
      ? CLASSIC_PAGE_BACKGROUND
      : THEME_CATALOG_BY_ID[id as AppearancePalette].backgrounds,
  ])
) as Record<AppearancePalette, { readonly light: string; readonly dark: string }>;

/** Black browser chrome in both media tags when Accessibility forced dark is active. */
export const HIGH_CONTRAST_PAGE_BACKGROUND = PAGE_BACKGROUND_BY_PALETTE["high-contrast-dark"];

/**
 * Server-rendered browser-chrome / PWA colours (viewport `theme-color`, web manifest). Metadata
 * can't read the visitor's stored palette (it lives in localStorage), so they are the default
 * palette (Editions); the live `theme-color` is then switched to the stored palette by
 * THEME_BOOT_SCRIPT before paint and by the theme store afterwards (src/shared/utils/themeColorMeta.ts).
 * The installed-PWA manifest stays Editions: it is fetched once per install, without the preference.
 */
export const PWA_THEME_COLORS = EDITIONS_PAGE_BACKGROUND;
