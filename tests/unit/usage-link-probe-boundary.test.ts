/**
 * Boundary contract for the provider "custom usage link" probe.
 *
 * The `/api/resilience/usage-link/test` route must reach the provider dispatch
 * guard through the usage service (`probeOpenAiCompatibleUsageLink`), never by
 * importing an executor directly — `eslint.config.mjs` bars
 * `open-sse/executors/*` from `src/app/**`. These cases pin the service contract
 * the route depends on so the guard + credential handling cannot silently move
 * back into the route.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { probeOpenAiCompatibleUsageLink } = await import(
  "../../open-sse/services/usage/openaiCompatible.ts"
);

test("a cloud-metadata link is blocked before any socket opens", async () => {
  let fetchCalled = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const result = await probeOpenAiCompatibleUsageLink(
      "http://169.254.169.254/latest/meta-data/",
      { url: "http://169.254.169.254/latest/meta-data/" },
      "sk-test",
      1000
    );
    assert.equal(result.blocked, true);
    assert.equal(fetchCalled, false, "a blocked link must not reach fetch()");
  } finally {
    globalThis.fetch = original;
  }
});

test("an allowed link dispatches with the connection credential attached", async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const result = await probeOpenAiCompatibleUsageLink(
      "https://quota.example.com/v1/credits",
      { url: "https://quota.example.com/v1/credits" },
      "sk-test",
      1000
    );
    assert.equal(result.blocked, false);
    if (result.blocked) throw new Error("expected an unblocked probe");
    assert.equal(result.response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.authorization, "Bearer sk-test");
  } finally {
    globalThis.fetch = original;
  }
});
