import test from "node:test";
import assert from "node:assert/strict";
import { THEME_CATALOG, THEME_CATALOG_BY_ID } from "../../src/shared/constants/themeCatalog.ts";
import { getContrastRatio } from "../../src/shared/utils/a11yAudit.ts";

// AC-13/14/15: the Accessibility skin uses the mandated tokens verbatim, and every catalogue
// skin is readable in both modes (body ink, secondary ink, control ink/border and mode accent).

const MIN_TEXT_CONTRAST = 4.5;
const MIN_UI_CONTRAST = 3;

test("High Contrast Dark uses the exact mandated tokens in both modes", () => {
  const entry = THEME_CATALOG_BY_ID["high-contrast-dark"];
  assert.equal(entry.forcedDark, true);
  assert.deepEqual(entry.backgrounds, { light: "#000000", dark: "#000000" });
  const expected = {
    background: "#000000",
    text: "#FFFFFF",
    textSecondary: "#D9F2FF",
    controlText: "#FFFFFF",
    controlBorder: "#00FFFF",
    focus: "#FFFFFF",
    accentLight: "#00FFFF",
    accentDark: "#B6FF00",
  };
  for (const mode of ["light", "dark"] as const) {
    assert.deepEqual(entry.tokens[mode], expected, `${mode} tokens`);
  }
});

test("High Contrast Dark reaches WCAG AAA contrast on every declared foreground", () => {
  const tokens = THEME_CATALOG_BY_ID["high-contrast-dark"].tokens.dark;
  for (const name of ["text", "textSecondary", "controlText", "focus"] as const) {
    assert.ok(
      getContrastRatio(tokens[name], tokens.background) >= 7,
      `${name} on the black canvas is at least 7:1`
    );
  }
  for (const name of ["controlBorder", "accentLight", "accentDark"] as const) {
    assert.ok(
      getContrastRatio(tokens[name], tokens.background) >= 7,
      `${name} on the black canvas is at least 7:1`
    );
  }
  assert.equal(getContrastRatio(tokens.text, tokens.background), 21);
});

test("every catalogue skin has ≥4.5:1 text and ≥3:1 control borders in both modes", () => {
  for (const entry of THEME_CATALOG) {
    for (const mode of ["light", "dark"] as const) {
      const tokens = entry.tokens[mode];
      const accent = mode === "light" ? tokens.accentLight : tokens.accentDark;
      for (const name of ["text", "textSecondary", "controlText"] as const) {
        const ratio = getContrastRatio(tokens[name], tokens.background);
        assert.ok(ratio >= MIN_TEXT_CONTRAST, `${entry.id}/${mode} ${name}: ${ratio.toFixed(2)}`);
      }
      const accentRatio = getContrastRatio(accent, tokens.background);
      assert.ok(
        accentRatio >= MIN_TEXT_CONTRAST,
        `${entry.id}/${mode} ${mode} accent: ${accentRatio.toFixed(2)}`
      );
      const borderRatio = getContrastRatio(tokens.controlBorder, tokens.background);
      assert.ok(
        borderRatio >= MIN_UI_CONTRAST,
        `${entry.id}/${mode} control border: ${borderRatio.toFixed(2)}`
      );
      assert.ok(
        /^#[0-9a-f]{6}$/i.test(tokens.focus) && /^#[0-9a-f]{6}$/i.test(tokens.background),
        `${entry.id}/${mode} focus and background are hex colours`
      );
    }
  }
});
