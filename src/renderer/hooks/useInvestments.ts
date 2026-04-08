// ============================================================
// CSInventoryPorter — useInvestments hook
// Manages investment portfolio state: CRUD + current prices
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import type { InvestmentEntry, InvestmentSummary, ItemPriceData } from '../../shared/types';

const api = () => (window as any).csinventoryporter;

/**
 * Hook for investments.
 *
 * Characteristics:
 * - @returns { entries: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").InvestmentEntry[]; loading: boolean; error: string; loadEntries: () => Promise<void>; addEntry: (entry: Omit<import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").InvestmentEntry, "id" | "createdAt">) => Promise<any>; updateEntry: (id: string, updates: Partial<import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").InvestmentEntry>) => Promise<any>; removeEntry: (id: string) => Promise<boolean>; clearAll: () => Promise<boolean>; buildSummaries: (itemPrices: Record<string, import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").ItemPriceData>, _activeCurrency?: string, exchangeRates?: Record<string, number>) => import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").InvestmentSummary[]; }
 *
 */
export function useInvestments() {
  const [entries, setEntries] = useState<InvestmentEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load entries from main process
  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api().getInvestments();
      if (result.success) {
        setEntries(result.entries);
      } else {
        setError(result.error || 'Failed to load investments');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // Add entry
  const addEntry = useCallback(async (entry: Omit<InvestmentEntry, 'id' | 'createdAt'>) => {
    try {
      const result = await api().addInvestment(entry);
      if (result.success && result.entry) {
        setEntries((prev) => [...prev, result.entry]);
        return result.entry;
      } else {
        setError(result.error || 'Failed to add investment');
        return null;
      }
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  }, []);

  // Update entry
  const updateEntry = useCallback(async (id: string, updates: Partial<InvestmentEntry>) => {
    try {
      const result = await api().updateInvestment(id, updates);
      if (result.success && result.entry) {
        setEntries((prev) => prev.map((e) => (e.id === id ? result.entry : e)));
        return result.entry;
      } else {
        setError(result.error || 'Failed to update investment');
        return null;
      }
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  }, []);

  // Remove entry
  const removeEntry = useCallback(async (id: string) => {
    try {
      const result = await api().removeInvestment(id);
      if (result.success) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        return true;
      } else {
        setError(result.error || 'Failed to remove investment');
        return false;
      }
    } catch (err: any) {
      setError(err.message);
      return false;
    }
  }, []);

  // Clear all
  const clearAll = useCallback(async () => {
    try {
      const result = await api().clearInvestments();
      if (result.success) {
        setEntries([]);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  // Build summaries with EUR output. Legacy entries without currency are treated as USD.
  const buildSummaries = useCallback(
    (itemPrices: Record<string, ItemPriceData> | null, _activeCurrency?: string, exchangeRates?: Record<string, number> | null): InvestmentSummary[] => {
      return entries.map((entry) => {
        const priceData = itemPrices?.[entry.marketHashName];
        const currentPrice = priceData?.currentPrice ?? 0;
        const originalTotalCost = entry.quantity * entry.purchasePrice;

        // Convert legacy USD entries into EUR using fetched rates.
        const entryCurrency = entry.currency || 'USD'; // Legacy entries default to USD
        let totalCost = originalTotalCost;
        let wasConverted = false;

        if (entryCurrency === 'USD' && exchangeRates?.EUR) {
          totalCost = Math.round(originalTotalCost * exchangeRates.EUR * 100) / 100;
          wasConverted = true;
        }

        const currentValue = entry.quantity * currentPrice;
        const profit = currentValue - totalCost;
        const profitPercent = totalCost > 0 ? (profit / totalCost) * 100 : 0;

        return {
          entry,
          currentPrice,
          totalCost,
          currentValue,
          profit,
          profitPercent,
          originalTotalCost,
          wasConverted,
        };
      });
    },
    [entries],
  );

  return {
    entries,
    loading,
    error,
    loadEntries,
    addEntry,
    updateEntry,
    removeEntry,
    clearAll,
    buildSummaries,
  };
}
