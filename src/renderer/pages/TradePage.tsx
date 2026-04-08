// ============================================================
// CSInventoryPorter — Trade Page
// Trade CS2 items with friends directly from the app
// ============================================================

import { useState, useMemo, memo, useCallback, useContext } from 'react';
import type { useAuth } from '../hooks/useAuth';
import { useTrade } from '../hooks/useTrade';
import { useInventory } from '../hooks/useInventory';
import type { SteamFriend, TradeItem, TradeOffer, InventoryItem } from '../../shared/types';
import { CurrencyContext } from '../App';
import NavBar from '../components/NavBar';
import { type AppPage, stackItems, type StackedItem } from '../utils/itemUtils';

interface Props {
  auth: ReturnType<typeof useAuth>;
  onNavigate: (page: AppPage) => void;
}

// ---- Trade tab type ----
type TradeTab = 'create' | 'offers';

// ---- Stacking for friend (TradeItem) inventory ----

interface StackedTradeItem {
  item: TradeItem;
  count: number;
  allItems: TradeItem[];
}

/**
 * Stack trade items.
 *
 * Characteristics:
 * - @param items - The parameter for items
 * - @returns StackedTradeItem[]
 *
 */
function stackTradeItems(items: TradeItem[]): StackedTradeItem[] {
  const groups = new Map<string, TradeItem[]>();
  for (const item of items) {
    const key = item.market_hash_name || item.name || item.assetid;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return Array.from(groups.values()).map((group) => ({
    item: group[0],
    count: group.length,
    allItems: group,
  }));
}

// ---- Status dot colors for persona state ----
/**
 * Persona status color.
 *
 * Characteristics:
 * - @param state - The parameter for state
 * - @returns string
 *
 */
function personaStatusColor(state: number): string {
  switch (state) {
    case 1: return 'bg-blue-400';       // Online
    case 2: return 'bg-red-400';        // Busy
    case 3: return 'bg-yellow-400';     // Away
    case 4: return 'bg-yellow-500';     // Snooze
    case 5: return 'bg-blue-300';       // Looking to trade
    case 6: return 'bg-green-300';      // Looking to play
    default: return 'bg-slate-500';     // Offline
  }
}

/**
 * Persona status text.
 *
 * Characteristics:
 * - @param state - The parameter for state
 * - @returns string
 *
 */
function personaStatusText(state: number): string {
  switch (state) {
    case 1: return 'Online';
    case 2: return 'Busy';
    case 3: return 'Away';
    case 4: return 'Snooze';
    case 5: return 'Looking to Trade';
    case 6: return 'Looking to Play';
    default: return 'Offline';
  }
}

/**
 * Offer state color.
 *
 * Characteristics:
 * - @param state - The parameter for state
 * - @returns string
 *
 */
function offerStateColor(state: string): string {
  switch (state) {
    case 'Active': return 'text-blue-400';
    case 'Accepted': return 'text-green-400';
    case 'Countered': return 'text-yellow-400';
    case 'NeedsConfirmation': return 'text-amber-400';
    case 'InEscrow': return 'text-purple-400';
    case 'Declined':
    case 'Canceled':
    case 'CanceledBySecondFactor': return 'text-red-400';
    case 'Expired':
    case 'InvalidItems': return 'text-slate-400';
    default: return 'text-slate-400';
  }
}

// ---- Small Trade Item Card (friend's items) ----

const TradeItemCard = memo(function TradeItemCard({
  item,
  stackCount,
  selectedCount,
  onToggle,
  disabled,
}: {
  item: TradeItem;
  stackCount: number;
  selectedCount: number;
  onToggle?: () => void;
  disabled?: boolean;
}) {
  const isSelected = selectedCount > 0;

  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`
        group relative flex flex-col items-center rounded-lg border p-1.5 transition-all duration-150
        ${isSelected
          ? 'border-blue-500 bg-blue-500/20 ring-1 ring-blue-500/40'
          : 'border-slate-700 bg-slate-800/60 hover:border-slate-500 hover:bg-slate-800'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
      title={item.name}
    >
      {/* Stack count badge */}
      {stackCount > 1 && (
        <span className="absolute top-0.5 left-0.5 min-w-[18px] h-[18px] bg-slate-700 text-slate-300 text-[10px] font-bold rounded-full flex items-center justify-center px-1 z-10">
          {isSelected ? `${selectedCount}/${stackCount}` : `×${stackCount}`}
        </span>
      )}

      {/* Item image */}
      <div className="w-16 h-12 flex items-center justify-center">
        {item.icon_url ? (
          <img
            src={item.icon_url}
            alt={item.name}
            className="max-h-full max-w-full object-contain"
            loading="lazy"
          />
        ) : (
          <div className="w-10 h-10 rounded bg-slate-700 flex items-center justify-center">
            <span className="text-slate-500 text-xs">?</span>
          </div>
        )}
      </div>

      {/* Item name */}
      <p
        className="text-[10px] leading-tight text-center mt-1 line-clamp-2 w-full"
        style={{ color: item.color ? `#${item.color}` : undefined }}
      >
        {item.name}
      </p>

      {/* Selection checkmark */}
      {isSelected && (
        <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
      )}
    </button>
  );
});

