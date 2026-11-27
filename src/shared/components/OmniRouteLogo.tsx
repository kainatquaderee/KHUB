"use client";

import { cn } from "@/shared/utils/cn";
import { KHUB_BRAND_NAME } from "../brand/khubMark";
import KhubLogo, { KhubWordmark } from "./KhubLogo";

type OmniRouteLogoProps = { size?: number; className?: string };

/** Compatibility-named export; renders the KHUB glyph. Prefer importing KhubLogo directly. */
export default function OmniRouteLogo({ size = 20, className = "" }: OmniRouteLogoProps) {
  return <KhubLogo size={size} className={className} />;
}

interface OmniRouteLockupProps {
  name?: string | null;
  logoSrc?: string | null;
  className?: string;
}

/** KHUB lockup; white-label operators get their own name/logo instead. */
export function OmniRouteLockup({ name, logoSrc, className }: OmniRouteLockupProps) {
  if (name || logoSrc) {
    return (
      <span
        role="img"
        aria-label={name || KHUB_BRAND_NAME}
        className={cn("inline-flex items-center gap-2", className)}
      >
        {logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- operator-supplied white-label logo (data: or remote URL), not a static/known asset
          <img src={logoSrc} alt="" className="size-6 object-contain" />
        ) : (
          <KhubLogo size={24} />
        )}
        {name && (
          <span aria-hidden="true" className="truncate font-semibold">
            {name}
          </span>
        )}
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={KHUB_BRAND_NAME}
      className={cn("inline-flex items-center", className)}
    >
      <KhubWordmark size={112} />
    </span>
  );
}
