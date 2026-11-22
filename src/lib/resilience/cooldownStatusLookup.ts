/**
 * Fault-tolerant read of the Cooldown Manager's per-connection verdicts.
 *
 * API routes attach `cooldownStatus` to every connection they return so the UI
 * never has to re-derive health. A Cooldown Manager read failure must not fail
 * the route: an unresolvable account simply has no verdict and keeps the
 * previous behaviour (it reads as healthy), exactly like an older payload.
 */

import {
  connectionCooldownStatusById,
  type CooldownStatus,
} from "@/lib/resilience/cooldownManager";

/** Indirection so callers (and tests) can substitute the Cooldown Manager read. */
export type CooldownStatusReader = () => Promise<Map<string, CooldownStatus>>;

export interface CooldownStatusRead {
  statuses: Map<string, CooldownStatus>;
  /** True when the Cooldown Manager read threw; `statuses` is then empty. */
  failed: boolean;
}

export async function readConnectionCooldownStatuses(
  read: CooldownStatusReader = connectionCooldownStatusById,
  onError: (error: unknown) => void = (error) =>
    console.error("Failed to read connection cooldown statuses:", error)
): Promise<CooldownStatusRead> {
  try {
    return { statuses: await read(), failed: false };
  } catch (error) {
    onError(error);
    return { statuses: new Map(), failed: true };
  }
}