// ---- My Inventory Item Card (stacked, with quantity badge) ----

const MyItemCard = memo(function MyItemCard({
  item,
  stackCount,
  selectedCount,
  onToggle,
}: {
  item: InventoryItem;
  stackCount: number;
  selectedCount: number;
  onToggle?: () => void;
}) {
  const imgUrl = item.image_url || (item.icon_path ? `https://community.akamai.steamstatic.com/economy/image/${item.icon_path}` : '');
  const isSelected = selectedCount > 0;

  return (
    <button
      onClick={onToggle}
      className={`
        group relative flex flex-col items-center rounded-lg border p-1.5 transition-all duration-150 cursor-pointer
        ${isSelected
          ? 'border-blue-500 bg-blue-500/20 ring-1 ring-blue-500/40'
          : 'border-slate-700 bg-slate-800/60 hover:border-slate-500 hover:bg-slate-800'
        }
      `}
      title={item.market_name || item.custom_name || `Item ${item.id}`}
    >
      {/* Stack count badge */}
      {stackCount > 1 && (
        <span className="absolute top-0.5 left-0.5 min-w-[18px] h-[18px] bg-slate-700 text-slate-300 text-[10px] font-bold rounded-full flex items-center justify-center px-1 z-10">
          {isSelected ? `${selectedCount}/${stackCount}` : `×${stackCount}`}
        </span>
      )}

      <div className="w-16 h-12 flex items-center justify-center">
        {imgUrl ? (
          <img
            src={imgUrl}
            alt={item.market_name || ''}
            className="max-h-full max-w-full object-contain"
            loading="lazy"
          />
        ) : (
          <div className="w-10 h-10 rounded bg-slate-700 flex items-center justify-center">
            <span className="text-slate-500 text-xs">?</span>
          </div>
        )}
      </div>

      <p
        className="text-[10px] leading-tight text-center mt-1 line-clamp-2 w-full"
        style={{ color: item.rarity_color ? `#${item.rarity_color}` : undefined }}
      >
        {item.market_name || item.custom_name || 'Unknown Item'}
      </p>

      {isSelected && (
        <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </div>
      )}
    </button>
  );
});

// ---- Quantity Picker Popup ----

/**
 * Quantity picker.
 *
 * Characteristics:
 * - @param {
 *   stackName,
 *   maxCount,
 *   currentCount,
 *   onConfirm,
 *   onClose,
 * } - The parameter for {
 *   stackName,
 *   maxCount,
 *   currentCount,
 *   onConfirm,
 *   onClose,
 * }
 * - @returns React.JSX.Element
 *
 */
