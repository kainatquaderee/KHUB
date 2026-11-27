---
title: "KHUB themes"
version: 3.8.53
lastUpdated: 2026-11-27
---

# KHUB themes

KHUB is an OmniRoute rebrand: the routing, API and wire contracts are unchanged. The appearance
catalogue in [`src/shared/constants/themeCatalog.ts`](../../src/shared/constants/themeCatalog.ts)
is the canonical list of colour palettes; the allowlist in
[`src/shared/constants/appearancePalette.ts`](../../src/shared/constants/appearancePalette.ts) and
the skins in [`src/app/khub-themes.css`](../../src/app/khub-themes.css) mirror it. The default
preference is `system` (dark follows `prefers-color-scheme`); the default palette is **KHUB
Editions** (`editions`). Settings → Appearance → Color palette offers one tile per canonical ID.
There is no `khub-signature` palette: unknown stored values fail closed to `editions`.

## Catalogue

| Stable ID            | Label              | Family        | Read-only aliases         | Source                                                                                             |
| -------------------- | ------------------ | ------------- | ------------------------- | -------------------------------------------------------------------------------------------------- |
| `editions`           | KHUB Editions      | Signature     | none                      | [CI UI Kit Editions](../../packages/ui-kit/src/ci-editions.css)                                    |
| `classic`            | Classic            | Signature     | none                      | [CI UI Kit base tokens](../../packages/ui-kit/src/ci-tokens.css)                                   |
| `nord`               | Nord               | Atmospheric   | none                      | [Nord colour palette](https://www.nordtheme.com/)                                                  |
| `nebula`             | Nebula             | Atmospheric   | `nevula`                  | [KHUB nebula skin](../../src/app/khub-themes.css#L113)                                             |
| `aurora`             | Aurora             | Atmospheric   | none                      | [KHUB aurora skin](../../src/app/khub-themes.css#L148)                                             |
| `gutgub`             | Gutgub             | Parody        | none                      | [GitHub](https://github.com/) · [parody convention](KHUB_PARODY_THEMES.md)                         |
| `youyou`             | Youyou             | Parody        | none                      | [YouTube](https://www.youtube.com/) · [parody convention](KHUB_PARODY_THEMES.md)                   |
| `gutlib`             | Gutlib             | Parody        | none                      | [GitLab](https://gitlab.com/) · [parody convention](KHUB_PARODY_THEMES.md)                         |
| `synthwave`          | Synthwave          | Creative      | none                      | [KHUB synthwave skin](../../src/app/khub-themes.css#L288)                                          |
| `terminal`           | Terminal           | Creative      | none                      | [KHUB terminal skin](../../src/app/khub-themes.css#L323)                                           |
| `paper-ink`          | Paper Ink          | Creative      | none                      | [KHUB paper-ink skin](../../src/app/khub-themes.css#L358)                                          |
| `sunset-fm`          | Sunset FM          | Creative      | none                      | [KHUB sunset-fm skin](../../src/app/khub-themes.css#L393)                                          |
| `cyber-lime`         | Cyber Lime         | Creative      | none                      | [KHUB cyber-lime skin](../../src/app/khub-themes.css#L428)                                         |
| `high-contrast-dark` | High Contrast Dark | Accessibility | `highcontrast`, `hc-dark` | [WCAG 2.2 Contrast (Enhanced)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html) |

Families are exactly `Signature`, `Atmospheric`, `Parody`, `Creative` and `Accessibility`.
One row exists per registered ID, with a unique label; aliases are accepted on read only and never
rendered as selector tiles. The parody rows are attribution-only; their assets are original
([parody theme rules](KHUB_PARODY_THEMES.md)).

## High Contrast Dark

`high-contrast-dark` is **manual-only**: it is selected from Settings → Appearance → Color
palette (or by a stored canonical value). Nothing selects it automatically from `prefers-contrast`
or `prefers-color-scheme`. Once selected it is always dark, including when the theme preference is
`light` or `system`: the boot script and theme store force `data-theme="dark"`, and both browser
chrome colours are `#000000`.

Its tokens are black canvas `#000000`, primary ink `#FFFFFF`, secondary ink `#D9F2FF`, control
ink `#FFFFFF`, control border and light accent `#00FFFF`, focus `#FFFFFF` and dark accent
`#B6FF00` in both modes. Primary text reaches 21:1 on the canvas; text, secondary text, control
text, borders, focus and accents are checked at 7:1 or better by
`tests/unit/theme-token-contrast.test.ts`. Every catalogue skin is checked for at least 4.5:1
body/secondary/control text and at least 3:1 control borders in both light and dark modes by the
same test. The skin removes shadows and gradients, gives controls a 2px border and draws a 3px
`:focus-visible` outline.

## Compatibility identifiers

The rebrand changes appearance and display names, not interoperability. API paths, OpenAI/Claude/
Gemini wire contracts and Electron `appId` (`online.omniroute.desktop`) remain unchanged; storage
values are canonical palette IDs (`editions`, `classic`, …, `high-contrast-dark`), not branding
labels. `data-ci-appearance="editions"` is the kit's opt-in attribute; the other skins are applied
through `data-khub-skin="<stable ID>"`.
