// ============================================================
// CSInventoryPorter — Market Page
// List items for sale, manage active listings, delist items
// Phase 6: Market Listing Management
// ============================================================

import { useState, useMemo, useCallback, useEffect, useContext, useRef } from 'react';
import type { useAuth } from '../hooks/useAuth';
import { useInventory } from '../hooks/useInventory';
import { usePricing } from '../hooks/usePricing';
import { useMarket, calculateFees, calculateFromBuyerPrice } from '../hooks/useMarket';
import type { InventoryItem, MarketListing, MarketFeeBreakdown, PriceSnapshot } from '../../shared/types';
import { CurrencyContext } from '../App';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import NavBar from '../components/NavBar';
import { type AppPage, getWearShort, parseMarketName, nameFontClass } from '../utils/itemUtils';

interface Props {
  auth: ReturnType<typeof useAuth>;
  onNavigate: (page: AppPage) => void;
}

// ---- Tab type ----

type MarketTab = 'list' | 'active';

// ---- Market stacking & filtering ----

interface MarketStack {
  item: InventoryItem;       // Representative item (first in group)
  count: number;             // How many identical items
  allItems: InventoryItem[]; // All items in the stack
  sourceUnitId?: string;     // Storage unit ID (undefined = main inventory)
  sourceUnitName?: string;   // Storage unit display name
}

interface MarketEntry {
  item: InventoryItem;
  sourceUnitId?: string;
  sourceUnitName?: string;
}

type MarketTypeFilter = 'all' | 'weapon' | 'tool' | 'collectible' | 'music' | 'other';

/**
 * Gets market item type.
 *
 * Characteristics:
 * - @param item - The parameter for item
 * - @returns "weapon" | "tool" | "collectible" | "music" | "other"
 *
 */
function getMarketItemType(item: InventoryItem): Exclude<MarketTypeFilter, 'all'> {
  const wt = (item.weapon_type || '').toLowerCase();
  const name = (item.market_name || '').toLowerCase();

  if (wt === 'collectible' || /(medal|coin|pin|trophy|service)/.test(name)) return 'collectible';
  if (wt === 'music kit' || item.defindex === 1314) return 'music';
  if (wt === 'tool' || wt === 'equipment' || wt === 'key') return 'tool';
  if ((item.market_name || '').includes('|') || ['pistol', 'rifle', 'smg', 'shotgun', 'machinegun', 'sniper rifle', 'knife', 'gloves'].includes(wt)) {
    return 'weapon';
  }
  return 'other';
}

