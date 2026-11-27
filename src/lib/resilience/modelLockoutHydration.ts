/**
 * Boot hydration for persisted model lockouts. Runs once, after stale crash
 * cooldowns are cleared and before routing is ready. Never throws: persistence
 * degradation must not prevent the server from booting.
 */

import { logger } from "@/shared/utils/logger";
import { sanitizeErrorMessage } from "@omniroute/open-sse/utils/errorSanitization.ts";
import {
  clearAllModelResilienceState,
  deleteModelResilienceState,
  markModelLockClearedInDb,
  purgeExpiredModelResilienceState,
  readAllModelResilienceState,
  upsertModelResilienceState,
} from "@/lib/db/modelLockoutState";
import {
  setModelLockoutPersistenceAdapter,
  type ModelLockoutPersistenceAdapter,
} from "@omniroute/open-sse/services/accountFallback/persistenceBridge.ts";
import { applyHydratedModelLockouts } from "@omniroute/open-sse/services/accountFallback.ts";

const log = logger.child({ module: "model-lockout-hydration" });

export interface HydrationResult {
  restored: number;
  skipped: number;
  purged: number;
  warning?: string;
}

function buildAdapter(): ModelLockoutPersistenceAdapter {
  return {
    upsert: (row) => upsertModelResilienceState(row),
    deleteKeys: (keys) => deleteModelResilienceState(keys),
    clearAll: () => clearAllModelResilienceState(),
    markLockCleared: (stateKey, nowMs) => markModelLockClearedInDb(stateKey, nowMs),
  };
}

export function installAndHydrateModelLockoutPersistence(
  options: { nowMs?: number } = {}
): HydrationResult {
  try {
    const nowMs = options.nowMs ?? Date.now();
    setModelLockoutPersistenceAdapter(buildAdapter());
    const purged = purgeExpiredModelResilienceState(nowMs);
    const rows = readAllModelResilienceState();
    const applied = applyHydratedModelLockouts(rows, { nowMs, replace: true });
    return {
      restored: applied.restored,
      skipped: applied.skipped,
      purged: purged.deleted,
      ...(purged.warning ? { warning: purged.warning } : {}),
    };
  } catch (err) {
    log.warn(
      { error: sanitizeErrorMessage(err) },
      "model lockout hydration unavailable; continuing with empty state"
    );
    return { restored: 0, skipped: 0, purged: 0 };
  }
}
