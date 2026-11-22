// Model lockout ceilings — shared by the runtime resolver
// (src/lib/resilience/modelLockoutSettings.ts) and the settings API schema
// (src/shared/validation/settingsSchemas.ts) so the two can never disagree.

/**
 * Safety bound for the operator's Max Cooldown — deliberately **not** a product
 * ceiling. How long a model waits is an operator decision: a provider-stated
 * reset can be days out (Token Harbor: "comes back on 23 Nov 2026 at 06:05 UTC"
 * → ~46 h) and the plain backoff ladder is allowed to reach days as well.
 *
 * This value only keeps the number inside Date's representable range
 * (~±8.64e15 ms) so a typo like `604800000000000000` cannot overflow
 * `lockedUntil` / ISO formatting. It is ~274 years: reachable by no deliberate
 * setting, and unreachable by arithmetic.
 */
export const MAX_MODEL_LOCKOUT_COOLDOWN_MS = 8_640_000_000_000;

/** Base Cooldown is the *first* wait before any backoff scaling — still bounded. */
export const MAX_MODEL_LOCKOUT_BASE_COOLDOWN_MS = 600_000;
