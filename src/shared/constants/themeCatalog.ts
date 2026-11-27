import {
  APPEARANCE_PALETTES,
  normalizeAppearancePalette,
  type AppearancePalette,
} from "@/shared/constants/appearancePalette";

/**
 * KHUB appearance catalogue. One row per canonical palette ID, no aliases and no orphan IDs.
 *
 * Token values are mirrored verbatim by src/app/khub-themes.css (tests/unit/appearance-catalog.test.ts
 * and tests/unit/theme-token-contrast.test.ts compare the two). `backgrounds` feeds the browser
 * chrome through src/shared/constants/pwaThemeColors.ts. The family enum is closed: adding a new
 * family is a catalogue change, not an ad-hoc string in a component.
 */

export const THEME_FAMILIES = [
  "Signature",
  "Atmospheric",
  "Homage",
  "Creative",
  "Accessibility",
] as const;

export type ThemeFamily = (typeof THEME_FAMILIES)[number];

/** Ink/outline tokens that every skin declares for both modes. */
export interface ThemeTokens {
  background: string;
  text: string;
  textSecondary: string;
  controlText: string;
  controlBorder: string;
  focus: string;
  /** Accent for light mode and for dark mode; both are readable on their own background. */
  accentLight: string;
  accentDark: string;
}

export interface ThemeCatalogEntry {
  readonly id: AppearancePalette;
  readonly label: string;
  readonly description: string;
  readonly family: ThemeFamily;
  /** Source of the palette's colour/typography idea: a repo file or an official brand page. */
  readonly source: { readonly label: string; readonly href: string };
  /** Homage rows record the referenced brand; assets are always original. */
  readonly parodyOf?: { readonly brand: string; readonly sourceUrl: string };
  readonly forcedDark: boolean;
  readonly backgrounds: { readonly light: string; readonly dark: string };
  readonly tokens: { readonly light: ThemeTokens; readonly dark: ThemeTokens };
}

const t = (
  background: string,
  text: string,
  textSecondary: string,
  controlText: string,
  controlBorder: string,
  focus: string,
  accentLight: string,
  accentDark: string
): ThemeTokens => ({
  background,
  text,
  textSecondary,
  controlText,
  controlBorder,
  focus,
  accentLight,
  accentDark,
});

