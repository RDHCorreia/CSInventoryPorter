// ============================================================
// CSInventoryPorter — React hook for friend trading
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  SteamFriend,
  TradeItem,
  TradeOffer,
  TradeProgress,
  SendTradeOfferRequest,
} from '../../shared/types';

const api = () => window.csinventoryporter;

/**
 * Hook for trade.
 *
 * Characteristics:
 * - @returns { friends: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").SteamFriend[]; friendsLoading: boolean; loadFriends: () => Promise<void>; selectedFriend: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").SteamFriend; selectFriend: (friend: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").SteamFriend) => Promise<void>; friendInventory: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").TradeItem[]; friendInventoryLoading: boolean; myTradableIds: Set<string>; tradableIdsLoading: boolean; loadMyTradableIds: () => Promise<void>; sentOffers: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").TradeOffer[]; receivedOffers: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").TradeOffer[]; offersLoading: boolean; refreshOffers: () => Promise<void>; mySelectedAssets: Set<string>; theirSelectedAssets: Set<string>; toggleMyAsset: (assetId: string) => void; setMyStackSelection: (allAssetIds: string[], selectedCount: number) => void; toggleTheirAsset: (assetId: string) => void; setTheirStackSelection: (allAssetIds: string[], selectedCount: number) => void; clearSelections: () => void; sendOffer: (message?: string, tradeToken?: string) => Promise<{ success: boolean; offerId?: string; status?: string; error?: string; }>; acceptOffer: (offerId: string) => Promise<{ success: boolean; error?: string; }>; declineOffer: (offerId: string) => Promise<{ success: boolean; error?: string; }>; cancelOffer: (offerId: string) => Promise<{ success: boolean; error?: string; }>; progress: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").TradeProgress; error: string; clearError: () => void; }
 *
 */