function QuantityPicker({
  stackName,
  maxCount,
  currentCount,
  onConfirm,
  onClose,
}: {
  stackName: string;
  maxCount: number;
  currentCount: number;
  onConfirm: (count: number) => void;
  onClose: () => void;
}) {
  const [qty, setQty] = useState(currentCount > 0 ? 0 : Math.min(1, maxCount));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-5 w-80 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-slate-200 truncate">{stackName}</h3>
        <p className="text-xs text-slate-400">
          How many do you want to include in this trade?
        </p>

        {/* Quantity controls */}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setQty(Math.max(0, qty - 1))}
            className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center text-lg font-bold transition-colors"
          >
            −
          </button>
          <input
            type="number"
            min={0}
            max={maxCount}
            value={qty}
            onChange={(e) => {
              const v = Math.max(0, Math.min(maxCount, parseInt(e.target.value) || 0));
              setQty(v);
            }}
            className="w-16 text-center rounded-lg bg-slate-900 border border-slate-600 text-slate-200 text-lg font-bold py-1 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => setQty(Math.min(maxCount, qty + 1))}
            className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center text-lg font-bold transition-colors"
          >
            +
          </button>
        </div>

        {/* Quick select buttons */}
        {maxCount > 1 && (
          <div className="flex gap-2 justify-center">
            <button onClick={() => setQty(0)} className="px-2 py-0.5 text-[10px] rounded bg-slate-700 hover:bg-slate-600 text-slate-300">None</button>
            <button onClick={() => setQty(1)} className="px-2 py-0.5 text-[10px] rounded bg-slate-700 hover:bg-slate-600 text-slate-300">1</button>
            {maxCount >= 5 && <button onClick={() => setQty(5)} className="px-2 py-0.5 text-[10px] rounded bg-slate-700 hover:bg-slate-600 text-slate-300">5</button>}
            {maxCount >= 10 && <button onClick={() => setQty(10)} className="px-2 py-0.5 text-[10px] rounded bg-slate-700 hover:bg-slate-600 text-slate-300">10</button>}
            {maxCount >= 25 && <button onClick={() => setQty(25)} className="px-2 py-0.5 text-[10px] rounded bg-slate-700 hover:bg-slate-600 text-slate-300">25</button>}
            <button onClick={() => setQty(maxCount)} className="px-2 py-0.5 text-[10px] rounded bg-slate-700 hover:bg-slate-600 text-slate-300">All ({maxCount})</button>
          </div>
        )}

        <p className="text-[10px] text-slate-500 text-center">Max: {maxCount}</p>

        {/* Confirm / Cancel */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 text-sm font-medium rounded-lg border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(qty)}
            className="flex-1 py-2 text-sm font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            {qty === 0 ? 'Remove' : `Select ${qty}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Friend List Item ----

const FriendItem = memo(function FriendItem({
  friend,
  isSelected,
  onSelect,
}: {
  friend: SteamFriend;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors text-left ${
        isSelected
          ? 'bg-blue-600/30 border border-blue-500/40'
          : 'hover:bg-slate-700/50 border border-transparent'
      }`}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        {friend.avatarUrl ? (
          <img src={friend.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-xs">
            {friend.personaName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-slate-900 ${personaStatusColor(friend.personaState)}`} />
      </div>

      {/* Name + status */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-200 truncate">{friend.personaName}</p>
        <p className="text-[10px] text-slate-500 truncate">
          {friend.gameName || personaStatusText(friend.personaState)}
        </p>
      </div>
    </button>
  );
});

// ---- Offer Card (compact) ----

/**
 * Offer card.
 *
 * Characteristics:
 * - @param {
 *   offer,
 *   onAccept,
 *   onDecline,
 *   onCancel,
 * } - The parameter for {
 *   offer,
 *   onAccept,
 *   onDecline,
 *   onCancel,
 * }
 * - @returns React.JSX.Element
 *
 */
