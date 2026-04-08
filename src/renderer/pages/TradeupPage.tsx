// ============================================================
// CSInventoryPorter — Trade-Up Contract Page
// Trade up 10 same-rarity skins into 1 higher-rarity skin
// ============================================================

import { useState, useMemo, useCallback, useContext } from 'react';
import type { useAuth } from '../hooks/useAuth';
import { useInventory } from '../hooks/useInventory';
import {
  useTradeup,
  isTradeupEligible,
  getRarityName,
  getRarityColor,
  getOutputRarity,
} from '../hooks/useTradeup';
import type { InventoryItem } from '../../shared/types';
import { RARITY_INFO } from '../../shared/cs2-item-data';
import { CurrencyContext } from '../App';
import NavBar from '../components/NavBar';
import { type AppPage } from '../utils/itemUtils';

interface Props {
  auth: ReturnType<typeof useAuth>;
  onNavigate: (page: AppPage) => void;
}

// ---- Rarity filter tabs ----
const RARITY_FILTERS = [
  { rarity: 0, label: 'All' },
  { rarity: 1, label: 'Consumer' },
  { rarity: 2, label: 'Industrial' },
  { rarity: 3, label: 'Mil-Spec' },
  { rarity: 4, label: 'Restricted' },
  { rarity: 5, label: 'Classified' },
] as const;

/**
 * Gets wear label.
 *
 * Characteristics:
 * - @param value - The parameter for value
 * - @returns string
 *
 */
function getWearLabel(value: number): string {
  if (value < 0.07) return 'Factory New';
  if (value < 0.15) return 'Minimal Wear';
  if (value < 0.38) return 'Field-Tested';
  if (value < 0.45) return 'Well-Worn';
  return 'Battle-Scarred';
}

// ---- Item card in the inventory grid ----

/**
 * Inventory item card.
 *
 * Characteristics:
 * - @param {
 *   item,
 *   onAdd,
 *   disabled,
 * } - The parameter for {
 *   item,
 *   onAdd,
 *   disabled,
 * }
 * - @returns React.JSX.Element
 *
 */
function InventoryItemCard({
  item,
  onAdd,
  disabled,
}: {
  item: InventoryItem;
  onAdd: () => void;
  disabled: boolean;
}) {
  const rarityColor = getRarityColor(item.rarity ?? 0);

  return (
    <button
      onClick={onAdd}
      disabled={disabled}
      className={`group relative flex flex-col items-center bg-slate-800/60 border rounded-lg p-2 transition-all ${disabled
          ? 'border-slate-700/50 opacity-40 cursor-not-allowed'
          : 'border-slate-700 hover:border-slate-500 hover:bg-slate-700/60 cursor-pointer'
        }`}
    >
      {/* Rarity accent bar */}
      <div
        className="absolute top-0 left-0 right-0 h-0.5 rounded-t-lg"
        style={{ backgroundColor: rarityColor }}
      />

      {/* Image */}
      <div className="w-full aspect-[4/3] flex items-center justify-center mb-1">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.market_name || ''}
            className="max-w-full max-h-full object-contain"
            loading="lazy"
          />
        ) : (
          <div className="w-10 h-10 bg-slate-700 rounded" />
        )}
      </div>

      {/* Name */}
      <p className="text-[11px] text-slate-300 text-center leading-tight line-clamp-2 w-full">
        {item.market_name || `Item #${item.defindex}`}
      </p>

      {/* Quality + Rarity badge */}
      <div className="flex items-center gap-1 mt-1">
        {(item.quality ?? 0) === 9 && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-orange-600/30 text-orange-300 font-medium">
            ST
          </span>
        )}
        {(item.quality ?? 0) === 12 && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-600/30 text-yellow-300 font-medium">
            SV
          </span>
        )}
        <span
          className="text-[9px] px-1 py-0.5 rounded font-medium"
          style={{ backgroundColor: `${rarityColor}25`, color: rarityColor }}
        >
          {getRarityName(item.rarity ?? 0)}
        </span>
      </div>

      {/* Wear if present */}
      {item.paint_wear != null && (
        <span className="text-[9px] text-slate-500 mt-0.5">
          {item.paint_wear.toFixed(4)}
        </span>
      )}

      {/* Hover add icon */}
      {!disabled && (
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/50 rounded-lg">
          <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
      )}
    </button>
  );
}

// ---- Selected slot ----

/**
 * Selection slot.
 *
 * Characteristics:
 * - @param {
 *   item,
 *   index,
 *   onRemove,
 * } - The parameter for {
 *   item,
 *   index,
 *   onRemove,
 * }
 * - @returns React.JSX.Element
 *
 */
