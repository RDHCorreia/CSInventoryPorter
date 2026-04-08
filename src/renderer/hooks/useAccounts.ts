// ============================================================
// CSInventoryPorter — React hook for saved accounts
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import type { SavedAccount } from '../../shared/types';

const api = () => window.csinventoryporter;

/**
 * Hook for accounts.
 *
 * Characteristics:
 * - @returns { accounts: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").SavedAccount[]; loading: boolean; refresh: () => Promise<void>; removeAccount: (steamID: string) => Promise<void>; }
 *
 */
export function useAccounts() {
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api().listAccounts();
      setAccounts(list);
    } catch (err) {
      console.error('Failed to load accounts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const removeAccount = useCallback(
    async (steamID: string) => {
      await api().removeAccount(steamID);
      await refresh();
    },
    [refresh],
  );

  return { accounts, loading, refresh, removeAccount };
}
