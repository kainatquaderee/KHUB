// Pure "attention needed" logic for the providers dashboard.
//
// The health verdict itself is NOT re-derived here: callers pass the counts
// produced by `countHealthyAccounts()` / `isHealthyAccount()` (which read the
// Cooldown Manager's `cooldownStatus`). This module only decides when a
// provider's healthy account count should raise an in-app warning, and which
// crossings deserve a one-time toast.
//
// Rule (owner-confirmed): a provider needs attention when it has more routable
// accounts than the threshold and no more healthy accounts than the threshold.
// The `routable > threshold` half is what exempts small providers permanently —
// a provider whose account count is at or below the threshold can never alarm,
// no matter how many of its accounts are limited.

export interface AttentionInputs {
  /** Every connection belonging to the provider. */
  total: number;
  /** `total` minus accounts the operator disabled (`isActive === false`). */
  routable: number;
  /** Accounts usable right now, per the Cooldown Manager's verdict. */
  healthy: number;
}

/** Pure. `routable > threshold` exempts small and all-disabled providers. */
export function isProviderAttentionNeeded(inputs: AttentionInputs, threshold: number): boolean {
  return inputs.routable > threshold && inputs.healthy <= threshold;
}

/** Shape the counts from a provider's connection list (no health derivation here). */
export function attentionInputsFromConnectionFlags(
  flags: readonly { isActive?: boolean }[],
  healthy: number
): AttentionInputs {
  const total = flags.length;
  const disabled = flags.reduce(
    (count, connection) => count + (connection.isActive === false ? 1 : 0),
    0
  );
  return { total, routable: total - disabled, healthy };
}

export type AttentionState = Record<string, "alert" | "ok">;

export interface AttentionTransition {
  /** Provider ids that newly crossed into alert and should toast once. */
  toasts: string[];
  /** Baseline to persist for the next evaluation. */
  next: AttentionState;
}

/**
 * Compare the previous per-provider baseline with the current verdicts.
 *
 * Only the *first* crossing into alert toasts: an alert that is still alert is
 * silent, and recovery writes `ok` so a later drop toasts again. Providers that
 * disappeared from the evaluation are pruned.
 */
export function applyAttentionTransitions(
  prev: AttentionState,
  current: Record<string, boolean>
): AttentionTransition {
  const toasts: string[] = [];
  const next: AttentionState = {};
  for (const [id, needed] of Object.entries(current)) {
    if (needed) {
      next[id] = "alert";
      if (prev[id] !== "alert") toasts.push(id);
    } else {
      next[id] = "ok";
    }
  }
  return { toasts, next };
}
