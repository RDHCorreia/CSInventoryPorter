// ============================================================
// CSInventoryPorter — React hook for inventory state
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import type { InventoryData, InventoryItem, CasketOperation, BulkOperationProgress } from '../../shared/types';

const api = () => window.csinventoryporter;

const EMPTY_INVENTORY: InventoryData = {
  state: 'idle',
  items: [],
  storageUnits: [],
  totalItems: 0,
};

/**
 * Hook for inventory.
 *
 * Characteristics:
 * - @returns { error: string; operationProgress: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").BulkOperationProgress; reloadInventory: () => Promise<void>; loadCasketContents: (casketId: string) => Promise<import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").InventoryItem[]>; executeBulkOperation: (operations: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").CasketOperation[], delayMs?: number, itemCount?: number) => Promise<void>; cancelBulkOperation: () => void; renameCasket: (casketId: string, name: string) => Promise<void>; state: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").InventoryLoadState; items: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").InventoryItem[]; storageUnits: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").StorageUnit[]; totalItems: number; }
 *
 */
export function useInventory() {
  const [data, setData] = useState<InventoryData>(EMPTY_INVENTORY);
  const [error, setError] = useState<string | null>(null);
  const [operationProgress, setOperationProgress] = useState<BulkOperationProgress | null>(null);

  // Subscribe to inventory updates from main process
  useEffect(() => {
    const unsubInventory = api().onInventoryUpdated((newData: InventoryData) => {
      setData(newData);
      if (newData.error) {
        setError(newData.error);
      } else {
        setError(null);
      }
    });

    const unsubProgress = api().onOperationProgress((progress: BulkOperationProgress) => {
      setOperationProgress(progress);
      // Auto-clear completed/cancelled/error progress after 3 seconds
      if (progress.state === 'completed' || progress.state === 'cancelled' || progress.state === 'error') {
        setTimeout(() => setOperationProgress(null), 3000);
      }
    });

    // Get initial state
    api().getInventory().then((initial: InventoryData) => {
      if (initial) {
        setData(initial);
      }
    });

    return () => {
      unsubInventory();
      unsubProgress();
    };
  }, []);

  const reloadInventory = useCallback(async () => {
    setError(null);
    const result = await api().loadInventory();
    if (!result.success && result.error) {
      setError(result.error);
    }
  }, []);

  const loadCasketContents = useCallback(async (casketId: string): Promise<InventoryItem[]> => {
    const result = await api().loadCasketContents(casketId);
    if (!result.success) {
      throw new Error(result.error || 'Failed to load casket contents');
    }
    return result.items ?? [];
  }, []);

  const executeBulkOperation = useCallback(async (operations: CasketOperation[], delayMs?: number, itemCount?: number) => {
    const result = await api().executeBulkOperation(operations, delayMs, itemCount);
    if (!result.success) {
      throw new Error(result.error || 'Bulk operation failed');
    }
  }, []);

  const cancelBulkOperation = useCallback(() => {
    api().cancelBulkOperation();
  }, []);

  const renameCasket = useCallback(async (casketId: string, name: string) => {
    const result = await api().renameCasket(casketId, name);
    if (!result.success) {
      throw new Error(result.error || 'Rename failed');
    }
  }, []);

  return {
    ...data,
    error,
    operationProgress,
    reloadInventory,
    loadCasketContents,
    executeBulkOperation,
    cancelBulkOperation,
    renameCasket,
  };
}
