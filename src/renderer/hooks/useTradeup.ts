// ============================================================
// CSInventoryPorter — useTradeup hook
// Manages trade-up contract state and execution
// Phase 8
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import type { InventoryItem, TradeupPrediction, TradeupProgress } from '../../shared/types';
import { RARITY_INFO } from '../../shared/cs2-item-data';

const api = () => (window as any).csinventoryporter;

/** Rarity levels eligible for trade-ups (Consumer through Classified) */
const TRADEUP_ELIGIBLE_RARITIES = new Set([1, 2, 3, 4, 5]);

/** Weapon types that can be used in trade-ups (skins only) */
const NON_TRADEUP_TYPES = new Set([
  'Tool', 'Collectible', 'Music Kit', 'Graffiti', 'Sticker',
  'Container', 'Pass', 'Charm', 'Patch', 'Equipment',
]);

/** Check if an item can be used in a trade-up contract */
export function isTradeupEligible(item: InventoryItem): boolean {
  // Must have a rarity in the eligible range
  if (item.rarity === undefined || !TRADEUP_ELIGIBLE_RARITIES.has(item.rarity)) return false;

  // Must be a weapon skin (not tool, sticker, etc.)
  if (item.weapon_type && NON_TRADEUP_TYPES.has(item.weapon_type)) return false;

  // Must have a paint_index (i.e., it's a skin, not base weapon)
  if (!item.paint_index) return false;

  // Must not be a storage unit
  if (item.is_storage_unit) return false;

  return true;
}

/** Get the rarity name for display */
export function getRarityName(rarity: number): string {
  return RARITY_INFO[rarity]?.name ?? `Rarity ${rarity}`;
}

/** Get the rarity color for display */
export function getRarityColor(rarity: number): string {
  return RARITY_INFO[rarity]?.color ?? '#b0c3d9';
}

/** Get the output rarity from the input rarity */
export function getOutputRarity(inputRarity: number): number {
  return inputRarity + 1;
}

/**
 * Hook for tradeup.
 *
 * Characteristics:
 * - @returns { selectedItems: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").InventoryItem[]; addItem: (item: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").InventoryItem) => void; removeItem: (itemId: string) => void; clearSelection: () => void; executeTradeup: () => Promise<void>; progress: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").TradeupProgress; result: { success: boolean; receivedItemIds?: string[]; error?: string; }; prediction: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").TradeupPrediction; predictionLoading: boolean; validationError: string; selectedRarity: number; isStatTrak: boolean; }
 *
 */
export function useTradeup() {
  const [selectedItems, setSelectedItems] = useState<InventoryItem[]>([]);
  const [progress, setProgress] = useState<TradeupProgress>({ state: 'idle' });
  const [result, setResult] = useState<{ success: boolean; receivedItemIds?: string[]; error?: string } | null>(null);
  const [prediction, setPrediction] = useState<TradeupPrediction | null>(null);
  const [predictionLoading, setPredictionLoading] = useState(false);

  // Listen for tradeup progress events
  useEffect(() => {
    const unsub = api().onTradeupProgress((p: TradeupProgress) => {
      setProgress(p);
      if (p.state === 'completed' || p.state === 'error') {
        // Auto-clear progress after 5 seconds
        setTimeout(() => setProgress({ state: 'idle' }), 5000);
      }
    });
    return unsub;
  }, []);

  // Update prediction whenever a complete 10-item selection is available
  useEffect(() => {
    let cancelled = false;

    if (selectedItems.length !== 10) {
      setPrediction(null);
      setPredictionLoading(false);
      return;
    }

    setPredictionLoading(true);
    api().predictTradeup(selectedItems)
      .then((res: TradeupPrediction | null) => {
        if (cancelled) return;
        setPrediction(res);
      })
      .catch(() => {
        if (cancelled) return;
        setPrediction(null);
      })
      .finally(() => {
        if (cancelled) return;
        setPredictionLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedItems]);

  /** Add an item to the trade-up selection (max 10) */
  const addItem = useCallback((item: InventoryItem) => {
    setSelectedItems((prev) => {
      if (prev.length >= 10) return prev;
      if (prev.some((i) => i.id === item.id)) return prev;

      // Validate compatibility: same rarity and same quality type
      if (prev.length > 0) {
        const firstRarity = prev[0].rarity;
        const firstQuality = prev[0].quality ?? 0;
        const isStatTrak = firstQuality === 9;

        if (item.rarity !== firstRarity) return prev;
        if (isStatTrak !== ((item.quality ?? 0) === 9)) return prev;
      }

      return [...prev, item];
    });
  }, []);

  /** Remove an item from the trade-up selection */
  const removeItem = useCallback((itemId: string) => {
    setSelectedItems((prev) => prev.filter((i) => i.id !== itemId));
  }, []);

  /** Clear all selected items */
  const clearSelection = useCallback(() => {
    setSelectedItems([]);
    setResult(null);
    setPrediction(null);
  }, []);

  /** Execute the trade-up contract */
  const executeTradeup = useCallback(async () => {
    if (selectedItems.length !== 10) return;

    setResult(null);
    const itemIds = selectedItems.map((i) => i.id);

    try {
      const res = await api().executeTradeup(itemIds);
      setResult(res);
      if (res.success) {
        // Clear selection after successful trade-up
        setSelectedItems([]);
      }
    } catch (err: any) {
      setResult({ success: false, error: err.message });
    }
  }, [selectedItems]);

  /** Validation message (null if valid, string if invalid) */
  const validationError = (() => {
    if (selectedItems.length === 0) return 'Select 10 items of the same rarity';
    if (selectedItems.length < 10) return `Need ${10 - selectedItems.length} more item(s)`;
    return null;
  })();

  /** Selected rarity (based on first selected item) */
  const selectedRarity = selectedItems.length > 0 ? selectedItems[0].rarity : undefined;

  /** Whether the selected items are StatTrak */
  const isStatTrak = selectedItems.length > 0 && (selectedItems[0].quality ?? 0) === 9;

  return {
    selectedItems,
    addItem,
    removeItem,
    clearSelection,
    executeTradeup,
    progress,
    result,
    prediction,
    predictionLoading,
    validationError,
    selectedRarity,
    isStatTrak,
  };
}
