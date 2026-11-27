// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

const { default: OmniRouteLogo, OmniRouteLockup } =
  await import("@/shared/components/OmniRouteLogo");

afterEach(() => cleanup());

describe("brand wrappers → KHUB path-only renderer", () => {
  it("OmniRouteLogo keeps the size/className API and renders the KHUB glyph", () => {
    const { container } = render(<OmniRouteLogo size={22} className="x" />);
    const svg = container.querySelector("svg")!;
    expect(svg.classList.contains("x")).toBe(true);
    expect(svg.getAttribute("width")).toBe("22");
    expect(svg.getAttribute("viewBox")).toBe("0 0 64 64");
    expect(svg.style.width).toBe("22px");
    expect(svg.style.height).toBe("22px");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(container.querySelector("image, [href^='/brand/'], text, circle, ellipse")).toBeNull();
  });

  it("OmniRouteLockup renders the KHUB wordmark with one accessible name", () => {
    render(<OmniRouteLockup />);
    expect(screen.getByRole("img", { name: "KHUB" })).not.toBeNull();
  });

  it("OmniRouteLockup honours white-label name/logo", () => {
    render(<OmniRouteLockup name="Acme Router" logoSrc="data:image/png;base64,AAAA" />);
    expect(screen.getByRole("img", { name: "Acme Router" })).not.toBeNull();
    expect(screen.getByText("Acme Router")).not.toBeNull();
  });

  it("OmniRouteLockup never yields an empty accessible name for an empty white-label name", () => {
    render(<OmniRouteLockup name="" logoSrc="data:image/png;base64,AAAA" />);
    expect(screen.getByRole("img", { name: "KHUB" })).not.toBeNull();
  });
});
