---
title: "KHUB parody themes"
version: 3.8.53
lastUpdated: 2026-11-27
---

# KHUB parody themes

The KHUB appearance catalogue (`src/shared/constants/themeCatalog.ts`) includes three respectful
parody skins. They are colour/typography jokes for people who already know the source products;
they are **not** copies of a product's interface.

| Source brand                        | Original parody label | Canonical lowercase ASCII ID |
| ----------------------------------- | --------------------- | ---------------------------- |
| [GitHub](https://github.com/)       | Gutgub                | `gutgub`                     |
| [YouTube](https://www.youtube.com/) | Youyou                | `youyou`                     |
| [GitLab](https://gitlab.com/)       | Gutlib                | `gutlib`                     |

## Original-asset rule

- No third-party logo, icon, wordmark, screenshot, font file, CSS file or marketing copy is copied
  into the repository or fetched at runtime. Every colour, label and rule in
  `src/app/khub-themes.css` is original and written for KHUB.
- The source brand is cited only as attribution in the catalogue's `parodyOf` row and in the table
  above. It is never presented as an endorsement, affiliation or official theme.
- IDs are lowercase ASCII with hyphens so they are safe as DOM attributes, localStorage values and
  CSS selectors. The selector shows canonical IDs only. Read-only aliases (`nevula` → `nebula`,
  `highcontrast`/`hc-dark` → `high-contrast-dark`) are never rendered as tiles.
- New parody rows must add the brand → label → ID entry here and a source link in the catalogue in
  the same change; a missing row is an orphan ID.

Parody skins use the same light/dark contract as every other row: the pre-paint script
(`src/shared/utils/themeBootScript.ts`), the store (`src/store/themeStore.ts`), the browser-chrome
resolver (`src/shared/utils/themeColorMeta.ts`) and the CSS skin all agree on the canonical ID.
The Accessibility skin is not a parody: `high-contrast-dark` always paints dark and doubles as the
escape hatch from the branded default when light mode is selected.