export function useTrade() {
  const [friends, setFriends] = useState<SteamFriend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);

  // Selected friend state
  const [selectedFriend, setSelectedFriend] = useState<SteamFriend | null>(null);
  const [friendInventory, setFriendInventory] = useState<TradeItem[]>([]);
  const [friendInventoryLoading, setFriendInventoryLoading] = useState(false);

  // Trade offers
  const [sentOffers, setSentOffers] = useState<TradeOffer[]>([]);
  const [receivedOffers, setReceivedOffers] = useState<TradeOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(false);

  // Trade progress
  const [progress, setProgress] = useState<TradeProgress>({ state: 'idle' });
  const [error, setError] = useState<string | null>(null);

  // Items selected for trading — maps assetId → true
  const [mySelectedAssets, setMySelectedAssets] = useState<Set<string>>(new Set());
  const [theirSelectedAssets, setTheirSelectedAssets] = useState<Set<string>>(new Set());

  // Set of our own tradable asset IDs (from Steam API)
  const [myTradableIds, setMyTradableIds] = useState<Set<string> | null>(null);
  const [tradableIdsLoading, setTradableIdsLoading] = useState(false);

  // Track if initial load has happened
  const initialLoad = useRef(false);

  // ---- Event listeners ----

  useEffect(() => {
    const unsubProgress = api().onTradeProgress((p: TradeProgress) => {
      setProgress(p);
      if (p.state === 'error' && p.message) {
        setError(p.message);
      }
    });

    const unsubNewOffer = api().onNewTradeOffer((_offer: TradeOffer) => {
      // Refresh offers when a new one arrives
      refreshOffers();
    });

    const unsubOfferChanged = api().onTradeOfferChanged((_offer: TradeOffer) => {
      // Refresh offers when one changes state
      refreshOffers();
    });

    return () => {
      unsubProgress();
      unsubNewOffer();
      unsubOfferChanged();
    };
  }, []);

  // ---- Actions ----

  /** Load our own tradable asset IDs from the Steam API */
  const loadMyTradableIds = useCallback(async () => {
    setTradableIdsLoading(true);
    try {
      const result = await api().getMyTradableIds();
      if (result.success) {
        setMyTradableIds(new Set(result.ids || []));
      }
    } catch (err: any) {
      console.error('Failed to load tradable IDs:', err.message);
    } finally {
      setTradableIdsLoading(false);
    }
  }, []);

  const loadFriends = useCallback(async () => {
    setFriendsLoading(true);
    setError(null);
    try {
      const result = await api().getFriends();
      if (result.success) {
        setFriends(result.friends || []);
      } else {
        setError(result.error || 'Failed to load friends');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setFriendsLoading(false);
    }
  }, []);

  const loadFriendInventory = useCallback(async (steamID: string) => {
    setFriendInventoryLoading(true);
    setFriendInventory([]);
    setTheirSelectedAssets(new Set());
    setError(null);
    try {
      const result = await api().getFriendInventory(steamID);
      if (result.success) {
        setFriendInventory(result.items || []);
      } else {
        setError(result.error || 'Failed to load friend inventory');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setFriendInventoryLoading(false);
    }
  }, []);

  const selectFriend = useCallback(async (friend: SteamFriend) => {
    setSelectedFriend(friend);
    setMySelectedAssets(new Set());
    setTheirSelectedAssets(new Set());
    setFriendInventory([]);
    await loadFriendInventory(friend.steamID);
  }, [loadFriendInventory]);

  const refreshOffers = useCallback(async () => {
    setOffersLoading(true);
    try {
      const result = await api().getTradeOffers();
      if (result.success) {
        setSentOffers(result.sent || []);
        setReceivedOffers(result.received || []);
      }
    } catch (err: any) {
      console.error('Failed to load trade offers:', err.message);
    } finally {
      setOffersLoading(false);
    }
  }, []);

  const sendOffer = useCallback(async (message?: string, tradeToken?: string) => {
    if (!selectedFriend) {
      setError('No friend selected');
      return;
    }

    if (mySelectedAssets.size === 0 && theirSelectedAssets.size === 0) {
      setError('Select at least one item to trade');
      return;
    }

    setError(null);
    const request: SendTradeOfferRequest = {
      partnerSteamID: selectedFriend.steamID,
      tradeToken,
      message,
      myAssetIds: Array.from(mySelectedAssets),
      theirAssetIds: Array.from(theirSelectedAssets),
    };

    const result = await api().sendTradeOffer(request);
    if (result.success) {
      // Clear selections after successful send
      setMySelectedAssets(new Set());
      setTheirSelectedAssets(new Set());
      // Refresh offers
      await refreshOffers();
    } else {
      setError(result.error || 'Failed to send trade offer');
    }

    return result;
  }, [selectedFriend, mySelectedAssets, theirSelectedAssets, refreshOffers]);

  const acceptOffer = useCallback(async (offerId: string) => {
    setError(null);
    const result = await api().acceptTradeOffer(offerId);
    if (!result.success) {
      setError(result.error || 'Failed to accept offer');
    }
    await refreshOffers();
    return result;
  }, [refreshOffers]);

  const declineOffer = useCallback(async (offerId: string) => {
    setError(null);
    const result = await api().declineTradeOffer(offerId);
    if (!result.success) {
      setError(result.error || 'Failed to decline offer');
    }
    await refreshOffers();
    return result;
  }, [refreshOffers]);

  const cancelOffer = useCallback(async (offerId: string) => {
    setError(null);
    const result = await api().cancelTradeOffer(offerId);
    if (!result.success) {
      setError(result.error || 'Failed to cancel offer');
    }
    await refreshOffers();
    return result;
  }, [refreshOffers]);

  // Toggle item selection
  const toggleMyAsset = useCallback((assetId: string) => {
    setMySelectedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  }, []);

  /** Set a specific set of asset IDs from a stack (replacing any previous selection from those IDs) */
  const setMyStackSelection = useCallback((allAssetIds: string[], selectedCount: number) => {
    setMySelectedAssets((prev) => {
      const next = new Set(prev);
      // Remove all IDs from this stack first
      for (const id of allAssetIds) {
        next.delete(id);
      }
      // Add the first N
      for (let i = 0; i < selectedCount && i < allAssetIds.length; i++) {
        next.add(allAssetIds[i]);
      }
      return next;
    });
  }, []);

  /** Set a specific set of their asset IDs from a stack (replacing any previous selection from those IDs) */
  const setTheirStackSelection = useCallback((allAssetIds: string[], selectedCount: number) => {
    setTheirSelectedAssets((prev) => {
      const next = new Set(prev);
      for (const id of allAssetIds) {
        next.delete(id);
      }
      for (let i = 0; i < selectedCount && i < allAssetIds.length; i++) {
        next.add(allAssetIds[i]);
      }
      return next;
    });
  }, []);

  const toggleTheirAsset = useCallback((assetId: string) => {
    setTheirSelectedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
  }, []);

  const clearSelections = useCallback(() => {
    setMySelectedAssets(new Set());
    setTheirSelectedAssets(new Set());
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // Initial load
  useEffect(() => {
    if (!initialLoad.current) {
      initialLoad.current = true;
      loadFriends();
      refreshOffers();
      loadMyTradableIds();
    }
  }, [loadFriends, refreshOffers, loadMyTradableIds]);

  return {
    // Friends
    friends,
    friendsLoading,
    loadFriends,

    // Selected friend
    selectedFriend,
    selectFriend,
    friendInventory,
    friendInventoryLoading,

    // Tradable item IDs (from Steam API)
    myTradableIds,
    tradableIdsLoading,
    loadMyTradableIds,

    // Trade offers
    sentOffers,
    receivedOffers,
    offersLoading,
    refreshOffers,

    // Item selections
    mySelectedAssets,
    theirSelectedAssets,
    toggleMyAsset,
    setMyStackSelection,
    toggleTheirAsset,
    setTheirStackSelection,
    clearSelections,

    // Actions
    sendOffer,
    acceptOffer,
    declineOffer,
    cancelOffer,

    // Status
    progress,
    error,
    clearError,
  };
}
