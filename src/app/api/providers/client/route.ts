import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/db/providers";
import { maskStoredApiKey } from "@/lib/apiKeyExposure";
import { sanitizeProviderSpecificDataForResponse } from "@/lib/providers/requestDefaults";
import { readConnectionCooldownStatuses } from "@/lib/resilience/cooldownStatusLookup";

// GET /api/providers/client - List connections for the dashboard widgets.
// No consumer needs credentials, and this route is reachable anonymously when
// requireLogin is off, so secrets are masked exactly like GET /api/providers
// (GHSA-qxg2-rm3h-4cxp).
export async function GET() {
  try {
    const connections = await getProviderConnections();

    // The Usage / Provider Limits page reads this route, so it must carry the
    // same Cooldown Manager verdict GET /api/providers attaches: providers such
    // as Token Harbor record a 429 without `rateLimitedUntil`, and those
    // accounts would otherwise look healthy here. A read failure degrades to
    // the previous behaviour (no verdict, read as healthy) instead of a 500.
    const { statuses: cooldownStatuses } = await readConnectionCooldownStatuses();

    const runtimeObservedAt = new Date().toISOString();
    const clientConnections = connections.map((c) => ({
      ...c,
      runtimeObservedAt,
      // Absent from the map means "healthy": the manager caps its list and
      // older caches predate the field, so absence must not change anything.
      cooldownStatus: cooldownStatuses.get(String(c.id ?? "")) ?? "healthy",
      apiKey: c.apiKey ? maskStoredApiKey(c.apiKey) : undefined,
      accessToken: undefined,
      refreshToken: undefined,
      idToken: undefined,
      providerSpecificData: c.providerSpecificData
        ? sanitizeProviderSpecificDataForResponse(c.providerSpecificData)
        : undefined,
    }));

    return NextResponse.json({ connections: clientConnections });
  } catch (error) {
    console.log("Error fetching providers for client:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}
