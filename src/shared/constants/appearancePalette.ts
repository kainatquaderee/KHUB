import { z } from "zod";

/**
 * Appearance palettes (Settings → Appearance → Color palette).
 *
 * The canonical allowlist is the single source of truth shared by the Zod schema, the theme store,
 * the pre-paint boot script, the browser-chrome meta resolver and the CSS skins. Every value is a
 * KHUB catalogue ID; `editions` is the branded default and keeps the wire value
 * `data-ci-appearance="editions"`, `classic` is the legacy kit look (no attribute). The remaining
 * IDs are applied through `data-khub-skin` by src/app/khub-themes.css.
 *
 * Aliases are accepted on read ONLY (old/mistyped stored values); they never become selector tiles
 * and are never emitted as attributes. Unknown values fail closed to `editions`.
 */

export const APPEARANCE_PALETTES = [
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
] as const;

export type AppearancePalette = (typeof APPEARANCE_PALETTES)[number];

/** Canonical-only Zod allowlist: aliases are resolved before validation, never added to it. */
export const appearancePaletteSchema = z.enum(APPEARANCE_PALETTES);

export const DEFAULT_APPEARANCE_PALETTE: AppearancePalette = "editions";

export const PALETTE_ALIASES = {
  nevula: "nebula",
  highcontrast: "high-contrast-dark",
  "hc-dark": "high-contrast-dark",
} as const satisfies Record<string, AppearancePalette>;

export type PaletteAlias = keyof typeof PALETTE_ALIASES;

/** The kit's opt-in attribute and the value that selects Editions. */
export const APPEARANCE_ATTRIBUTE = "data-ci-appearance";
export const EDITIONS_APPEARANCE_VALUE = "editions";

/** `null` means: do not validate / do not resolve (fail closed). */
export function canonicalizeAppearancePalette(value: unknown): AppearancePalette | null {
  if (typeof value !== "string") return null;
  const candidate = Object.hasOwn(PALETTE_ALIASES, value)
    ? PALETTE_ALIASES[value as PaletteAlias]
    : value;
  return appearancePaletteSchema.safeParse(candidate).success
    ? (candidate as AppearancePalette)
    : null;
}

export function isAppearancePalette(value: unknown): value is AppearancePalette {
  return appearancePaletteSchema.safeParse(value).success;
}

/** Anything that is not a canonical ID or a known alias resolves to the default (Editions). */
export function normalizeAppearancePalette(value: unknown): AppearancePalette {
  return canonicalizeAppearancePalette(value) ?? DEFAULT_APPEARANCE_PALETTE;
}