/** Check if an item can be listed on the Steam Community Market */
function isItemMarketable(item: InventoryItem): boolean {
  const hasSkinSegment = !!item.market_name?.includes('|');
  const SKIN_REQUIRED_WEAPON_TYPES = new Set(['Pistol', 'Rifle', 'SMG', 'Shotgun', 'Machinegun', 'Sniper Rifle']);

  // Use the backend-computed marketable flag if available
  if (item.marketable === false) return false;
  // Fallback filters in case the field is undefined (older cached data)
  if (!item.market_name) return false;
  if (/^Item #\d+$/i.test(item.market_name)) return false;
  if (item.is_storage_unit) return false;
  if (item.weapon_type === 'Pass') return false;
  if (item.weapon_type === 'Equipment') return false;
  if (item.weapon_type === 'Collectible') return false; // Service medals, coins, pins
  if (/\b(medal|coin|pin|trophy)\b/i.test(item.market_name)) return false;
  if (item.origin === 0 && SKIN_REQUIRED_WEAPON_TYPES.has(item.weapon_type || '') && !hasSkinSegment) return false;
  if (SKIN_REQUIRED_WEAPON_TYPES.has(item.weapon_type || '') && !hasSkinSegment) return false;
  if (item.defindex === 1349) return false;  // Unsealed graffiti
  if (item.defindex === 31) return false;    // Zeus x27
  if (item.defindex === 42 || item.defindex === 59) return false; // Default knives
  return true;
}

/** Check if an item can be stacked with identical items */
function isItemStackable(item: InventoryItem): boolean {
  if (item.paint_wear != null) return false; // Skins with wear are unique
  if (item.custom_name) return false;         // Name-tagged items are unique
  if (item.is_storage_unit) return false;
  return true;
}

/**
 * Stack market items.
 *
 * Characteristics:
 * - @param entries - The parameter for entries
 * - @returns MarketStack[]
 *
 */
function stackMarketItems(entries: MarketEntry[]): MarketStack[] {
  const groups = new Map<string, MarketEntry[]>();

  for (const entry of entries) {
    let key: string;
    if (!isItemStackable(entry.item)) {
      key = `unique:${entry.item.id}`;
    } else {
      const source = entry.sourceUnitId || 'inventory';
      key = `stack:${entry.item.market_name}:${source}`;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }

  return Array.from(groups.values()).map((group) => ({
    item: group[0].item,
    count: group.length,
    allItems: group.map((e) => e.item),
    sourceUnitId: group[0].sourceUnitId,
    sourceUnitName: group[0].sourceUnitName,
  }));
}

/** Robust trade hold check — handles Date objects and serialized strings */
function hasActiveTradeHold(item: InventoryItem): boolean {
  if (!item.tradable_after) return false;
  const holdTime = item.tradable_after instanceof Date
    ? item.tradable_after.getTime()
    : new Date(item.tradable_after).getTime();
  if (isNaN(holdTime)) return false;
  return holdTime > Date.now();
}

/**
 * Gets trade hold date.
 *
 * Characteristics:
 * - @param item - The parameter for item
 * - @returns Date
 *
 */
function getTradeHoldDate(item: InventoryItem): Date | null {
  if (!hasActiveTradeHold(item)) return null;
  return item.tradable_after instanceof Date
    ? item.tradable_after
    : new Date(item.tradable_after!);
}

// ---- Fee display component ----

/**
 * Fee breakdown.
 *
 * Characteristics:
 * - @param { fees, symbol } - The parameter for { fees, symbol }
 * - @returns React.JSX.Element
 *
 */
function FeeBreakdown({ fees, symbol }: { fees: MarketFeeBreakdown; symbol: string }) {
  return (
    <div className="text-xs space-y-0.5 text-slate-400">
      <div className="flex justify-between">
        <span>Buyer pays:</span>
        <span className="text-slate-200 font-medium">{symbol}{(fees.buyerPays / 100).toFixed(2)}</span>
      </div>
      <div className="flex justify-between">
        <span>Steam fee (5%):</span>
        <span className="text-red-400">-{symbol}{(fees.steamFee / 100).toFixed(2)}</span>
      </div>
      <div className="flex justify-between">
        <span>CS2 fee (10%):</span>
        <span className="text-red-400">-{symbol}{(fees.gameFee / 100).toFixed(2)}</span>
      </div>
      <div className="flex justify-between border-t border-slate-600 pt-0.5 mt-1">
        <span>You receive:</span>
        <span className="text-green-400 font-medium">{symbol}{(fees.youReceive / 100).toFixed(2)}</span>
      </div>
    </div>
  );
}

// ---- Listing dialog ----

/**
 * Listing dialog.
 *
 * Characteristics:
 * - @param {
 *   item,
 *   currentPrice,
 *   priceHistory,
 *   symbol,
 *   onConfirm,
 *   onCancel,
 * } - The parameter for {
 *   item,
 *   currentPrice,
 *   priceHistory,
 *   symbol,
 *   onConfirm,
 *   onCancel,
 * }
 * - @returns React.JSX.Element
 *
 */
function ListingDialog({
  item,
  currentPrice,
  priceHistory,
  symbol,
  onConfirm,
  onCancel,
}: {
  item: InventoryItem;
  currentPrice: number;
  priceHistory: PriceSnapshot[];
  symbol: string;
  onConfirm: (priceInCents: number) => void;
  onCancel: () => void;
}) {
  const parsedName = parseMarketName(item.market_name || 'Unknown Item');
  // Default price = current market price (in cents), or $1.00 as fallback
  const defaultCents = currentPrice > 0 ? Math.round(currentPrice * 100) : 100;
  const [priceInput, setPriceInput] = useState((defaultCents / 100).toFixed(2));
  const [inputMode, setInputMode] = useState<'receive' | 'buyer'>('buyer');

  const parsedCents = Math.round((parseFloat(priceInput) || 0) * 100);

  const fees = useMemo(() => {
    if (parsedCents <= 0) return calculateFees(1);
    if (inputMode === 'receive') {
      return calculateFees(parsedCents);
    } else {
      return calculateFromBuyerPrice(parsedCents);
    }
  }, [parsedCents, inputMode]);

  const isValid = parsedCents >= 1;

  // Check for trade hold (robust: handles Date objects and serialized strings)
  const hasTradeLock = hasActiveTradeHold(item);
  const tradeLockDate = getTradeHoldDate(item);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
        {/* Item info */}
        <div className="flex items-center gap-4 mb-5">
          {item.image_url && (
            <img
              src={item.image_url}
              alt={item.market_name || 'Item'}
              className="w-20 h-14 object-contain rounded bg-slate-700/50"
            />
          )}
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold text-slate-100 truncate ${nameFontClass(parsedName.skinName || parsedName.weaponName, false)}`}>
              {parsedName.skinName || parsedName.weaponName}
            </h3>
            {parsedName.skinName && (
              <p className="text-xs text-slate-400 truncate">{parsedName.weaponName}</p>
            )}
            {item.paint_wear != null && (
              <span className="text-xs text-slate-400">
                {getWearShort(item.paint_wear)} · {item.paint_wear.toFixed(8)}
              </span>
            )}
            {currentPrice > 0 && (
              <p className="text-xs text-slate-500 mt-0.5">
                Market price: {symbol}{currentPrice.toFixed(2)}
              </p>
            )}
          </div>
        </div>

        {/* Trade lock warning */}
        {hasTradeLock && tradeLockDate && (
          <div className="mb-4 p-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <p className="text-xs text-yellow-400">
              ⚠ This item has a trade hold until{' '}
              {tradeLockDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.
              It can still be listed, but won't be tradable until then.
            </p>
          </div>
        )}

        {/* Price history chart */}
        {priceHistory.length >= 2 && (
          <div className="mb-4">
            <p className="text-xs text-slate-400 mb-1">30-day price history</p>
            <div className="bg-slate-700/30 rounded-lg p-1">
              <PriceHistoryChart history={priceHistory} symbol={symbol} />
            </div>
          </div>
        )}

        {/* Price input */}
        <div className="space-y-3">
          {/* Input mode toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setInputMode('buyer')}
              className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                inputMode === 'buyer'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              Set buyer price
            </button>
            <button
              onClick={() => setInputMode('receive')}
              className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                inputMode === 'receive'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              Set receive price
            </button>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {inputMode === 'buyer' ? 'Buyer pays' : 'You receive'} ({symbol})
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">{symbol}</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg pl-7 pr-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
            </div>
          </div>

          {/* Fee breakdown */}
          {isValid && (
            <FeeBreakdown fees={fees} symbol={symbol} />
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 text-sm text-slate-400 hover:text-slate-200 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (isValid) {
                const cents = inputMode === 'receive' ? parsedCents : fees.youReceive;
                onConfirm(cents);
              }
            }}
            disabled={!isValid}
            className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              isValid
                ? 'bg-green-600 hover:bg-green-500 text-white'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            }`}
          >
            List for {symbol}{(fees.buyerPays / 100).toFixed(2)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Bulk listing dialog (for stacks) ----

/**
 * Bulk listing dialog.
 *
 * Characteristics:
 * - @param {
 *   stack,
 *   currentPrice,
 *   priceHistory,
 *   symbol,
 *   onConfirm,
 *   onCancel,
 * } - The parameter for {
 *   stack,
 *   currentPrice,
 *   priceHistory,
 *   symbol,
 *   onConfirm,
 *   onCancel,
 * }
 * - @returns React.JSX.Element
 *
 */
function BulkListingDialog({
  stack,
  currentPrice,
  priceHistory,
  symbol,
  onConfirm,
  onCancel,
}: {
  stack: MarketStack;
  currentPrice: number;
  priceHistory: PriceSnapshot[];
  symbol: string;
  onConfirm: (assetIds: string[], priceInCents: number) => void;
  onCancel: () => void;
}) {
  const parsedName = parseMarketName(stack.item.market_name || 'Unknown Item');
  const defaultCents = currentPrice > 0 ? Math.round(currentPrice * 100) : 100;
  const [priceInput, setPriceInput] = useState((defaultCents / 100).toFixed(2));
  const [quantity, setQuantity] = useState(stack.count);
  const [inputMode, setInputMode] = useState<'receive' | 'buyer'>('buyer');

  const parsedCents = Math.round((parseFloat(priceInput) || 0) * 100);

  const fees = useMemo(() => {
    if (parsedCents <= 0) return calculateFees(1);
    if (inputMode === 'receive') return calculateFees(parsedCents);
    return calculateFromBuyerPrice(parsedCents);
  }, [parsedCents, inputMode]);

  const isValid = parsedCents >= 1 && quantity >= 1 && quantity <= stack.count;

  const totalYouReceive = fees.youReceive * quantity;

  // Check trade holds
  const holdCount = stack.allItems.filter((i) => hasActiveTradeHold(i)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
        {/* Item info */}
        <div className="flex items-center gap-4 mb-5">
          {stack.item.image_url && (
            <img
              src={stack.item.image_url}
              alt={stack.item.market_name || 'Item'}
              className="w-20 h-14 object-contain rounded bg-slate-700/50"
            />
          )}
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold text-slate-100 truncate ${nameFontClass(parsedName.skinName || parsedName.weaponName, false)}`}>
              {parsedName.skinName || parsedName.weaponName}
            </h3>
            {parsedName.skinName && (
              <p className="text-xs text-slate-400 truncate">{parsedName.weaponName}</p>
            )}
            <p className="text-xs text-slate-400">×{stack.count} available</p>
            {stack.sourceUnitName && (
              <p className="text-[10px] text-cyan-400 mt-0.5">📦 {stack.sourceUnitName}</p>
            )}
            {currentPrice > 0 && (
              <p className="text-xs text-slate-500 mt-0.5">
                Market price: {symbol}{currentPrice.toFixed(2)}
              </p>
            )}
          </div>
        </div>

        {/* Trade hold warning */}
        {holdCount > 0 && (
          <div className="mb-4 p-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <p className="text-xs text-yellow-400">
              ⚠ {holdCount} of {stack.count} item{stack.count !== 1 ? 's' : ''} ha{holdCount === 1 ? 's' : 've'} a trade hold.
              They can still be listed but won't be tradable until the hold expires.
            </p>
          </div>
        )}

        {/* Price history chart */}
        {priceHistory.length >= 2 && (
          <div className="mb-3">
            <p className="text-xs text-slate-400 mb-1">30-day price history</p>
            <div className="bg-slate-700/30 rounded-lg p-1">
              <PriceHistoryChart history={priceHistory} symbol={symbol} />
            </div>
          </div>
        )}

        {/* Quantity selector */}
        <div className="mb-3">
          <label className="block text-xs text-slate-400 mb-1">Quantity to sell</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={stack.count}
              value={quantity}
              onChange={(e) => setQuantity(Math.min(stack.count, Math.max(1, parseInt(e.target.value) || 1)))}
              className="w-24 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <span className="text-xs text-slate-500">of {stack.count}</span>
            <button
              onClick={() => setQuantity(stack.count)}
              className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-600"
            >
              All
            </button>
          </div>
        </div>

        {/* Price input */}
        <div className="space-y-3">
          {/* Input mode toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setInputMode('buyer')}
              className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                inputMode === 'buyer'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              Set buyer price
            </button>
            <button
              onClick={() => setInputMode('receive')}
              className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
                inputMode === 'receive'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              Set receive price
            </button>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {inputMode === 'buyer' ? 'Buyer pays' : 'You receive'} per item ({symbol})
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">{symbol}</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg pl-7 pr-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
            </div>
          </div>

          {/* Per-item fee breakdown */}
          {isValid && <FeeBreakdown fees={fees} symbol={symbol} />}

          {/* Total summary for multiple items */}
          {isValid && quantity > 1 && (
            <div className="pt-2 border-t border-slate-600">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">Total for {quantity} items:</span>
                <span className="text-green-400 font-medium">
                  {symbol}{(totalYouReceive / 100).toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 text-sm text-slate-400 hover:text-slate-200 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (isValid) {
                const cents = inputMode === 'receive' ? parsedCents : fees.youReceive;
                const ids = stack.allItems.slice(0, quantity).map((i) => i.id);
                onConfirm(ids, cents);
              }
            }}
            disabled={!isValid}
            className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              isValid
                ? 'bg-green-600 hover:bg-green-500 text-white'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            }`}
          >
            List {quantity}× for {symbol}{(fees.buyerPays / 100).toFixed(2)} each
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Price history mini-chart (30 days) ----

/**
 * Price history chart.
 *
 * Characteristics:
 * - @param { history, symbol } - The parameter for { history, symbol }
 * - @returns React.JSX.Element
 *
 */
function PriceHistoryChart({ history, symbol }: { history: PriceSnapshot[]; symbol: string }) {
  // Filter to the last 30 days
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const data = useMemo(() => {
    const pts = history.filter((p) => p.time >= cutoff);
    if (pts.length === 0) return [];
    // Downsample to ~60 points max for performance
    if (pts.length <= 60) return pts;
    const step = Math.ceil(pts.length / 60);
    return pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  }, [history, cutoff]);

  if (data.length < 2) {
    return (
      <div className="h-28 flex items-center justify-center text-xs text-slate-500">
        Not enough price history
      </div>
    );
  }

  const minVal = Math.min(...data.map((d) => d.value));
  const maxVal = Math.max(...data.map((d) => d.value));
  const padding = (maxVal - minVal) * 0.1 || 0.5;

  return (
    <div className="h-28">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <XAxis
            dataKey="time"
            tickFormatter={(t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            tick={{ fontSize: 9, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            domain={[minVal - padding, maxVal + padding]}
            tick={{ fontSize: 9, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${symbol}${v.toFixed(2)}`}
            width={50}
          />
          <Tooltip
            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: '#94a3b8' }}
            labelFormatter={(t: any) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            formatter={(value: any) => [`${symbol}${Number(value).toFixed(2)}`, 'Price']}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#22d3ee"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: '#22d3ee' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---- Selected items sell dialog ----

interface SelectedItemEntry {
  stack: MarketStack;
  priceInput: string;
}

/**
 * Selected sell dialog.
 *
 * Characteristics:
 * - @param {
 *   entries,
 *   symbol,
 *   onConfirm,
 *   onCancel,
 * } - The parameter for {
 *   entries,
 *   symbol,
 *   onConfirm,
 *   onCancel,
 * }
 * - @returns React.JSX.Element
 *
 */
function SelectedSellDialog({
  entries,
  symbol,
  onConfirm,
  onCancel,
}: {
  entries: SelectedItemEntry[];
  symbol: string;
  onConfirm: (requests: { assetId: string; priceInCents: number }[]) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<'same' | 'individual'>('same');
  const [samePriceInput, setSamePriceInput] = useState('');
  const [individualPrices, setIndividualPrices] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const e of entries) {
      map[e.stack.item.id] = e.priceInput;
    }
    return map;
  });
  const [individualQuantities, setIndividualQuantities] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const e of entries) {
      map[e.stack.item.id] = e.stack.count;
    }
    return map;
  });

  const samePrice = Math.round((parseFloat(samePriceInput) || 0) * 100);
  const sameFees = useMemo(() => samePrice > 0 ? calculateFromBuyerPrice(samePrice) : calculateFees(1), [samePrice]);

  const totalItems = entries.reduce((s, e) => s + e.stack.count, 0);

  const buildRequests = useCallback((): { assetId: string; priceInCents: number }[] => {
    const requests: { assetId: string; priceInCents: number }[] = [];
    for (const e of entries) {
      let cents: number;
      if (mode === 'same') {
        cents = sameFees.youReceive;
      } else {
        const input = Math.round((parseFloat(individualPrices[e.stack.item.id] || '0') || 0) * 100);
        const fees = input > 0 ? calculateFromBuyerPrice(input) : null;
        cents = fees ? fees.youReceive : 0;
      }
      if (cents <= 0) continue;
      const qty = mode === 'individual'
        ? Math.min(individualQuantities[e.stack.item.id] ?? e.stack.count, e.stack.count)
        : e.stack.count;
      for (const item of e.stack.allItems.slice(0, qty)) {
        requests.push({ assetId: item.id, priceInCents: cents });
      }
    }
    return requests;
  }, [entries, mode, sameFees, individualPrices, individualQuantities]);

  const requests = buildRequests();
  const isValid = requests.length > 0;

  const totalYouReceive = requests.reduce((s, r) => s + r.priceInCents, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-6 w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        <h2 className="text-base font-semibold text-slate-100 mb-1">Sell Selected Items</h2>
        <p className="text-xs text-slate-400 mb-4">
          {entries.length} stack{entries.length !== 1 ? 's' : ''} · {totalItems} item{totalItems !== 1 ? 's' : ''} total
        </p>

        {/* Mode toggle */}
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setMode('same')}
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
              mode === 'same' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            Same price for all
          </button>
          <button
            onClick={() => setMode('individual')}
            className={`flex-1 text-xs py-1.5 rounded-md transition-colors ${
              mode === 'individual' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            Individual prices
          </button>
        </div>

        {/* Same price mode */}
        {mode === 'same' && (
          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Buyer pays per item ({symbol})</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">{symbol}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={samePriceInput}
                  onChange={(e) => setSamePriceInput(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg pl-7 pr-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  autoFocus
                  placeholder="0.00"
                />
              </div>
            </div>
            {samePrice > 0 && (
              <>
                <FeeBreakdown fees={sameFees} symbol={symbol} />
                <div className="text-xs text-slate-400 flex justify-between border-t border-slate-600 pt-2">
                  <span>Total for {totalItems} items:</span>
                  <span className="text-green-400 font-medium">{symbol}{(sameFees.youReceive * totalItems / 100).toFixed(2)}</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Individual price mode */}
        {mode === 'individual' && (
          <div className="flex-1 overflow-y-auto space-y-2 mb-4 pr-1">
            {entries.map((e) => {
              const parsedName = parseMarketName(e.stack.item.market_name || 'Unknown Item');
              const inputVal = individualPrices[e.stack.item.id] || '';
              const parsed = Math.round((parseFloat(inputVal) || 0) * 100);
              const fees = parsed > 0 ? calculateFromBuyerPrice(parsed) : null;
              const qty = individualQuantities[e.stack.item.id] ?? e.stack.count;
              const perItemReceive = fees ? fees.youReceive : 0;
              return (
                <div key={e.stack.item.id} className="bg-slate-700/40 rounded-lg p-2 space-y-1.5">
                  <div className="flex items-center gap-3">
                    {e.stack.item.image_url && (
                      <img src={e.stack.item.image_url} alt="" className="w-10 h-8 object-contain rounded bg-slate-700/30" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`text-slate-200 truncate ${nameFontClass(parsedName.skinName || parsedName.weaponName, true)}`}>
                        {parsedName.skinName || parsedName.weaponName}
                      </p>
                      {parsedName.skinName && (
                        <p className="text-[10px] text-slate-500 truncate">{parsedName.weaponName}</p>
                      )}
                      {e.stack.count > 1 && <span className="text-[10px] text-slate-500">×{e.stack.count} available</span>}
                    </div>
                    <div className="relative w-28 shrink-0">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">{symbol}</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={inputVal}
                        onChange={(e2) => setIndividualPrices((prev) => ({ ...prev, [e.stack.item.id]: e2.target.value }))}
                        className="w-full bg-slate-700 border border-slate-600 rounded-md pl-5 pr-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                        placeholder="0.00"
                      />
                    </div>
                    {fees && (
                      <span className="text-[10px] text-green-400 w-16 text-right shrink-0">
                        get {symbol}{(perItemReceive / 100).toFixed(2)}
                      </span>
                    )}
                  </div>
                  {e.stack.count > 1 && (
                    <div className="flex items-center gap-2 pl-[52px]">
                      <label className="text-[10px] text-slate-500">Qty:</label>
                      <input
                        type="number"
                        min={1}
                        max={e.stack.count}
                        value={qty}
                        onChange={(e2) => {
                          const v = Math.min(e.stack.count, Math.max(1, parseInt(e2.target.value) || 1));
                          setIndividualQuantities((prev) => ({ ...prev, [e.stack.item.id]: v }));
                        }}
                        className="w-16 bg-slate-700 border border-slate-600 rounded-md px-2 py-1 text-[10px] text-slate-100 focus:outline-none focus:border-blue-500"
                      />
                      <span className="text-[10px] text-slate-500">of {e.stack.count}</span>
                      {qty < e.stack.count && (
                        <button
                          onClick={() => setIndividualQuantities((prev) => ({ ...prev, [e.stack.item.id]: e.stack.count }))}
                          className="text-[10px] text-blue-400 hover:text-blue-300"
                        >
                          All
                        </button>
                      )}
                      {fees && qty > 1 && (
                        <span className="text-[10px] text-green-400 ml-auto">
                          total: {symbol}{(perItemReceive * qty / 100).toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Summary */}
        {isValid && (
          <div className="text-xs text-slate-400 flex justify-between mb-4 px-1">
            <span>You receive total:</span>
            <span className="text-green-400 font-medium">{symbol}{(totalYouReceive / 100).toFixed(2)}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 text-sm text-slate-400 hover:text-slate-200 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => { if (isValid) onConfirm(requests); }}
            disabled={!isValid}
            className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              isValid ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            }`}
          >
            List {requests.length} item{requests.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Active listing card ----

/**
 * Listing card.
 *
 * Characteristics:
 * - @param {
 *   listing,
 *   symbol,
 *   onDelist,
 * } - The parameter for {
 *   listing,
 *   symbol,
 *   onDelist,
 * }
 * - @returns React.JSX.Element
 *
 */
function ListingCard({
  listing,
  symbol,
  onDelist,
}: {
  listing: MarketListing;
  symbol: string;
  onDelist: (listingId: string) => void;
}) {
  const parsedName = parseMarketName(listing.marketHashName || 'Unknown Item');
  const [delisting, setDelisting] = useState(false);

  // Only show trade hold if the expiry is genuinely in the future
  const hasTradeHold = listing.tradeHoldExpires != null && listing.tradeHoldExpires > Date.now();
  const tradeHoldDate = hasTradeHold
    ? new Date(listing.tradeHoldExpires!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;

  return (
    <div className="group flex items-center gap-3 bg-slate-800/60 border border-slate-700/50 rounded-lg p-3 hover:border-slate-600 transition-colors">
      {/* Image */}
      {listing.image_url ? (
        <img
          src={listing.image_url}
          alt={listing.marketHashName}
          className="w-16 h-12 object-contain rounded bg-slate-700/30 shrink-0"
        />
      ) : (
        <div className="w-16 h-12 rounded bg-slate-700/30 shrink-0 flex items-center justify-center">
          <svg className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91" />
          </svg>
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className={`text-slate-200 truncate font-medium ${nameFontClass(parsedName.skinName || parsedName.weaponName, false)}`}>
          {parsedName.skinName || parsedName.weaponName}
        </p>
        {parsedName.skinName && (
          <p className="text-xs text-slate-400 truncate">{parsedName.weaponName}</p>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            listing.status === 'active' ? 'bg-green-500/20 text-green-400' :
            listing.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-blue-500/20 text-blue-400'
          }`}>
            {listing.status === 'active' ? 'Active' : listing.status === 'pending' ? 'Pending Confirmation' : 'Sold'}
          </span>
          {hasTradeHold && (
            <span className="text-xs text-yellow-500">Hold until {tradeHoldDate}</span>
          )}
        </div>
      </div>

      {/* Price */}
      <div className="text-right shrink-0">
        <p className="text-sm font-medium text-slate-200">{symbol}{(listing.buyerPays / 100).toFixed(2)}</p>
        <p className="text-xs text-green-400">You get: {symbol}{(listing.youReceive / 100).toFixed(2)}</p>
      </div>

      {/* Delist button */}
      {listing.status === 'active' && (
        <button
          onClick={async () => {
            setDelisting(true);
            await onDelist(listing.listingId);
            setDelisting(false);
          }}
          disabled={delisting}
          className="shrink-0 p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
          title="Remove listing"
        >
          {delisting ? (
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}

// ---- Inventory item for listing (stack-aware) ----

/**
 * Listable item.
 *
 * Characteristics:
 * - @param {
 *   stack,
 *   price,
 *   symbol,
 *   selected,
 *   onSelect,
 *   onListClick,
 * } - The parameter for {
 *   stack,
 *   price,
 *   symbol,
 *   selected,
 *   onSelect,
 *   onListClick,
 * }
 * - @returns React.JSX.Element
 *
 */
function ListableItem({
  stack,
  price,
  symbol,
  selected,
  onSelect,
  onListClick,
}: {
  stack: MarketStack;
  price: number;
  symbol: string;
  selected: boolean;
  onSelect: () => void;
  onListClick: () => void;
}) {
  const item = stack.item;
  const parsedName = parseMarketName(item.market_name || 'Unknown');
  const tradeLockDate = getTradeHoldDate(item);

  return (
    <div
      className={`group relative flex flex-col bg-slate-800/60 border rounded-lg overflow-hidden transition-colors cursor-pointer ${
        selected
          ? 'border-blue-500 ring-1 ring-blue-500/50'
          : 'border-slate-700/50 hover:border-slate-600'
      }`}
      onClick={onSelect}
    >
      {/* Image */}
      <div className="relative w-full aspect-[16/10] bg-slate-700/30 flex items-center justify-center p-2">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.market_name || 'Item'}
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <svg className="w-8 h-8 text-slate-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.41a2.25 2.25 0 013.182 0l2.909 2.91" />
          </svg>
        )}

        {/* Trade hold icon with date */}
        {tradeLockDate && (
          <span
            className="absolute top-1 right-1 text-[9px] px-1 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 flex items-center gap-0.5"
            title={`Trade hold until ${tradeLockDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
          >
            🕐 {tradeLockDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}

        {/* Stack count badge */}
        {stack.count > 1 && (
          <span className="absolute bottom-1 right-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-600/90 text-white font-bold min-w-[20px] text-center">
            ×{stack.count}
          </span>
        )}

        {/* Selection indicator */}
        <span className={`absolute top-1 left-1 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
          selected ? 'bg-blue-600 border-blue-600' : 'border-slate-500/50 bg-slate-800/50'
        }`}>
          {selected && (
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          )}
        </span>
      </div>

      {/* Info */}
      <div className="p-2 flex-1 flex flex-col">
        <p className={`text-slate-200 truncate font-medium ${nameFontClass(parsedName.skinName || parsedName.weaponName, true)}`}>
          {parsedName.skinName || parsedName.weaponName}
        </p>
        {parsedName.skinName && (
          <p className="text-[10px] text-slate-500 truncate">{parsedName.weaponName}</p>
        )}
        {item.paint_wear != null && (
          <span className="text-[10px] text-slate-500">{getWearShort(item.paint_wear)} · {item.paint_wear.toFixed(4)}</span>
        )}
        {/* Storage unit source */}
        {stack.sourceUnitName && (
          <span className="text-[9px] text-cyan-400 truncate mt-0.5" title={`From: ${stack.sourceUnitName}`}>
            📦 {stack.sourceUnitName}
          </span>
        )}
        <div className="mt-auto pt-1 flex items-center justify-between">
          <span className="text-xs text-green-400 font-medium">
            {price > 0 ? `${symbol}${price.toFixed(2)}` : '\u2014'}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onListClick();
            }}
            className="text-[10px] px-2 py-0.5 rounded bg-green-600/20 text-green-400 hover:bg-green-600/40 transition-colors"
          >
            Sell{stack.count > 1 ? ` (${stack.count})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Main component ----

/**
 * Market page.
 *
 * Characteristics:
 * - @param { auth, onNavigate } - The parameter for { auth, onNavigate }
 * - @returns React.JSX.Element
 *
 */
export default function MarketPage({ auth, onNavigate }: Props) {
  const { status, logout } = auth;
  const { items, storageUnits } = useInventory();
  const { portfolioData, fetchPrices, pricingProgress } = usePricing();
  const { listings, progress, loading, fetchListings, listItem, listMultiple, delistItem, delistAll } = useMarket();
  const { symbol, formatPrice } = useContext(CurrencyContext);

  const [tab, setTab] = useState<MarketTab>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<MarketTypeFilter>('all');
  const [sortBy, setSortBy] = useState<'newest-first' | 'oldest-first' | 'name-asc' | 'name-desc' | 'qty-desc' | 'qty-asc'>('newest-first');
  const [minStackCount, setMinStackCount] = useState(1);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [listingStack, setListingStack] = useState<MarketStack | null>(null);
  const [selectedSellOpen, setSelectedSellOpen] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const pricesFetchedRef = useRef(false);

  const isGCConnected = status.state === 'gcConnected';

  // Fetch listings on mount
  useEffect(() => {
    if (isGCConnected) {
      fetchListings();
    }
  }, [isGCConnected, fetchListings]);

  // Auto-fetch prices when market page loads (if not already fetched)
  useEffect(() => {
    if (isGCConnected && items.length > 0 && !pricesFetchedRef.current) {
      // Check if we already have prices cached
      const hasCachedPrices = portfolioData?.itemPrices && Object.keys(portfolioData.itemPrices).length > 0;
      if (!hasCachedPrices) {
        pricesFetchedRef.current = true;
        fetchPrices();
      } else {
        pricesFetchedRef.current = true;
      }
    }
  }, [isGCConnected, items.length, portfolioData, fetchPrices]);

  // Auto-dismiss notification
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Build listable items: collect from inventory + storage units, filter, then stack
  const marketStacks = useMemo(() => {
    const entries: MarketEntry[] = [];

    // Items from main inventory (no storage unit source)
    for (const item of items) {
      if (!isItemMarketable(item)) continue;
      if (hasActiveTradeHold(item)) continue;
      entries.push({ item });
    }

    // Items from storage units — track the source
    for (const unit of storageUnits) {
      if (!unit.items?.length) continue;
      const unitName = unit.custom_name || 'Storage Unit';
      for (const item of unit.items) {
        if (!isItemMarketable(item)) continue;
        if (hasActiveTradeHold(item)) continue;
        entries.push({ item, sourceUnitId: unit.id, sourceUnitName: unitName });
      }
    }

    return stackMarketItems(entries);
  }, [items, storageUnits]);

  // Filter and sort stacks by search/type/quantity
  const filteredStacks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const filtered = marketStacks
      .filter((s) => {
        if (s.count < minStackCount) return false;
        if (typeFilter !== 'all' && getMarketItemType(s.item) !== typeFilter) return false;
        if (!q) return true;

        return (
          s.item.market_name?.toLowerCase().includes(q) ||
          s.item.weapon_type?.toLowerCase().includes(q) ||
          s.sourceUnitName?.toLowerCase().includes(q)
        );
      });

    const byName = (a: MarketStack, b: MarketStack) =>
      (a.item.market_name || '').localeCompare(b.item.market_name || '');
    const byQty = (a: MarketStack, b: MarketStack) => a.count - b.count;
    const byId = (a: MarketStack, b: MarketStack) => {
      try {
        const ai = BigInt(a.item.id || '0');
        const bi = BigInt(b.item.id || '0');
        if (ai === bi) return 0;
        return ai > bi ? 1 : -1;
      } catch {
        return (a.item.id || '').localeCompare(b.item.id || '');
      }
    };

    return [...filtered].sort((a, b) => {
      if (sortBy === 'newest-first') return byId(b, a);
      if (sortBy === 'oldest-first') return byId(a, b);
      if (sortBy === 'name-asc') return byName(a, b);
      if (sortBy === 'name-desc') return byName(b, a);
      if (sortBy === 'qty-desc') return byQty(b, a);
      return byQty(a, b);
    });
  }, [marketStacks, searchQuery, minStackCount, typeFilter, sortBy]);

  // Get item price from portfolio data
  const getItemPrice = useCallback((item: InventoryItem): number => {
    if (!portfolioData?.itemPrices) return 0;
    // Build market hash name
    let marketHashName = item.market_name || '';
    if (item.paint_wear != null && item.paint_wear > 0) {
      const wearFull = getWearFull(item.paint_wear);
      marketHashName = `${item.market_name} (${wearFull})`;
    }
    return portfolioData.itemPrices[marketHashName]?.currentPrice ?? 0;
  }, [portfolioData]);

  // Get price history for an item
  const getItemPriceHistory = useCallback((item: InventoryItem): PriceSnapshot[] => {
    if (!portfolioData?.itemPrices) return [];
    let marketHashName = item.market_name || '';
    if (item.paint_wear != null && item.paint_wear > 0) {
      const wearFull = getWearFull(item.paint_wear);
      marketHashName = `${item.market_name} (${wearFull})`;
    }
    return portfolioData.itemPrices[marketHashName]?.priceHistory ?? [];
  }, [portfolioData]);

  // Toggle item selection
  const toggleSelect = useCallback((id: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Handler for single-item listing confirmation
  const handleListConfirm = useCallback(async (priceInCents: number) => {
    if (!listingStack) return;
    const result = await listItem(listingStack.item.id, priceInCents);
    setListingStack(null);

    if (result.success) {
      setNotification({
        type: 'success',
        message: result.requiresConfirmation
          ? 'Listed! Confirm on Steam Mobile Authenticator.'
          : 'Item listed on the market!',
      });
    } else {
      setNotification({ type: 'error', message: result.error || 'Failed to list item' });
    }
  }, [listingStack, listItem]);

  // Handler for bulk listing confirmation
  const handleBulkListConfirm = useCallback(async (assetIds: string[], priceInCents: number) => {
    setListingStack(null);
    const requests = assetIds.map((id) => ({ assetId: id, priceInCents }));
    const result = await listMultiple(requests);

    if (result.succeeded > 0) {
      setNotification({
        type: result.failed > 0 ? 'error' : 'success',
        message: result.failed > 0
          ? `Listed ${result.succeeded}/${requests.length} items. ${result.failed} failed.`
          : `Successfully listed ${result.succeeded} item${result.succeeded !== 1 ? 's' : ''} on the market!`,
      });
    } else {
      setNotification({
        type: 'error',
        message: result.errors?.[0] || 'Failed to list items',
      });
    }
  }, [listMultiple]);

  // Handler for selected items sell confirmation
  const handleSelectedSellConfirm = useCallback(async (requests: { assetId: string; priceInCents: number }[]) => {
    setSelectedSellOpen(false);
    setSelectedItems(new Set());
    const result = await listMultiple(requests);

    if (result.succeeded > 0) {
      setNotification({
        type: result.failed > 0 ? 'error' : 'success',
        message: result.failed > 0
          ? `Listed ${result.succeeded}/${requests.length} items. ${result.failed} failed.`
          : `Successfully listed ${result.succeeded} item${result.succeeded !== 1 ? 's' : ''} on the market!`,
      });
    } else {
      setNotification({
        type: 'error',
        message: result.errors?.[0] || 'Failed to list items',
      });
    }
  }, [listMultiple]);

  // Build selected entries for the SelectedSellDialog
  const selectedEntries = useMemo((): SelectedItemEntry[] => {
    if (!selectedSellOpen || selectedItems.size === 0) return [];
    return filteredStacks
      .filter((s) => selectedItems.has(s.item.id))
      .map((stack) => {
        const price = getItemPrice(stack.item);
        return {
          stack,
          priceInput: price > 0 ? price.toFixed(2) : '',
        };
      });
  }, [selectedSellOpen, selectedItems, filteredStacks, getItemPrice]);

  // Total listing value
  const totalListingValue = useMemo(() => {
    return listings.reduce((sum, l) => sum + l.buyerPays, 0);
  }, [listings]);

  const activeListings = useMemo(() => listings.filter((l) => l.status === 'active'), [listings]);

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-slate-100">
      {/* Listing dialog — single item or bulk */}
      {listingStack && listingStack.count === 1 && (
        <ListingDialog
          item={listingStack.item}
          currentPrice={getItemPrice(listingStack.item)}
          priceHistory={getItemPriceHistory(listingStack.item)}
          symbol={symbol}
          onConfirm={handleListConfirm}
          onCancel={() => setListingStack(null)}
        />
      )}
      {listingStack && listingStack.count > 1 && (
        <BulkListingDialog
          stack={listingStack}
          currentPrice={getItemPrice(listingStack.item)}
          priceHistory={getItemPriceHistory(listingStack.item)}
          symbol={symbol}
          onConfirm={handleBulkListConfirm}
          onCancel={() => setListingStack(null)}
        />
      )}

      {/* Selected items sell dialog */}
      {selectedSellOpen && selectedEntries.length > 0 && (
        <SelectedSellDialog
          entries={selectedEntries}
          symbol={symbol}
          onConfirm={handleSelectedSellConfirm}
          onCancel={() => setSelectedSellOpen(false)}
        />
      )}

      {/* Notification toast */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-xl border backdrop-blur-sm ${
          notification.type === 'success'
            ? 'bg-green-500/20 border-green-500/30 text-green-400'
            : 'bg-red-500/20 border-red-500/30 text-red-400'
        }`}>
          <p className="text-sm">{notification.message}</p>
        </div>
      )}

      {/* Header */}
      <NavBar activePage="market" onNavigate={onNavigate} status={status} onLogout={logout} />

      {/* Content */}
      <main className="flex-1 flex flex-col min-h-0 p-4 gap-4">
        {/* Not connected */}
        {!isGCConnected && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4">
              <div className="w-20 h-20 mx-auto rounded-full bg-blue-500/20 flex items-center justify-center">
                <svg className="w-10 h-10 text-blue-400 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <p className="text-slate-400">Connecting to CS2 Game Coordinator...</p>
            </div>
          </div>
        )}

        {/* Connected — Market UI */}
        {isGCConnected && (
          <>
            {/* Sub-tabs + actions bar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-0.5">
                <button
                  onClick={() => setTab('list')}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    tab === 'list' ? 'bg-green-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  List Items
                </button>
                <button
                  onClick={() => { setTab('active'); fetchListings(); }}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    tab === 'active' ? 'bg-green-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Active Listings {listings.length > 0 && `(${listings.length})`}
                </button>
              </div>

              <div className="flex items-center gap-3">
                {/* Pricing progress */}
                {pricingProgress && pricingProgress.state === 'loading' && (
                  <div className="flex items-center gap-2 text-xs text-cyan-400">
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>Fetching prices{pricingProgress.current != null ? ` (${pricingProgress.current}/${pricingProgress.total})` : '...'}</span>
                  </div>
                )}

                {/* Fetch prices button */}
                {(!pricingProgress || pricingProgress.state !== 'loading') && (
                  <button
                    onClick={fetchPrices}
                    className="text-xs px-3 py-1.5 rounded-md bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
                    title="Refresh market prices for all items"
                  >
                    Refresh Prices
                  </button>
                )}

                {/* Market progress indicator */}
                {progress.state !== 'idle' && progress.state !== 'error' && (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>{progress.message}</span>
                    {progress.current != null && progress.total != null && (
                      <span>({progress.current}/{progress.total})</span>
                    )}
                  </div>
                )}

                {progress.state === 'error' && (
                  <span className="text-xs text-red-400">{progress.message}</span>
                )}
              </div>
            </div>

            {/* ---- List Items Tab ---- */}
            {tab === 'list' && (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Search + selection info */}
                <div className="flex items-center gap-3 mb-3">
                  <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                    </svg>
                    <input
                      type="text"
                      placeholder="Search inventory items..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value as MarketTypeFilter)}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
                    title="Filter by item type"
                  >
                    <option value="all">Type: All</option>
                    <option value="weapon">Type: Weapon</option>
                    <option value="tool">Type: Tool</option>
                    <option value="collectible">Type: Collectible</option>
                    <option value="music">Type: Music Kit</option>
                    <option value="other">Type: Other</option>
                  </select>

                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
                    title="Sort by"
                  >
                    <option value="newest-first">Newest First</option>
                    <option value="oldest-first">Oldest First</option>
                    <option value="name-asc">Name A-Z</option>
                    <option value="name-desc">Name Z-A</option>
                    <option value="qty-desc">Qty High-Low</option>
                    <option value="qty-asc">Qty Low-High</option>
                  </select>

                  <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5" title="Show stacks with at least this quantity">
                    <span className="text-[10px] text-slate-500 uppercase">Min Qty</span>
                    <input
                      type="number"
                      min={1}
                      value={minStackCount}
                      onChange={(e) => setMinStackCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-14 bg-transparent text-xs text-slate-200 focus:outline-none"
                    />
                  </div>

                  <span className="text-xs text-slate-500">
                    {filteredStacks.length} item{filteredStacks.length !== 1 ? 's' : ''}
                    {filteredStacks.reduce((s, st) => s + st.count, 0) !== filteredStacks.length && (
                      <> ({filteredStacks.reduce((s, st) => s + st.count, 0)} total)</>
                    )}
                  </span>

                  {selectedItems.size > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-blue-400">{selectedItems.size} selected</span>
                      <button
                        onClick={() => setSelectedSellOpen(true)}
                        className="text-xs px-3 py-1 rounded-md bg-green-600 text-white hover:bg-green-500 transition-colors font-medium"
                      >
                        Sell Selected
                      </button>
                      <button
                        onClick={() => setSelectedItems(new Set())}
                        className="text-xs text-slate-500 hover:text-slate-300"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>

                {/* Fee info banner */}
                <div className="mb-3 px-3 py-2 bg-slate-800/60 border border-slate-700/50 rounded-lg flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                  </svg>
                  <p className="text-xs text-slate-400">
                    Steam takes a <span className="text-slate-300">15% fee</span> on market sales (5% Steam + 10% CS2).
                    Items may also have a <span className="text-yellow-400">7-day trade hold</span> after purchase.
                  </p>
                </div>

                {/* Items grid */}
                <div className="flex-1 overflow-y-auto">
                  {filteredStacks.length === 0 ? (
                    <div className="flex items-center justify-center h-40">
                      <p className="text-slate-500 text-sm">
                        {searchQuery ? 'No items match your search' : 'No marketable items in inventory'}
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
                      {filteredStacks.map((stack) => (
                        <ListableItem
                          key={`${stack.item.id}:${stack.sourceUnitId || 'inv'}`}
                          stack={stack}
                          price={getItemPrice(stack.item)}
                          symbol={symbol}
                          selected={selectedItems.has(stack.item.id)}
                          onSelect={() => toggleSelect(stack.item.id)}
                          onListClick={() => setListingStack(stack)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ---- Active Listings Tab ---- */}
            {tab === 'active' && (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Summary bar */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-slate-400">
                      {activeListings.length} active listing{activeListings.length !== 1 ? 's' : ''}
                    </span>
                    {totalListingValue > 0 && (
                      <span className="text-sm text-slate-300">
                        Total: <span className="text-green-400 font-medium">{symbol}{(totalListingValue / 100).toFixed(2)}</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={fetchListings}
                      disabled={loading}
                      className="text-xs px-3 py-1.5 rounded-md bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors disabled:opacity-50"
                    >
                      {loading ? 'Loading...' : 'Refresh'}
                    </button>
                    {activeListings.length > 0 && (
                      <button
                        onClick={async () => {
                          if (confirm(`Remove all ${activeListings.length} active listings?`)) {
                            await delistAll();
                            setNotification({ type: 'success', message: 'All listings removed' });
                          }
                        }}
                        className="text-xs px-3 py-1.5 rounded-md bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
                      >
                        Remove All
                      </button>
                    )}
                  </div>
                </div>

                {/* Listings list */}
                <div className="flex-1 overflow-y-auto space-y-2">
                  {loading && listings.length === 0 ? (
                    <div className="flex items-center justify-center h-40">
                      <div className="text-center space-y-2">
                        <svg className="w-8 h-8 text-slate-500 animate-spin mx-auto" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <p className="text-slate-500 text-sm">Loading listings...</p>
                      </div>
                    </div>
                  ) : listings.length === 0 ? (
                    <div className="flex items-center justify-center h-40">
                      <div className="text-center space-y-2">
                        <svg className="w-12 h-12 text-slate-700 mx-auto" fill="none" viewBox="0 0 24 24" strokeWidth="1" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                        </svg>
                        <p className="text-slate-500 text-sm">No active listings</p>
                        <button
                          onClick={() => setTab('list')}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          List some items →
                        </button>
                      </div>
                    </div>
                  ) : (
                    listings.map((listing) => (
                      <ListingCard
                        key={listing.listingId}
                        listing={listing}
                        symbol={symbol}
                        onDelist={async (id) => {
                          const result = await delistItem(id);
                          if (result.success) {
                            setNotification({ type: 'success', message: 'Listing removed' });
                          } else {
                            setNotification({ type: 'error', message: result.error || 'Failed to remove' });
                          }
                        }}
                      />
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ---- Helpers ----

const WEAR_RANGES_FULL: [number, string][] = [
  [0.07, 'Factory New'],
  [0.15, 'Minimal Wear'],
  [0.38, 'Field-Tested'],
  [0.45, 'Well-Worn'],
  [1.00, 'Battle-Scarred'],
];

/**
 * Gets wear full.
 *
 * Characteristics:
 * - @param wear - The parameter for wear
 * - @returns string
 *
 */
function getWearFull(wear: number): string {
  for (const [threshold, name] of WEAR_RANGES_FULL) {
    if (wear < threshold || (threshold === 1.0 && wear <= threshold)) return name;
  }
  return 'Battle-Scarred';
}