function SelectionSlot({
  item,
  index,
  onRemove,
}: {
  item: InventoryItem | null;
  index: number;
  onRemove?: () => void;
}) {
  if (!item) {
    return (
      <div className="w-20 h-20 bg-slate-800/40 border border-dashed border-slate-700 rounded-lg flex items-center justify-center">
        <span className="text-[10px] text-slate-600">{index + 1}</span>
      </div>
    );
  }

  const rarityColor = getRarityColor(item.rarity ?? 0);

  return (
    <div
      className="relative w-20 h-20 bg-slate-800/60 border rounded-lg flex flex-col items-center justify-center p-1 group cursor-pointer"
      style={{ borderColor: `${rarityColor}60` }}
      onClick={onRemove}
    >
      {item.image_url ? (
        <img
          src={item.image_url}
          alt=""
          className="max-w-[90%] max-h-[55%] object-contain"
        />
      ) : (
        <div className="w-6 h-6 bg-slate-700 rounded" />
      )}
      <p className="text-[8px] text-slate-400 text-center leading-tight line-clamp-1 w-full mt-0.5">
        {item.market_name || 'Item'}
      </p>

      {/* Remove overlay */}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-red-900/40 rounded-lg">
        <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
    </div>
  );
}

// ---- Main component ----

/**
 * Tradeup page.
 *
 * Characteristics:
 * - @param { auth, onNavigate } - The parameter for { auth, onNavigate }
 * - @returns React.JSX.Element
 *
 */
