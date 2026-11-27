"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { THEME_CONFIG } from "@/shared/constants/appConfig";
import {
  APPEARANCE_ATTRIBUTE,
  DEFAULT_APPEARANCE_PALETTE,
  type AppearancePalette,
} from "@/shared/constants/appearancePalette";
import { ciAppearanceValue, isForcedDarkPalette, skinValue } from "@/shared/constants/themeCatalog";
import { applyThemeColor } from "@/shared/utils/themeColorMeta";

interface ThemeState {
  theme: string;
  palette: AppearancePalette;
  setTheme: (theme: string) => void;
  toggleTheme: () => void;
  setPalette: (palette: AppearancePalette) => void;
  initTheme: () => void;
}

/**
 * Apply light/dark to <html>. The CI UI Kit flips its `--ci-*` tokens on `data-theme="dark"`;
 * the `.dark` class stays for the legacy `dark:` utilities. Accessibility's High Contrast Dark
 * forces dark even when the stored mode is "light"/"system". Keep this in sync with
 * THEME_BOOT_SCRIPT (src/shared/utils/themeBootScript.ts).
 */
export function applyTheme(theme: string, palette?: unknown) {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark =
    isForcedDarkPalette(palette) || theme === "dark" || (theme === "system" && systemDark);
  root.classList.toggle("dark", isDark);
  root.dataset.theme = isDark ? "dark" : "light";
  root.style.colorScheme = isDark ? "dark" : "light";
}

/**
 * Apply the palette to <html>: Editions uses the kit's `data-ci-appearance="editions"`, Classic is
 * the attribute's absence (the base kit tokens), and every other skin is identified by its
 * canonical ID. `data-khub-skin` is the app-layer hook for src/app/khub-themes.css. Same rule as
 * THEME_BOOT_SCRIPT and global-error.tsx.
 */
export function applyPalette(palette: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const id = skinValue(palette);
  const appearance = ciAppearanceValue(id);
  if (appearance === null) root.removeAttribute(APPEARANCE_ATTRIBUTE);
  else root.setAttribute(APPEARANCE_ATTRIBUTE, appearance);
  root.dataset.khubSkin = id;
}

const KNOWN_THEMES = ["light", "dark", "system"] as const;

/** A persisted value outside light/dark/system (hand-edited, corrupted) falls back to the default. */
function isKnownTheme(value: unknown): value is (typeof KNOWN_THEMES)[number] {
  return typeof value === "string" && (KNOWN_THEMES as readonly string[]).includes(value);
}

const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: THEME_CONFIG.defaultTheme,
      palette: DEFAULT_APPEARANCE_PALETTE,
      // Every action also re-points the browser chrome (`theme-color`), which depends on both
      // the theme and the palette (src/shared/utils/themeColorMeta.ts).
      setTheme: (theme) => {
        const current = get();
        // Leaving forced dark by explicitly choosing light returns to the branded default skin.
        const palette =
          theme === "light" && isForcedDarkPalette(current.palette)
            ? DEFAULT_APPEARANCE_PALETTE
            : current.palette;
        set({ theme, palette });
        applyTheme(theme, palette);
        if (palette !== current.palette) applyPalette(palette);
        applyThemeColor(theme, palette);
      },
      toggleTheme: () => {
        const { theme, palette } = get();
        const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const isDark =
          isForcedDarkPalette(palette) || theme === "dark" || (theme === "system" && systemDark);
        get().setTheme(isDark ? "light" : "dark");
      },
      setPalette: (palette) => {
        const next = skinValue(palette);
        set({ palette: next });
        applyPalette(next);
        applyTheme(get().theme, next);
        applyThemeColor(get().theme, next);
      },
      initTheme: () => {
        const { theme, palette } = get();
        applyTheme(theme, palette);
        applyPalette(palette);
        applyThemeColor(theme, palette);
      },
    }),
    {
      name: THEME_CONFIG.storageKey,
      // Older builds persisted `colorTheme` / `customColor` (accent presets, retired in the
      // Keak migration — spec D4). Only `theme` and `palette` survive the merge; unknown keys
      // are dropped, and an unknown palette (or none, as every pre-Editions store) is Editions.
      partialize: (state) => ({ theme: state.theme, palette: state.palette }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as { theme?: unknown; palette?: unknown };
        const theme = isKnownTheme(saved.theme) ? saved.theme : current.theme;
        const palette = skinValue(saved.palette);
        return { ...current, theme, palette };
      },
    }
  )
);

export default useThemeStore;
