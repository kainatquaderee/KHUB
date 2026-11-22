// Provider "attention needed" threshold — shared by the settings API schema
// (src/shared/validation/settingsSchemas.ts) and the runtime resolver
// (src/lib/resilience/attentionThresholdSettings.ts) so the two can never
// disagree.

/**
 * Default number of healthy accounts a provider may have before the dashboard
 * raises an "attention needed" warning. Small providers (account count at or
 * below this) never warn.
 */
export const DEFAULT_PROVIDER_ATTENTION_THRESHOLD = 10;

/**
 * Overflow/typo guard only — the representable integer range, NOT a policy
 * ceiling. An operator may raise the threshold as far as they like; this just
 * stops a typo'd `1e30` from poisoning the UI.
 */
export const MAX_PROVIDER_ATTENTION_THRESHOLD = Number.MAX_SAFE_INTEGER;