export default function TradeupPage({ auth, onNavigate }: Props) {
  const inventory = useInventory();
  const tradeup = useTradeup();
  const { symbol, formatPrice } = useContext(CurrencyContext);

  const [rarityFilter, setRarityFilter] = useState(0); // 0 = all
  const [searchQuery, setSearchQuery] = useState('');

  // Get eligible items from inventory
  const eligibleItems = useMemo(() => {
    return inventory.items.filter(isTradeupEligible);
  }, [inventory.items]);

  // Apply filters
  const filteredItems = useMemo(() => {
    let items: InventoryItem[] = eligibleItems;

    // If user already selected items, only show items of the same rarity + quality
    if (tradeup.selectedItems.length > 0) {
      const targetRarity = tradeup.selectedRarity;
      const targetStatTrak = tradeup.isStatTrak;
      items = items.filter((i) => {
        if (i.rarity !== targetRarity) return false;
        if (targetStatTrak !== ((i.quality ?? 0) === 9)) return false;
        return true;
      });
    } else if (rarityFilter > 0) {
      items = items.filter((i) => i.rarity === rarityFilter);
    }

    // Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter((i) =>
        (i.market_name?.toLowerCase().includes(q))
      );
    }

    // Exclude already-selected items
    const selectedIds = new Set(tradeup.selectedItems.map((i) => i.id));
    items = items.filter((i) => !selectedIds.has(i.id));

    return items;
  }, [eligibleItems, rarityFilter, searchQuery, tradeup.selectedItems, tradeup.selectedRarity, tradeup.isStatTrak]);

  // Rarity counts for filter badges
  const rarityCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const item of eligibleItems) {
      counts[item.rarity ?? 0] = (counts[item.rarity ?? 0] || 0) + 1;
    }
    return counts;
  }, [eligibleItems]);

  const isExecuting = tradeup.progress.state === 'crafting';

  const displayedOutcomes = useMemo(() => {
    const outcomes = tradeup.prediction?.outcomes ?? [];
    if (outcomes.length === 0) return [] as Array<InventoryItem & { displayChance: number }>;

    const roundedPercentages = outcomes.map((o) => Math.round(o.chance * 10000) / 100);
    const roundedTotal = roundedPercentages.reduce((sum, p) => sum + p, 0);
    const correction = Math.round((100 - roundedTotal) * 100) / 100;

    if (Math.abs(correction) >= 0.01) {
      const targetIndex = roundedPercentages.reduce((bestIdx, value, idx, arr) => {
        return value >= arr[bestIdx] ? idx : bestIdx;
      }, 0);
      roundedPercentages[targetIndex] = Math.max(0, Math.round((roundedPercentages[targetIndex] + correction) * 100) / 100);
    }

    return outcomes.map((outcome, index) => ({
      ...outcome,
      displayChance: roundedPercentages[index],
    }));
  }, [tradeup.prediction]);

  const displayedOutcomeTotal = useMemo(() => {
    return displayedOutcomes.reduce((sum, o) => sum + o.displayChance, 0);
  }, [displayedOutcomes]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <NavBar activePage="tradeup" onNavigate={onNavigate} status={auth.status} onLogout={auth.logout} />

      {/* Main content: two-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Inventory browser */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-slate-700">
          {/* Toolbar: rarity filter + search */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700/50 bg-slate-800/30 shrink-0">
            <div className="flex items-center gap-1">
              {RARITY_FILTERS.map((rf) => {
                const isActive = tradeup.selectedItems.length > 0
                  ? rf.rarity === 0 // All filters disabled when items selected
                  : rarityFilter === rf.rarity;
                const count = rf.rarity === 0 ? eligibleItems.length : (rarityCounts[rf.rarity] || 0);
                const rarityColor = rf.rarity > 0 ? RARITY_INFO[rf.rarity]?.color : undefined;

                return (
                  <button
                    key={rf.rarity}
                    onClick={() => !tradeup.selectedItems.length && setRarityFilter(rf.rarity)}
                    disabled={tradeup.selectedItems.length > 0}
                    className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${isActive
                        ? 'bg-slate-600 text-white'
                        : tradeup.selectedItems.length > 0
                          ? 'text-slate-600 cursor-not-allowed'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                      }`}
                    style={isActive && rarityColor ? { backgroundColor: `${rarityColor}35`, color: rarityColor } : undefined}
                  >
                    {rf.label}
                    <span className="ml-1 text-[9px] opacity-60">{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex-1" />

            {/* Search */}
            <div className="relative">
              <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search items..."
                className="w-48 pl-7 pr-3 py-1 bg-slate-700/50 border border-slate-600/50 rounded text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
              />
            </div>
          </div>

          {/* Item grid */}
          <div className="flex-1 overflow-y-auto p-3">
            {filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500">
                <svg className="w-12 h-12 mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <p className="text-sm">No eligible items found</p>
                <p className="text-xs mt-1 text-slate-600">
                  {tradeup.selectedItems.length > 0
                    ? `Need items of the same rarity (${getRarityName(tradeup.selectedRarity ?? 0)})`
                    : 'Only weapon skins of Consumer through Classified rarity can be traded up'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
                {filteredItems.map((item) => (
                  <InventoryItemCard
                    key={item.id}
                    item={item}
                    onAdd={() => tradeup.addItem(item)}
                    disabled={tradeup.selectedItems.length >= 10 || isExecuting}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Trade-up panel */}
        <div className="w-80 flex flex-col bg-slate-800/20 shrink-0">
          {/* Panel header */}
          <div className="px-4 py-3 border-b border-slate-700/50">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Trade-Up Contract</h2>
              <span className="text-[11px] text-slate-500">
                {tradeup.selectedItems.length}/10 items
              </span>
            </div>
            {tradeup.selectedRarity != null && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-slate-500">Input:</span>
                <span
                  className="text-[10px] font-medium"
                  style={{ color: getRarityColor(tradeup.selectedRarity) }}
                >
                  {getRarityName(tradeup.selectedRarity)}
                </span>
                <svg className="w-3 h-3 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                <span className="text-[10px] text-slate-500">Output:</span>
                <span
                  className="text-[10px] font-medium"
                  style={{ color: getRarityColor(getOutputRarity(tradeup.selectedRarity)) }}
                >
                  {getRarityName(getOutputRarity(tradeup.selectedRarity))}
                </span>
                {tradeup.isStatTrak && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-orange-600/30 text-orange-300 font-medium">
                    StatTrak™
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Selection grid */}
          <div className="flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-5 gap-1.5 mb-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <SelectionSlot
                  key={i}
                  index={i}
                  item={tradeup.selectedItems[i] ?? null}
                  onRemove={
                    tradeup.selectedItems[i]
                      ? () => tradeup.removeItem(tradeup.selectedItems[i].id)
                      : undefined
                  }
                />
              ))}
            </div>

            {/* Output preview */}
            {tradeup.selectedRarity != null && (
              <div className="mb-4 p-3 rounded-lg bg-slate-800/60 border border-slate-700">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">You Will Receive</div>
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: getRarityColor(getOutputRarity(tradeup.selectedRarity)) }}
                  />
                  <span
                    className="text-sm font-medium"
                    style={{ color: getRarityColor(getOutputRarity(tradeup.selectedRarity)) }}
                  >
                    1× {getRarityName(getOutputRarity(tradeup.selectedRarity))}
                    {tradeup.isStatTrak ? ' StatTrak™' : ''} skin
                  </span>
                </div>
              </div>
            )}

            {/* Prediction panel */}
            {tradeup.selectedItems.length === 10 && (
              <div className="mb-4 p-3 rounded-lg bg-slate-800/60 border border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">Predicted Outcomes</div>
                  {tradeup.prediction && (
                    <span className="text-[10px] text-slate-500">
                      Avg Float {tradeup.prediction.averageInputFloat.toFixed(4)}
                    </span>
                  )}
                </div>

                {tradeup.predictionLoading ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Calculating...
                  </div>
                ) : tradeup.prediction && displayedOutcomes.length > 0 ? (
                  <>
                    {(tradeup.prediction.unknownCollectionInputs > 0 || tradeup.prediction.unknownFloatInputs > 0) && (
                      <p className="text-[10px] text-amber-300/90 mb-2">
                        Data warning: {tradeup.prediction.unknownCollectionInputs} unknown collection input(s), {tradeup.prediction.unknownFloatInputs} incomplete float input(s).
                      </p>
                    )}

                    <p className="text-[10px] text-slate-500 mb-2">Total chance: {displayedOutcomeTotal.toFixed(2)}%</p>

                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {displayedOutcomes.map((outcome) => (
                        <div key={`${outcome.defindex}:${outcome.paintIndex}`} className="flex items-center gap-2 rounded bg-slate-900/35 border border-slate-700/50 px-2 py-1.5">
                          {outcome.imageUrl ? (
                            <img src={outcome.imageUrl} alt="" className="w-8 h-6 object-contain shrink-0" loading="lazy" />
                          ) : (
                            <div className="w-8 h-6 bg-slate-700 rounded shrink-0" />
                          )}

                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] text-slate-200 truncate">{outcome.name}</p>
                            <p className="text-[10px] text-slate-500 truncate">{outcome.collectionName || outcome.collectionId}</p>
                          </div>

                          <div className="text-right shrink-0">
                            <p className="text-[11px] text-emerald-300 font-semibold">{outcome.displayChance.toFixed(2)}%</p>
                            <p className="text-[10px] text-slate-400">{outcome.predictedFloat.toFixed(4)} {getWearLabel(outcome.predictedFloat)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-slate-500">No predicted outputs available for this exact contract.</p>
                )}
              </div>
            )}

            {/* Progress indicator */}
            {tradeup.progress.state !== 'idle' && (
              <div className={`mb-4 p-3 rounded-lg border ${tradeup.progress.state === 'crafting'
                  ? 'bg-blue-600/10 border-blue-500/30'
                  : tradeup.progress.state === 'completed'
                    ? 'bg-green-600/10 border-green-500/30'
                    : 'bg-red-600/10 border-red-500/30'
                }`}>
                <div className="flex items-center gap-2">
                  {tradeup.progress.state === 'crafting' && (
                    <svg className="w-4 h-4 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {tradeup.progress.state === 'completed' && (
                    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {tradeup.progress.state === 'error' && (
                    <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                  <span className={`text-xs ${tradeup.progress.state === 'crafting' ? 'text-blue-300' :
                      tradeup.progress.state === 'completed' ? 'text-green-300' : 'text-red-300'
                    }`}>
                    {tradeup.progress.message || (
                      tradeup.progress.state === 'crafting' ? 'Executing trade-up...' :
                        tradeup.progress.state === 'completed' ? 'Trade-up complete!' : 'Trade-up failed'
                    )}
                  </span>
                </div>
              </div>
            )}

            {/* Result notification */}
            {tradeup.result && (
              <div className={`mb-4 p-3 rounded-lg border ${tradeup.result.success
                  ? 'bg-green-600/10 border-green-500/30'
                  : 'bg-red-600/10 border-red-500/30'
                }`}>
                <div className="flex items-center gap-2">
                  {tradeup.result.success ? (
                    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                  <span className={`text-xs ${tradeup.result.success ? 'text-green-300' : 'text-red-300'}`}>
                    {tradeup.result.success
                      ? `Trade-up successful! Received ${tradeup.result.receivedItemIds?.length ?? 1} item(s)`
                      : `Failed: ${tradeup.result.error || 'Unknown error'}`
                    }
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="px-4 py-3 border-t border-slate-700/50 space-y-2 shrink-0">
            {tradeup.validationError && (
              <p className="text-[11px] text-slate-500 text-center">{tradeup.validationError}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={tradeup.clearSelection}
                disabled={tradeup.selectedItems.length === 0 || isExecuting}
                className="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-slate-700/50 border border-slate-600/50 text-slate-300 hover:bg-slate-600/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Clear
              </button>
              <button
                onClick={tradeup.executeTradeup}
                disabled={tradeup.selectedItems.length !== 10 || isExecuting}
                className="flex-[2] px-3 py-2 text-sm font-bold rounded-lg bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-500 hover:to-emerald-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:from-green-600 disabled:hover:to-emerald-600 shadow-lg shadow-green-900/30"
              >
                {isExecuting ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Trading Up...
                  </span>
                ) : (
                  'Trade Up'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
