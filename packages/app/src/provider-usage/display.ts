import type { ProviderUsage } from "./types";

/** Returns whether a provider usage result contains a displayable, successful response. */
export function isProviderUsageDisplayable(usage: ProviderUsage): boolean {
  return usage.status === "available" && !usage.error;
}

/** Removes unavailable and failed provider results from optional usage surfaces. */
export function filterDisplayableProviderUsages(providers: ProviderUsage[]): ProviderUsage[] {
  return providers.filter(isProviderUsageDisplayable);
}
