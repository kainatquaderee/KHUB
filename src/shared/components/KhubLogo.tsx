"use client";

import { cn } from "@/shared/utils/cn";
import {
  KHUB_MONOGRAM_FULL_PATHS,
  KHUB_MONOGRAM_SILHOUETTE_PATHS,
  KHUB_WORDMARK_PATHS,
  KHUB_WORDMARK_VIEWBOX,
  KHUB_MONOGRAM_VIEWBOX,
  type KhubPath,
} from "../brand/khubMark";

type KhubLogoProps = {
  size?: number;
  className?: string;
  variant?: "glyph" | "silhouette" | "wordmark";
  ariaLabel?: string;
};

const MARK_FILL = "var(--khub-mark-fill, currentColor)";
const ACCENT_FILL = "var(--khub-accent-fill, #E8563F)";

const pathsForVariant = (variant: NonNullable<KhubLogoProps["variant"]>): KhubPath[] => {
  if (variant === "wordmark") return KHUB_WORDMARK_PATHS;
  if (variant === "silhouette") return KHUB_MONOGRAM_SILHOUETTE_PATHS;
  return KHUB_MONOGRAM_FULL_PATHS;
};

/** Inline path-only renderer for the LATCH-ORBIT glyph and the KHUB wordmark. */
export default function KhubLogo({
  size = 20,
  className = "",
  variant = "glyph",
  ariaLabel,
}: KhubLogoProps) {
  const isWordmark = variant === "wordmark";
  const width = size;
  const height = isWordmark ? (size * 96) / 420 : size;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={isWordmark ? KHUB_WORDMARK_VIEWBOX : KHUB_MONOGRAM_VIEWBOX}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={cn(className)}
      style={{ width, height }}
    >
      {pathsForVariant(variant).map((path, index) => {
        const fill = path.role === "accent" ? ACCENT_FILL : MARK_FILL;
        return (
          <path
            key={index}
            d={path.d}
            fill={path.strokeWidth ? "none" : fill}
            fillRule={path.fillRule}
            stroke={path.strokeWidth ? fill : undefined}
            strokeWidth={path.strokeWidth}
          />
        );
      })}
    </svg>
  );
}

/** Full path-drawn wordmark (420x96 grid); sized by width. */
export function KhubWordmark({ size = 160, className = "" }: Omit<KhubLogoProps, "variant">) {
  return <KhubLogo size={size} className={className} variant="wordmark" />;
}
