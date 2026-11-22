import { NextResponse } from "next/server";
import { probeOpenAiCompatibleUsageLink } from "@omniroute/open-sse/services/usage/openaiCompatible";
import type {
  OpenAiCompatibleQuotaEndpoint,
  UsageLinkProbeResult,
} from "@omniroute/open-sse/services/usage/openaiCompatible";
import { getProviderQuotaEndpoint } from "@omniroute/open-sse/config/providerQuotaEndpoints";
import { getProviderConnections } from "@/lib/db/providers";

/**
 * Live probe for a provider "custom usage link" (#usage-link).
 *
 * The dashboard card lets an operator paste a URL; this endpoint asks the usage
 * service to fetch it behind the provider dispatch guard
 * (`probeOpenAiCompatibleUsageLink`), attaching the connection's own key so the
 * probe sees what an authenticated reader would. Without the credential the
 * probe only ever proved that an authenticated endpoint answers 401, which the
 * card then reported as "unreachable" — misleading. It returns a short preview
 * rather than the full body so a huge response cannot be piped into the
 * dashboard.
 */

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

  // Honour the stored endpoint's declared auth shape (bearer / x-api-key) and any
  // operator headers; the pasted URL wins over the stored one.
  const stored = providerId ? getProviderQuotaEndpoint(providerId) : null;
  const endpoint: OpenAiCompatibleQuotaEndpoint = { ...(stored ?? {}), url };
  const secret = await resolveProviderSecret(providerId);

  // The usage service owns the outbound policy: it refuses a blocked target
  // before any socket opens, then applies the connect-time guard and the
  // no-follow redirect policy for the dispatch. An API route must not reach into
  // an executor implementation directly.
  let probe: UsageLinkProbeResult;
  try {
    probe = await probeOpenAiCompatibleUsageLink(url, endpoint, secret, TIMEOUT_MS);
  } catch {
    return NextResponse.json({
      ok: false,
      authenticated: Boolean(secret),
      error: "Link unreachable.",
    });
  }

  if (probe.blocked) {
    return NextResponse.json({
      ok: false,
      blocked: true,
      error: probe.message,
    });
  }

  const response = probe.response;
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
}