export const THEME_CATALOG: readonly ThemeCatalogEntry[] = [
  {
    id: "editions",
    label: "KHUB Editions",
    description: "Warm paper neutrals with the KHUB copper accent.",
    family: "Signature",
    source: { label: "CI UI Kit Editions", href: "packages/ui-kit/src/ci-editions.css" },
    forcedDark: false,
    backgrounds: { light: "#f3f1e9", dark: "#11120f" },
    tokens: {
      light: t(
        "#f3f1e9",
        "#20211c",
        "#626459",
        "#20211c",
        "#626459",
        "#99562f",
        "#99562f",
        "#e5ac82"
      ),
      dark: t(
        "#11120f",
        "#f2f0e8",
        "#a5a69b",
        "#f2f0e8",
        "#a5a69b",
        "#e5ac82",
        "#99562f",
        "#e5ac82"
      ),
    },
  },
  {
    id: "classic",
    label: "Classic",
    description: "The original cool neutrals and lime accent.",
    family: "Signature",
    source: { label: "CI UI Kit base tokens", href: "packages/ui-kit/src/ci-tokens.css" },
    forcedDark: false,
    backgrounds: { light: "#fbfbf8", dark: "#040d10" },
    tokens: {
      light: t(
        "#fbfbf8",
        "#031a1b",
        "#575f5f",
        "#040d10",
        "#575f5f",
        "#4d5c00",
        "#4d5c00",
        "#d8ff00"
      ),
      dark: t(
        "#040d10",
        "#f1f7f7",
        "#9ca39f",
        "#f1f7f7",
        "#9ca39f",
        "#d8ff00",
        "#4d5c00",
        "#d8ff00"
      ),
    },
  },
  {
    id: "nord",
    label: "Nord",
    description: "Muted arctic blue with crisp, cool contrast.",
    family: "Atmospheric",
    source: { label: "Nord colour palette", href: "https://www.nordtheme.com/" },
    forcedDark: false,
    backgrounds: { light: "#f4f7fb", dark: "#242936" },
    tokens: {
      light: t(
        "#f4f7fb",
        "#2e3540",
        "#4c5a6b",
        "#263746",
        "#3d5a80",
        "#3d5a80",
        "#3d5a80",
        "#88c0d0"
      ),
      dark: t(
        "#242936",
        "#e5edf8",
        "#b8c7dc",
        "#e5edf8",
        "#8fabc7",
        "#ffffff",
        "#3d5a80",
        "#88c0d0"
      ),
    },
  },
  {
    id: "nebula",
    label: "Nebula",
    description: "Deep violet sky with luminous lilac ink.",
    family: "Atmospheric",
    source: { label: "KHUB nebula skin", href: "src/app/khub-themes.css#nebula" },
    forcedDark: false,
    backgrounds: { light: "#f7f4fb", dark: "#171326" },
    tokens: {
      light: t(
        "#f7f4fb",
        "#2a2038",
        "#574a68",
        "#372849",
        "#6a4c93",
        "#5b3a8e",
        "#6a4c93",
        "#c9a7ff"
      ),
      dark: t(
        "#171326",
        "#f1eaff",
        "#c6b8e0",
        "#f1eaff",
        "#9d8ec7",
        "#e0d4ff",
        "#6a4c93",
        "#c9a7ff"
      ),
    },
  },
  {
    id: "aurora",
    label: "Aurora",
    description: "Polar green with a clear, natural rhythm.",
    family: "Atmospheric",
    source: { label: "KHUB aurora skin", href: "src/app/khub-themes.css#aurora" },
    forcedDark: false,
    backgrounds: { light: "#f2f8f4", dark: "#0d1b16" },
    tokens: {
      light: t(
        "#f2f8f4",
        "#173026",
        "#46685a",
        "#1b3b2e",
        "#3c7a5a",
        "#256f4f",
        "#256f4f",
        "#7be0ad"
      ),
      dark: t(
        "#0d1b16",
        "#e4f8ed",
        "#b3d9c5",
        "#e4f8ed",
        "#7bc9a2",
        "#b6ffd6",
        "#256f4f",
        "#7be0ad"
      ),
    },
  },
  {
    id: "gutgub",
    label: "Gutgub",
    description: "Playful code-forge homage in slate and blue.",
    family: "Homage",
    source: { label: "GitHub", href: "https://github.com/" },
    parodyOf: { brand: "GitHub", sourceUrl: "https://github.com/" },
    forcedDark: false,
    backgrounds: { light: "#f6f8fa", dark: "#0d1117" },
    tokens: {
      light: t(
        "#f6f8fa",
        "#1f2328",
        "#57606a",
        "#24292f",
        "#57606a",
        "#0969da",
        "#0550ae",
        "#58a6ff"
      ),
      dark: t(
        "#0d1117",
        "#f0f6fc",
        "#c9d1d9",
        "#f0f6fc",
        "#8b949e",
        "#79c0ff",
        "#0550ae",
        "#58a6ff"
      ),
    },
  },
  {
    id: "youyou",
    label: "Youyou",
    description: "Video-club homage with a warm red highlight.",
    family: "Homage",
    source: { label: "YouTube", href: "https://www.youtube.com/" },
    parodyOf: { brand: "YouTube", sourceUrl: "https://www.youtube.com/" },
    forcedDark: false,
    backgrounds: { light: "#ffffff", dark: "#0f0f0f" },
    tokens: {
      light: t(
        "#ffffff",
        "#0f0f0f",
        "#606060",
        "#212121",
        "#767676",
        "#b00020",
        "#c4302b",
        "#ff6b6b"
      ),
      dark: t(
        "#0f0f0f",
        "#f1f1f1",
        "#d6d6d6",
        "#ffffff",
        "#a8a8a8",
        "#ffffff",
        "#c4302b",
        "#ff6b6b"
      ),
    },
  },
  {
    id: "gutlib",
    label: "Gutlib",
    description: "Repository-forge homage in soft plum.",
    family: "Homage",
    source: { label: "GitLab", href: "https://gitlab.com/" },
    parodyOf: { brand: "GitLab", sourceUrl: "https://gitlab.com/" },
    forcedDark: false,
    backgrounds: { light: "#f9f7f5", dark: "#17141d" },
    tokens: {
      light: t(
        "#f9f7f5",
        "#25232a",
        "#5d5766",
        "#2e2a35",
        "#6f496f",
        "#7d3c98",
        "#843779",
        "#c592d8"
      ),
      dark: t(
        "#17141d",
        "#f4effa",
        "#c9bcd6",
        "#f4effa",
        "#a48cb6",
        "#e0c8ff",
        "#843779",
        "#c592d8"
      ),
    },
  },
  {
    id: "synthwave",
    label: "Synthwave",
    description: "Neon magenta over a midnight violet grid.",
    family: "Creative",
    source: { label: "KHUB synthwave skin", href: "src/app/khub-themes.css#synthwave" },
    forcedDark: false,
    backgrounds: { light: "#fdf5ff", dark: "#160a24" },
    tokens: {
      light: t(
        "#fdf5ff",
        "#2a1740",
        "#623a7c",
        "#361a50",
        "#8a2be2",
        "#7b2cbf",
        "#7b2cbf",
        "#ff71ce"
      ),
      dark: t(
        "#160a24",
        "#f7e9ff",
        "#dcb8f6",
        "#f7e9ff",
        "#b388e8",
        "#ff71ce",
        "#7b2cbf",
        "#ff71ce"
      ),
    },
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "Monospaced, high-legibility green-on-black.",
    family: "Creative",
    source: { label: "KHUB terminal skin", href: "src/app/khub-themes.css#terminal" },
    forcedDark: false,
    backgrounds: { light: "#f5f7f0", dark: "#050c06" },
    tokens: {
      light: t(
        "#f5f7f0",
        "#18321d",
        "#456347",
        "#1d3b2e",
        "#3f6b45",
        "#246b2b",
        "#137a2c",
        "#62d97a"
      ),
      dark: t(
        "#050c06",
        "#d8ffd8",
        "#a8d8a8",
        "#d8ffd8",
        "#62c776",
        "#7dff9a",
        "#137a2c",
        "#62d97a"
      ),
    },
  },
  {
    id: "paper-ink",
    label: "Paper Ink",
    description: "Ink-on-paper serif with a restrained sepia accent.",
    family: "Creative",
    source: { label: "KHUB paper-ink skin", href: "src/app/khub-themes.css#paper-ink" },
    forcedDark: false,
    backgrounds: { light: "#f7f3e8", dark: "#16130f" },
    tokens: {
      light: t(
        "#f7f3e8",
        "#1e1c17",
        "#585247",
        "#242019",
        "#6b6050",
        "#6b5836",
        "#8a5a2b",
        "#d8b47a"
      ),
      dark: t(
        "#16130f",
        "#f4efe3",
        "#cdc4b2",
        "#f4efe3",
        "#a89a83",
        "#e2c99b",
        "#8a5a2b",
        "#d8b47a"
      ),
    },
  },
  {
    id: "sunset-fm",
    label: "Sunset FM",
    description: "Late-night radio warmth in amber and rust.",
    family: "Creative",
    source: { label: "KHUB sunset-fm skin", href: "src/app/khub-themes.css#sunset-fm" },
    forcedDark: false,
    backgrounds: { light: "#fff7ee", dark: "#1c100a" },
    tokens: {
      light: t(
        "#fff7ee",
        "#341d13",
        "#714e3b",
        "#3d2418",
        "#a3552d",
        "#a04000",
        "#c2410c",
        "#ff9d66"
      ),
      dark: t(
        "#1c100a",
        "#fff1e6",
        "#e0bda5",
        "#fff1e6",
        "#db9466",
        "#ffb27a",
        "#c2410c",
        "#ff9d66"
      ),
    },
  },
  {
    id: "cyber-lime",
    label: "Cyber Lime",
    description: "Sharp acid-lime outlines on an almost-black canvas.",
    family: "Creative",
    source: { label: "KHUB cyber-lime skin", href: "src/app/khub-themes.css#cyber-lime" },
    forcedDark: false,
    backgrounds: { light: "#f7fbed", dark: "#0b1005" },
    tokens: {
      light: t(
        "#f7fbed",
        "#16220c",
        "#4c5c30",
        "#1d2e0c",
        "#607a29",
        "#4c6b0f",
        "#4d6b00",
        "#c2e600"
      ),
      dark: t(
        "#0b1005",
        "#efffdb",
        "#c2d99c",
        "#efffdb",
        "#a7d34f",
        "#d8ff00",
        "#4d6b00",
        "#c2e600"
      ),
    },
  },
  {
    id: "high-contrast-dark",
    label: "High Contrast Dark",
    description: "Maximum-contrast black canvas, bright text and thick focus rings.",
    family: "Accessibility",
    source: {
      label: "WCAG 2.2 Contrast (Enhanced)",
      href: "https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html",
    },
    forcedDark: true,
    backgrounds: { light: "#000000", dark: "#000000" },
    tokens: {
      light: t(
        "#000000",
        "#FFFFFF",
        "#D9F2FF",
        "#FFFFFF",
        "#00FFFF",
        "#FFFFFF",
        "#00FFFF",
        "#B6FF00"
      ),
      dark: t(
        "#000000",
        "#FFFFFF",
        "#D9F2FF",
        "#FFFFFF",
        "#00FFFF",
        "#FFFFFF",
        "#00FFFF",
        "#B6FF00"
      ),
    },
  },
];

