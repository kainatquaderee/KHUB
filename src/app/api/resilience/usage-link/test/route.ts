import { NextResponse } from "next/server";
import {
  assertDispatchUrlAllowed,
  dispatchGuarded,
} from "@omniroute/open-sse/executors/dispatchPin";
import { isConnectGuardRefusal } from "@omniroute/open-sse/utils/connectGuardDispatcher";
import { buildAuthHeaders } from "@omniroute/open-sse/services/usage/openaiCompatible";
import type { OpenAiCompatibleQuotaEndpoint } from "@omniroute/open-sse/services/usage/openaiCompatible";
import { getProviderQuotaEndpoint } from "@omniroute/open-sse/config/providerQuotaEndpoints";
import { getProviderConnections } from "@/lib/db/providers";

/**
 * Live probe for a provider "custom usage link" (#usage-link).
 *
 * The dashboard card lets an operator paste a URL; this endpoint fetches it with
 * the exact same outbound policy AND credential handling as the real quota
 * reader (dispatchPin's `assertDispatchUrlAllowed` + `dispatchGuarded`, plus the
 * connection's own key via `buildAuthHeaders`). Without the credential the probe
 * only ever proved that an authenticated endpoint answers 401, which the card
 * then reported as "unreachable" — misleading. It returns a short preview rather
 * than the full body so a huge response cannot be piped into the dashboard.
 */

const GUARD_PROVIDER = "openai-compatible-quota";
const TIMEOUT_MS = 10_000;
const MAX_URL_LENGTH = 2000;
const MAX_PREVIEW_LENGTH = 1200;

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * First usable credential on the provider's connections — the same source the
 * runtime quota reader signs its request with. Never logged or echoed back.
 */
async function resolveProviderSecret(providerId: string): Promise<string | undefined> {
  if (!providerId) return undefined;
  try {
    const rows = (await getProviderConnections({ provider: providerId })) as Array<
      Record<string, unknown>
    >;
    for (const row of rows) {
      const apiKey = typeof row?.apiKey === "string" ? row.apiKey.trim() : "";
      if (apiKey) return apiKey;
      const accessToken = typeof row?.accessToken === "string" ? row.accessToken.trim() : "";
      if (accessToken) return accessToken;
    }
  } catch {
    // Probe without credentials rather than failing the test outright.
  }
  return undefined;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const url = (body as { url?: unknown } | null)?.url;
  if (!isHttpUrl(url)) {
    return NextResponse.json({ ok: false, error: "Enter a full http(s) URL." }, { status: 400 });
  }

  const rawProviderId = (body as { providerId?: unknown } | null)?.providerId;
  const providerId = typeof rawProviderId === "string" ? rawProviderId.trim() : "";

  // Refuse before any socket is opened (same policy as the quota reader).
  try {
    assertDispatchUrlAllowed(GUARD_PROVIDER, url);
  } catch {
    // Deliberately not echoing the guard error: it embeds the operator URL.
    return NextResponse.json({
      ok: false,
      blocked: true,
      error: "Blocked by outbound URL policy.",
    });
  }

  // Honour the stored endpoint's declared auth shape (bearer / x-api-key) and any
  // operator headers; the pasted URL wins over the stored one.
  const stored = providerId ? getProviderQuotaEndpoint(providerId) : null;
  const endpoint: OpenAiCompatibleQuotaEndpoint = { ...(stored ?? {}), url };
  const secret = await resolveProviderSecret(providerId);
  const headers = buildAuthHeaders(endpoint, secret);

  try {
    const response = await dispatchGuarded(
      GUARD_PROVIDER,
      url,
      {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "manual",
      },
      { providerSpecificData: { baseUrl: url } }
    );

    const raw = await response.text();
    let preview = raw.slice(0, MAX_PREVIEW_LENGTH);
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("json")) {
      try {
        preview = JSON.stringify(JSON.parse(raw), null, 2).slice(0, MAX_PREVIEW_LENGTH);
      } catch {
        // Not valid JSON despite the header — keep the raw preview.
      }
    }

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      authenticated: Boolean(secret),
      contentType: contentType ?? null,
      preview,
    });
  } catch (error) {
    if (isConnectGuardRefusal(error)) {
      return NextResponse.json({
        ok: false,
        blocked: true,
        error: "Blocked by outbound URL policy.",
      });
    }
    return NextResponse.json({
      ok: false,
      authenticated: Boolean(secret),
      error: "Link unreachable.",
    });
  }
}
