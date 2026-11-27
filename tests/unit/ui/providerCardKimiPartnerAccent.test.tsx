// @vitest-environment jsdom
/**
 * Kimi (Moonshot AI) and Cheaper Inference render like every other provider card.
 *
 * Before the KHUB rebrand these provider ids carried a sponsor accent: a blue/green
 * `ci-brand-tint` card border plus a "Founding Friend" / "Open Source Friend" chip.
 * The OWNER asked for the plain card presentation, so the tint and the badges are
 * gone. Featured ordering (featuredProviders.ts) is unchanged and still guarded by
 * tests/unit/featured-providers-rank.test.ts.
 *
 * The file name is historical: it used to assert the sponsor accent. It stays under
 * tests/unit/ui/ because `test:vitest:ui` runs
 * `vitest run --config vitest.config.ts tests/unit/ui`, so this is the location that
 * is actually discovered by the blocking test-vitest CI job.
 */
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProviderCard from "@/app/(dashboard)/dashboard/providers/components/ProviderCard";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@/shared/components/ProviderTestSlideOver", () => ({ default: () => null }));
vi.mock("@/shared/components/ProviderIcon", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const SPONSOR_CARDS = [
  ["kimi-coding", "Kimi Code CLI"],
  ["kimi-web", "Kimi Web"],
  ["moonshot", "Kimi"],
  ["cheaperinference", "Cheaper Inference"],
] as const;

// Rendered in every casing the old badges used. `textContent` is normalized below.
const SPONSOR_BADGE_TEXT = ["OFFICIAL SUPPORTER", "OPEN SOURCE FRIEND", "Founding Friend"];

describe("ProviderCard — sponsor partners render as plain cards", () => {
  let container: HTMLDivElement | null = null;
  const mounted: { root: Root; container: HTMLDivElement }[] = [];

  afterEach(async () => {
    for (const instance of mounted.splice(0)) {
      await act(async () => instance.root.unmount());
      instance.container.remove();
    }
    if (container) {
      container = null;
    }
  });

  function renderCard(providerId: string, name: string) {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    act(() => {
      root.render(
        <ProviderCard
          providerId={providerId}
          provider={{ id: providerId, name }}
          stats={{ total: 1, connected: 1, error: 0, warning: 0 }}
          authType="apikey"
          onToggle={() => {}}
        />
      );
    });
    return container;
  }

  it.each(SPONSOR_CARDS)("%s carries no sponsor badge and no brand tint", (providerId, name) => {
    const el = renderCard(providerId, name);
    const card = el.querySelector<HTMLElement>("[data-slot='card']");
    expect(card).not.toBeNull();

    // ProviderCard must not pass `brandColor`: the kit Card then adds neither the
    // `ci-brand-tint` class nor the `--ci-brand` custom property.
    expect(card?.classList.contains("ci-brand-tint")).toBe(false);
    expect(card?.style.getPropertyValue("--ci-brand")).toBe("");
    expect(el.querySelector(".ci-brand-tint")).toBeNull();

    const text = (el.textContent ?? "").toUpperCase();
    for (const badge of SPONSOR_BADGE_TEXT) {
      expect(text).not.toContain(badge.toUpperCase());
    }
  });

  it.each(SPONSOR_CARDS)("%s keeps the normal card chrome", (providerId, name) => {
    const el = renderCard(providerId, name);

    // Name, connected status badge, and the detail link are what every provider card
    // renders — removing the sponsor presentation must not remove them.
    expect(el.textContent).toContain(name);
    expect(el.textContent).toContain("connected");
    expect(el.querySelector(`a[href="/dashboard/providers/${providerId}"]`)).not.toBeNull();
  });
});
