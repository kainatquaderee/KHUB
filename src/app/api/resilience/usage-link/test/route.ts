import { NextResponse } from "next/server";
import {
  assertDispatchUrlAllowed,
  dispatchGuarded,
} from "@omniroute/open-sse/executors/dispatchPin";
import { isConnectGuardRefusal } from "@omniroute/open-sse/utils/connectGuardDispatcher";

/**
 * Live probe for a provider "custom usage link" (#usage-link).
 *
 * The dashboard card lets an operator paste a URL; this endpoint fetches it with
 * the exact same outbound policy the real quota reader uses (dispatchPin's
 * `assertDispatchUrlAllowed` + `dispatchGuarded`), so a link that tests green here
 * behaves the same at request time. It returns a short preview rather than the
 * full body so a huge response cannot be piped into the dashboard.
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

  try {
    const response = await dispatchGuarded(
      GUARD_PROVIDER,
      url,
      {
        method: "GET",
        headers: { accept: "application/json" },
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
    return NextResponse.json({ ok: false, error: "Link unreachable." });
  }
}
