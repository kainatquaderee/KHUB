/**
 * Format a millisecond duration as a human-readable countdown.
 *
 * Shared by the runtime ModelCooldownsCard and the resilience ConnectionsTable
 * so both surfaces display cooldown time identically.
 *
 * Tiers keep the two most significant units, so a provider-stated multi-day
 * quota reset ("comes back on 25 Nov 2026 at 08:59 UTC") reads as "4d 1h"
 * instead of "5831m 31s".
 *
 * Examples: 5000 -> "0m 5s", 5400000 -> "1h 30m", 350400000 -> "4d 1h".
 */
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}
