// ============================================================
// CSInventoryPorter — usePricing hook
// Manages pricing state: fetch, progress, portfolio data
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import type { PricingProgress, PortfolioData } from '../../shared/types';

const api = () => (window as any).csinventoryporter;

/**
 * Hook for pricing.
 *
 * Characteristics:
 * - @returns { pricingProgress: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").PricingProgress; portfolioData: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").PortfolioData; fetchPrices: () => Promise<void>; cancelFetch: () => void; loadPortfolioData: () => Promise<void>; }
 *
 */
export function usePricing() {
  const [pricingProgress, setPricingProgress] = useState<PricingProgress | null>(null);
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);

  // Use a ref so the event handler always sees the latest loadPortfolioData
  const loadRef = useRef<() => Promise<void>>();

  const loadPortfolioData = useCallback(async () => {
    try {
      const data = await api().getPortfolioData();
      setPortfolioData(data);
    } catch (err) {
      console.error('[usePricing] Failed to load portfolio data:', err);
    }
  }, []);

  loadRef.current = loadPortfolioData;

  // Subscribe to pricing progress events
  useEffect(() => {
    const unsub = api().onPricingProgress((progress: PricingProgress) => {
      setPricingProgress(progress);

      // When loading finishes, immediately refresh portfolio data.
      if (progress.state === 'loaded' || progress.state === 'error') {
        loadRef.current?.();
      }
    });
    return unsub;
  }, []);

  // Ensure portfolio data is present on initial mount (cache-first behavior).
  useEffect(() => {
    loadRef.current?.();
  }, []);

  const fetchPrices = useCallback(async () => {
    try {
      await api().fetchPrices();
      // Also reload portfolio data after fetch IPC resolves (belt + suspenders)
      await loadRef.current?.();
    } catch (err) {
      console.error('[usePricing] Failed to fetch prices:', err);
    }
  }, []);

  const cancelFetch = useCallback(() => {
    api().cancelPriceFetch();
  }, []);

  return {
    pricingProgress,
    portfolioData,
    fetchPrices,
    cancelFetch,
    loadPortfolioData,
  };
}
