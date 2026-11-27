"use client";

import { useTranslations } from "next-intl";
import { useTheme } from "@/shared/hooks/useTheme";
import { isForcedDarkPalette } from "@/shared/constants/themeCatalog";
import Button from "./Button";
import Icon from "./Icon";

export default function ThemeToggle({
  className,
  variant = "default",
}: {
  className?: string;
  variant?: "default" | "card";
}) {
  const { setTheme, isDark, palette } = useTheme();
  const t = useTranslations("header");
  // Accessibility forced dark is painted dark regardless of the stored mode; light is an exit.
  const darkActive = isDark || isForcedDarkPalette(palette);
  const label = darkActive ? t("switchToLightMode") : t("switchToDarkMode");
  return (
    <Button
      variant={variant === "card" ? "outline" : "ghost"}
      size="icon"
      className={className}
      onClick={() => setTheme(darkActive ? "light" : "dark")}
      aria-label={label}
      title={label}
    >
      <Icon name={darkActive ? "light_mode" : "dark_mode"} size={20} />
    </Button>
  );
}
