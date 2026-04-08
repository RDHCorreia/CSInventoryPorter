// ============================================================
// CSInventoryPorter — useMultiAccount hook
// Manages combined multi-account portfolio data (Phase 5)
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import type { MultiAccountSummary } from '../../shared/types';

const api = () => (window as any).csinventoryporter;

/**
 * Hook for multi account.
 *
 * Characteristics:
 * - @returns { summary: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").MultiAccountSummary; loading: boolean; refresh: () => Promise<void>; switchAccount: (steamID: string) => Promise<any>; }
 *
 */
export function useMultiAccount() {
  const [summary, setSummary] = useState<MultiAccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api().getCombinedPortfolio();
      setSummary(data);
    } catch (err) {
      console.error('[useMultiAccount] Failed to load:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Debounced refresh — coalesces rapid events into one call */
  const debouncedRefresh = useCallback((delayMs = 1000) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      refresh();
    }, delayMs);
  }, [refresh]);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Load on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh when inventory updates (debounced — many events fire during casket loading)
  useEffect(() => {
    const unsub = api().onInventoryUpdated(() => {
      debouncedRefresh(2000);
    });
    return unsub;
  }, [debouncedRefresh]);

  // Refresh when pricing finishes (immediate — this is a single event)
  useEffect(() => {
    const unsub = api().onPricingProgress((progress: any) => {
      if (progress.state === 'loaded') {
        refresh();
      }
    });
    return unsub;
  }, [refresh]);

  // Refresh when auth status changes (debounced)
  useEffect(() => {
    const unsub = api().onStatusChanged(() => {
      debouncedRefresh(500);
    });
    return unsub;
  }, [debouncedRefresh]);

  const switchAccount = useCallback(async (steamID: string) => {
    const result = await api().switchAccount(steamID);
    // Refresh summary after a short delay to reflect the switch
    setTimeout(() => refresh(), 500);
    return result;
  }, [refresh]);

  return { summary, loading, refresh, switchAccount };
}
