// @vitest-environment jsdom
/**
 * AC9 / AC10 — the providers list card must never render badge-less for an
 * account the Cooldown Manager flags.
 *
 * These build the card's `stats` from real connection objects with the same
 * predicates `providers/page.tsx:getProviderStats` uses, then assert the real
 * `getStatusDisplay` output: a `terminal`-only provider shows the error badge (not
 * the "No connections" placeholder) and a limited-only provider shows the warning
 * badge (not silence).
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProviderCard from "../../../../../src/app/(dashboard)/dashboard/providers/components/ProviderCard";
import {
  countLimitedAccounts,
  isProviderConnectionConnected,
  isProviderConnectionErrored,
} from "@/shared/utils/providerConnectionStatus";

vi.mock("@/shared/components/ProviderTestSlideOver", () => ({ default: () => null }));
vi.mock("@/shared/components/ProviderIcon", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

type Conn = { isActive: boolean; testStatus: string; cooldownStatus?: string | null };

/** Mirrors the counts `getProviderStats` feeds `getStatusDisplay`. */
function statsFromConnections(connections: Conn[]) {
  return {
    total: connections.length,
    connected: connections.filter(isProviderConnectionConnected).length,
    error: connections.filter(isProviderConnectionErrored).length,
    warning: countLimitedAccounts(connections),
  };
}

describe("ProviderCard — connection attention badges", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  function renderCard(connections: Conn[]) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <ProviderCard
          providerId="openai"
          provider={{ id: "openai", name: "OpenAI" }}
          stats={statsFromConnections(connections)}
          authType="oauth"
          onToggle={() => {}}
        />
      );
    });
    return container;
  }

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    if (container) {
      document.body.removeChild(container);
      container = null;
    }
  });

  it("AC9: an all-terminal provider shows the error badge, not 'No connections'", () => {
    const el = renderCard([
      { isActive: true, testStatus: "active", cooldownStatus: "terminal" },
      { isActive: true, testStatus: "active", cooldownStatus: "terminal" },
    ]);
    const text = el.textContent || "";
    expect(text).toContain("2 Error");
    expect(text).not.toContain("No connections");
  });

  it("AC10: an all-limited provider shows the warning badge, not silence", () => {
    const el = renderCard([
      { isActive: true, testStatus: "active", cooldownStatus: "rate_limited" },
      { isActive: true, testStatus: "active", cooldownStatus: "model_locked" },
    ]);
    const text = el.textContent || "";
    expect(text).toContain("2 Warning");
    expect(text).not.toContain("No connections");
  });

  it("still shows 'No connections' when the provider has no connections at all", () => {
    const el = renderCard([]);
    expect(el.textContent || "").toContain("No connections");
  });
});