function OfferCard({
  offer,
  onAccept,
  onDecline,
  onCancel,
}: {
  offer: TradeOffer;
  onAccept?: (id: string) => void;
  onDecline?: (id: string) => void;
  onCancel?: (id: string) => void;
}) {
  const isActive = offer.state === 'Active';

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {offer.partnerAvatar ? (
            <img src={offer.partnerAvatar} alt="" className="w-6 h-6 rounded-full" />
          ) : (
            <div className="w-6 h-6 rounded-full bg-slate-600" />
          )}
          <span className="text-sm font-medium text-slate-200">
            {offer.partnerName || offer.partnerId}
          </span>
          <span className="text-xs text-slate-500">
            #{offer.id}
          </span>
        </div>
        <span className={`text-xs font-medium ${offerStateColor(offer.state)}`}>
          {offer.state === 'NeedsConfirmation' ? 'Needs Confirm' : offer.state}
        </span>
      </div>

      {/* Items summary */}
      <div className="flex gap-3">
        {/* Items to give */}
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-red-400 uppercase font-medium mb-1">
            {offer.isOurOffer ? 'You give' : 'They give'} ({offer.isOurOffer ? offer.itemsToGive.length : offer.itemsToReceive.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {(offer.isOurOffer ? offer.itemsToGive : offer.itemsToReceive).slice(0, 6).map((item, i) => (
              <div key={i} className="w-10 h-8 rounded border border-slate-700 bg-slate-900/50 flex items-center justify-center" title={item.name}>
                {item.icon_url ? (
                  <img src={item.icon_url} alt="" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-[8px] text-slate-500">?</span>
                )}
              </div>
            ))}
            {(offer.isOurOffer ? offer.itemsToGive : offer.itemsToReceive).length > 6 && (
              <div className="w-10 h-8 rounded border border-slate-700 bg-slate-900/50 flex items-center justify-center text-[10px] text-slate-400">
                +{(offer.isOurOffer ? offer.itemsToGive : offer.itemsToReceive).length - 6}
              </div>
            )}
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-center px-1">
          <svg className="w-4 h-4 text-slate-600" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </div>

        {/* Items to receive */}
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-green-400 uppercase font-medium mb-1">
            {offer.isOurOffer ? 'You receive' : 'They receive'} ({offer.isOurOffer ? offer.itemsToReceive.length : offer.itemsToGive.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {(offer.isOurOffer ? offer.itemsToReceive : offer.itemsToGive).slice(0, 6).map((item, i) => (
              <div key={i} className="w-10 h-8 rounded border border-slate-700 bg-slate-900/50 flex items-center justify-center" title={item.name}>
                {item.icon_url ? (
                  <img src={item.icon_url} alt="" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-[8px] text-slate-500">?</span>
                )}
              </div>
            ))}
            {(offer.isOurOffer ? offer.itemsToReceive : offer.itemsToGive).length > 6 && (
              <div className="w-10 h-8 rounded border border-slate-700 bg-slate-900/50 flex items-center justify-center text-[10px] text-slate-400">
                +{(offer.isOurOffer ? offer.itemsToReceive : offer.itemsToGive).length - 6}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Message */}
      {offer.message && (
        <p className="text-xs text-slate-400 italic truncate">"{offer.message}"</p>
      )}

      {/* Actions */}
      {isActive && (
        <div className="flex gap-2 pt-1">
          {!offer.isOurOffer && onAccept && (
            <button
              onClick={() => onAccept(offer.id)}
              className="px-3 py-1 text-xs font-medium rounded-md bg-green-600 hover:bg-green-500 text-white transition-colors"
            >
              Accept
            </button>
          )}
          {!offer.isOurOffer && onDecline && (
            <button
              onClick={() => onDecline(offer.id)}
              className="px-3 py-1 text-xs font-medium rounded-md bg-red-600/80 hover:bg-red-500 text-white transition-colors"
            >
              Decline
            </button>
          )}
          {offer.isOurOffer && onCancel && (
            <button
              onClick={() => onCancel(offer.id)}
              className="px-3 py-1 text-xs font-medium rounded-md bg-slate-600 hover:bg-slate-500 text-white transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main TradePage component
// ============================================================

/**
 * Trade page.
 *
 * Characteristics:
 * - @param { auth, onNavigate } - The parameter for { auth, onNavigate }
 * - @returns React.JSX.Element
 *
 */
export default function TradePage({ auth, onNavigate }: Props) {
  const { status, logout } = auth;
  const trade = useTrade();
  const inventory = useInventory();

  const [activeTab, setActiveTab] = useState<TradeTab>('create');
  const [tradeMessage, setTradeMessage] = useState('');
  const [tradeToken, setTradeToken] = useState('');
  const [friendSearch, setFriendSearch] = useState('');
  const [myItemSearch, setMyItemSearch] = useState('');
  const [theirItemSearch, setTheirItemSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [myQtyPicker, setMyQtyPicker] = useState<StackedItem | null>(null);
  const [theirQtyPicker, setTheirQtyPicker] = useState<StackedTradeItem | null>(null);

  // Filter friends by search
  const filteredFriends = useMemo(() => {
    if (!friendSearch.trim()) return trade.friends;
    const q = friendSearch.toLowerCase();
    return trade.friends.filter((f) => f.personaName.toLowerCase().includes(q));
  }, [trade.friends, friendSearch]);

  // Filter my inventory items for trading (only items confirmed tradable by Steam API)
  const myTradableItems = useMemo(() => {
    return inventory.items.filter((item) => {
      if (item.is_storage_unit) return false;
      // If tradable IDs are loaded, only show items in that set
      if (trade.myTradableIds) {
        return trade.myTradableIds.has(item.id);
      }
      // While loading, show all non-storage-unit items
      return true;
    });
  }, [inventory.items, trade.myTradableIds]);

  // Stack my tradable items
  const myStackedItems = useMemo(() => stackItems(myTradableItems), [myTradableItems]);

  // Filter stacked items by search
  const filteredMyStacks = useMemo(() => {
    if (!myItemSearch.trim()) return myStackedItems;
    const q = myItemSearch.toLowerCase();
    return myStackedItems.filter((s) =>
      (s.item.market_name || s.item.custom_name || '').toLowerCase().includes(q),
    );
  }, [myStackedItems, myItemSearch]);

  // Filter friend's inventory items by search, then stack
  const filteredTheirStacks = useMemo(() => {
    let items = trade.friendInventory;
    if (theirItemSearch.trim()) {
      const q = theirItemSearch.toLowerCase();
      items = items.filter((item) =>
        item.name.toLowerCase().includes(q) || item.market_hash_name.toLowerCase().includes(q),
      );
    }
    return stackTradeItems(items);
  }, [trade.friendInventory, theirItemSearch]);

  // Helper: count how many items in a stack are selected
  const myStackSelectedCount = useCallback(
    (stack: StackedItem) => stack.allItems.filter((i) => trade.mySelectedAssets.has(i.id)).length,
    [trade.mySelectedAssets],
  );

  const theirStackSelectedCount = useCallback(
    (stack: StackedTradeItem) => stack.allItems.filter((i) => trade.theirSelectedAssets.has(i.assetid)).length,
    [trade.theirSelectedAssets],
  );

  // Send trade offer handler
  const handleSendOffer = useCallback(async () => {
    setSending(true);
    try {
      await trade.sendOffer(tradeMessage || undefined, tradeToken || undefined);
      setTradeMessage('');
      setTradeToken('');
    } finally {
      setSending(false);
    }
  }, [trade, tradeMessage, tradeToken]);

  // Count active offers
  const activeReceivedCount = trade.receivedOffers.filter((o) => o.state === 'Active').length;

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-slate-100">
      {/* Top bar */}
      <NavBar activePage="trade" onNavigate={onNavigate} status={status} onLogout={logout} />

      {/* Sub-navigation: Create Trade / Active Offers */}
      <div className="px-6 py-2 border-b border-slate-700/50 bg-slate-800/30 shrink-0 flex items-center gap-4">
        <button
          onClick={() => setActiveTab('create')}
          className={`text-sm font-medium px-3 py-1.5 rounded-md transition-colors ${
            activeTab === 'create'
              ? 'bg-blue-600/30 text-blue-400 border border-blue-500/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Create Trade
        </button>
        <button
          onClick={() => setActiveTab('offers')}
          className={`text-sm font-medium px-3 py-1.5 rounded-md transition-colors relative ${
            activeTab === 'offers'
              ? 'bg-blue-600/30 text-blue-400 border border-blue-500/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Trade Offers
          {activeReceivedCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
              {activeReceivedCount}
            </span>
          )}
        </button>

        {/* Error display */}
        {trade.error && (
          <div className="flex-1 flex items-center justify-end">
            <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-red-500/20 border border-red-500/30">
              <span className="text-xs text-red-400">{trade.error}</span>
              <button onClick={trade.clearError} className="text-red-400 hover:text-red-300">
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      {activeTab === 'create' ? (
        <div className="flex-1 flex min-h-0">
          {/* Friends sidebar */}
          <aside className="w-64 border-r border-slate-700 flex flex-col bg-slate-800/30 shrink-0">
            <div className="p-3 border-b border-slate-700/50">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-slate-300">
                  Friends ({trade.friends.length})
                </h2>
                <button
                  onClick={trade.loadFriends}
                  disabled={trade.friendsLoading}
                  className="text-xs text-blue-400 hover:text-blue-300 disabled:text-slate-600 transition-colors"
                >
                  {trade.friendsLoading ? 'Loading...' : 'Refresh'}
                </button>
              </div>
              <input
                type="text"
                value={friendSearch}
                onChange={(e) => setFriendSearch(e.target.value)}
                placeholder="Search friends..."
                className="w-full px-2.5 py-1.5 rounded-md bg-slate-900/60 border border-slate-700 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {trade.friendsLoading && trade.friends.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <svg className="w-5 h-5 text-slate-500 animate-spin" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              ) : filteredFriends.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">
                  {friendSearch ? 'No friends match your search' : 'No friends found'}
                </p>
              ) : (
                filteredFriends.map((friend) => (
                  <FriendItem
                    key={friend.steamID}
                    friend={friend}
                    isSelected={trade.selectedFriend?.steamID === friend.steamID}
                    onSelect={() => trade.selectFriend(friend)}
                  />
                ))
              )}
            </div>
          </aside>

          {/* Trade area */}
          <main className="flex-1 flex flex-col min-h-0 min-w-0">
            {!trade.selectedFriend ? (
              /* No friend selected */
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-3">
                  <div className="w-16 h-16 mx-auto rounded-full bg-slate-800 flex items-center justify-center">
                    <svg className="w-8 h-8 text-slate-600" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-slate-300">Select a friend to trade with</h3>
                  <p className="text-sm text-slate-500">Choose a friend from the list on the left</p>
                </div>
              </div>
            ) : (
              /* Trade creation interface */
              <div className="flex-1 flex flex-col min-h-0">
                {/* Selected friend header */}
                <div className="px-4 py-2.5 border-b border-slate-700/50 bg-slate-800/20 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-3">
                    {trade.selectedFriend.avatarUrl ? (
                      <img src={trade.selectedFriend.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-slate-600" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-slate-200">{trade.selectedFriend.personaName}</p>
                      <p className="text-[10px] text-slate-500">
                        {trade.selectedFriend.gameName || personaStatusText(trade.selectedFriend.personaState)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={tradeToken}
                      onChange={(e) => setTradeToken(e.target.value)}
                      placeholder="Trade token (optional)"
                      className="px-2.5 py-1 rounded-md bg-slate-900/60 border border-slate-700 text-xs text-slate-200 placeholder-slate-500 w-44 focus:outline-none focus:border-blue-500/50"
                    />
                  </div>
                </div>

                {/* Two inventory grids side by side */}
                <div className="flex-1 flex min-h-0">
                  {/* My items */}
                  <div className="flex-1 flex flex-col border-r border-slate-700/50 min-w-0">
                    <div className="px-4 py-2 border-b border-slate-700/30 flex items-center justify-between shrink-0">
                      <h3 className="text-xs font-semibold text-slate-400 uppercase">
                        Your Items
                        <span className="ml-1 text-blue-400">({trade.mySelectedAssets.size} selected)</span>
                      </h3>
                      <input
                        type="text"
                        value={myItemSearch}
                        onChange={(e) => setMyItemSearch(e.target.value)}
                        placeholder="Search..."
                        className="px-2 py-1 rounded bg-slate-900/60 border border-slate-700 text-[11px] text-slate-200 placeholder-slate-500 w-32 focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                    <div className="flex-1 overflow-y-auto p-2">
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-1.5">
                        {filteredMyStacks.map((stack) => {
                          const selCount = myStackSelectedCount(stack);
                          return (
                            <MyItemCard
                              key={stack.item.id}
                              item={stack.item}
                              stackCount={stack.count}
                              selectedCount={selCount}
                              onToggle={() => {
                                if (stack.count === 1) {
                                  trade.toggleMyAsset(stack.item.id);
                                } else {
                                  setMyQtyPicker(stack);
                                }
                              }}
                            />
                          );
                        })}
                      </div>
                      {filteredMyStacks.length === 0 && (
                        <p className="text-xs text-slate-500 text-center py-8">
                          {myItemSearch ? 'No items match' : 'No tradable items in your inventory'}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Their items */}
                  <div className="flex-1 flex flex-col min-w-0">
                    <div className="px-4 py-2 border-b border-slate-700/30 flex items-center justify-between shrink-0">
                      <h3 className="text-xs font-semibold text-slate-400 uppercase">
                        Their Items
                        <span className="ml-1 text-green-400">({trade.theirSelectedAssets.size} selected)</span>
                      </h3>
                      <input
                        type="text"
                        value={theirItemSearch}
                        onChange={(e) => setTheirItemSearch(e.target.value)}
                        placeholder="Search..."
                        className="px-2 py-1 rounded bg-slate-900/60 border border-slate-700 text-[11px] text-slate-200 placeholder-slate-500 w-32 focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                    <div className="flex-1 overflow-y-auto p-2">
                      {trade.friendInventoryLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <svg className="w-5 h-5 text-slate-500 animate-spin mr-2" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          <span className="text-xs text-slate-400">Loading inventory...</span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-1.5">
                          {filteredTheirStacks.map((stack) => {
                            const selCount = theirStackSelectedCount(stack);
                            return (
                              <TradeItemCard
                                key={stack.item.assetid}
                                item={stack.item}
                                stackCount={stack.count}
                                selectedCount={selCount}
                                onToggle={() => {
                                  if (stack.count === 1) {
                                    trade.toggleTheirAsset(stack.item.assetid);
                                  } else {
                                    setTheirQtyPicker(stack);
                                  }
                                }}
                              />
                            );
                          })}
                        </div>
                      )}
                      {!trade.friendInventoryLoading && filteredTheirStacks.length === 0 && (
                        <p className="text-xs text-slate-500 text-center py-8">
                          {theirItemSearch ? 'No items match' : "No tradable CS2 items in friend's inventory"}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer: Message + Send button */}
                <div className="px-4 py-3 border-t border-slate-700 bg-slate-800/50 flex items-center gap-3 shrink-0">
                  <input
                    type="text"
                    value={tradeMessage}
                    onChange={(e) => setTradeMessage(e.target.value)}
                    placeholder="Add a message to your offer (optional)..."
                    maxLength={128}
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                  />
                  <div className="flex items-center gap-2">
                    {(trade.mySelectedAssets.size > 0 || trade.theirSelectedAssets.size > 0) && (
                      <button
                        onClick={trade.clearSelections}
                        className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      onClick={handleSendOffer}
                      disabled={sending || (trade.mySelectedAssets.size === 0 && trade.theirSelectedAssets.size === 0)}
                      className="px-5 py-2 text-sm font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white transition-colors"
                    >
                      {sending ? 'Sending...' : `Send Offer (${trade.mySelectedAssets.size} → ${trade.theirSelectedAssets.size})`}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      ) : (
        /* Trade Offers tab */
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Refresh button */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-200">Trade Offers</h2>
              <button
                onClick={trade.refreshOffers}
                disabled={trade.offersLoading}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-700 hover:bg-slate-600 text-slate-300 disabled:text-slate-500 transition-colors"
              >
                {trade.offersLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            {/* Received offers */}
            <div>
              <h3 className="text-sm font-semibold text-slate-400 uppercase mb-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.707-10.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L9.414 11H13a1 1 0 100-2H9.414l1.293-1.293z" clipRule="evenodd" />
                </svg>
                Received ({trade.receivedOffers.length})
              </h3>
              {trade.receivedOffers.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">No received trade offers</p>
              ) : (
                <div className="space-y-2">
                  {trade.receivedOffers.map((offer) => (
                    <OfferCard
                      key={offer.id}
                      offer={offer}
                      onAccept={trade.acceptOffer}
                      onDecline={trade.declineOffer}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Sent offers */}
            <div>
              <h3 className="text-sm font-semibold text-slate-400 uppercase mb-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z" clipRule="evenodd" />
                </svg>
                Sent ({trade.sentOffers.length})
              </h3>
              {trade.sentOffers.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">No sent trade offers</p>
              ) : (
                <div className="space-y-2">
                  {trade.sentOffers.map((offer) => (
                    <OfferCard
                      key={offer.id}
                      offer={offer}
                      onCancel={trade.cancelOffer}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quantity picker modals */}
      {myQtyPicker && (
        <QuantityPicker
          stackName={myQtyPicker.item.market_name || myQtyPicker.item.custom_name || 'Unknown Item'}
          maxCount={myQtyPicker.count}
          currentCount={myStackSelectedCount(myQtyPicker)}
          onConfirm={(qty) => {
            trade.setMyStackSelection(
              myQtyPicker.allItems.map((i) => i.id),
              qty,
            );
            setMyQtyPicker(null);
          }}
          onClose={() => setMyQtyPicker(null)}
        />
      )}

      {theirQtyPicker && (
        <QuantityPicker
          stackName={theirQtyPicker.item.name || theirQtyPicker.item.market_hash_name || 'Unknown Item'}
          maxCount={theirQtyPicker.count}
          currentCount={theirStackSelectedCount(theirQtyPicker)}
          onConfirm={(qty) => {
            trade.setTheirStackSelection(
              theirQtyPicker.allItems.map((i) => i.assetid),
              qty,
            );
            setTheirQtyPicker(null);
          }}
          onClose={() => setTheirQtyPicker(null)}
        />
      )}
    </div>
  );
}