export const THEME_CATALOG_BY_ID: Record<AppearancePalette, ThemeCatalogEntry> = Object.fromEntries(
  THEME_CATALOG.map((entry) => [entry.id, entry])
) as Record<AppearancePalette, ThemeCatalogEntry>;

export const FORCED_DARK_PALETTES: readonly AppearancePalette[] = THEME_CATALOG.filter(
  (entry) => entry.forcedDark
).map((entry) => entry.id);

/** What the kit's `data-ci-appearance` attribute carries: `null` means "remove it" (Classic). */
export const CI_APPEARANCE_BY_PALETTE: Record<AppearancePalette, string | null> =
  Object.fromEntries(
    THEME_CATALOG.map((entry) => [
      entry.id,
      entry.id === "classic" ? null : entry.id === "editions" ? "editions" : entry.id,
    ])
  ) as Record<AppearancePalette, string | null>;

export function resolvePalette(value: unknown): AppearancePalette {
  return normalizeAppearancePalette(value);
}

export function getThemeEntry(value: unknown): ThemeCatalogEntry {
  return THEME_CATALOG_BY_ID[normalizeAppearancePalette(value)];
}

export function ciAppearanceValue(value: unknown): string | null {
  return CI_APPEARANCE_BY_PALETTE[normalizeAppearancePalette(value)];
}

export function skinValue(value: unknown): AppearancePalette {
  return normalizeAppearancePalette(value);
}

export function isForcedDarkPalette(value: unknown): boolean {
  return getThemeEntry(value).forcedDark;
}

/** Every canonical ID is a tile in the selector; aliases resolve here but are never rendered. */
export const SELECTABLE_THEME_IDS: readonly AppearancePalette[] = APPEARANCE_PALETTES;
