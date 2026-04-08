// ============================================================
// CSInventoryPorter — useMarket hook
// Manages Steam Community Market listing state (Phase 6)
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import type {
  MarketListing,
  MarketProgress,
  MarketFeeBreakdown,
} from '../../shared/types';

const api = () => (window as any).csinventoryporter;

// ---- Fee calculation (mirrors MarketService logic) ----

/**
 * Calculate fees.
 *
 * Characteristics:
 * - @param youReceiveCents - The parameter for youReceiveCents
 * - @returns import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").MarketFeeBreakdown
 *
 */
export function calculateFees(youReceiveCents: number): MarketFeeBreakdown {
  const steamFee = Math.max(1, Math.floor(youReceiveCents * 0.05));
  const gameFee = Math.max(1, Math.floor(youReceiveCents * 0.10));
  const buyerPays = youReceiveCents + steamFee + gameFee;
  return { buyerPays, steamFee, gameFee, youReceive: youReceiveCents };
}

/**
 * Calculate from buyer price.
 *
 * Characteristics:
 * - @param buyerPaysCents - The parameter for buyerPaysCents
 * - @returns import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").MarketFeeBreakdown
 *
 */
export function calculateFromBuyerPrice(buyerPaysCents: number): MarketFeeBreakdown {
  const base = buyerPaysCents / 1.15;
  const steamFee = Math.max(1, Math.floor(base * 0.05));
  const gameFee = Math.max(1, Math.floor(base * 0.10));
  const youReceive = buyerPaysCents - steamFee - gameFee;
  return { buyerPays: buyerPaysCents, steamFee, gameFee, youReceive: Math.max(1, youReceive) };
}

// ---- Hook ----

/**
 * Hook for market.
 *
 * Characteristics:
 * - @returns { listings: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").MarketListing[]; progress: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").MarketProgress; loading: boolean; fetchListings: () => Promise<void>; listItem: (assetId: string, priceInCents: number) => Promise<any>; listMultiple: (requests: { assetId: string; priceInCents: number; }[]) => Promise<any>; delistItem: (listingId: string) => Promise<any>; delistAll: () => Promise<any>; }
 *
 */
export function useMarket() {
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [progress, setProgress] = useState<MarketProgress>({ state: 'idle' });
  const [loading, setLoading] = useState(false);

  // Subscribe to market events
  useEffect(() => {
    const unsubProgress = api().onMarketProgress((p: MarketProgress) => {
      setProgress(p);
    });

    const unsubListings = api().onMarketListingsUpdated((l: MarketListing[]) => {
      setListings(l);
    });

    return () => {
      unsubProgress();
      unsubListings();
    };
  }, []);

  /** Fetch active market listings */
  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api().getMarketListings();
      if (result.success && result.listings) {
        setListings(result.listings);
      }
    } catch (err: any) {
      console.error('[useMarket] Failed to fetch listings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  /** List a single item for sale */
  const listItem = useCallback(async (assetId: string, priceInCents: number) => {
    const result = await api().listItem(assetId, priceInCents);
    if (result.success) {
      // Refresh listings after successful listing
      setTimeout(() => fetchListings(), 1500);
    }
    return result;
  }, [fetchListings]);

  /** List multiple items for sale */
  const listMultiple = useCallback(async (requests: Array<{ assetId: string; priceInCents: number }>) => {
    return api().listMultipleItems(requests);
  }, []);

  /** Delist a single item */
  const delistItem = useCallback(async (listingId: string) => {
    const result = await api().delistItem(listingId);
    if (result.success) {
      setListings((prev) => prev.filter((l) => l.listingId !== listingId));
    }
    return result;
  }, []);

  /** Delist all active listings */
  const delistAll = useCallback(async () => {
    return api().delistAll();
  }, []);

  return {
    listings,
    progress,
    loading,
    fetchListings,
    listItem,
    listMultiple,
    delistItem,
    delistAll,
  };
}
