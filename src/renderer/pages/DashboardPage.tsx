// ============================================================
// CSInventoryPorter — Dashboard Page
// Shows inventory, storage units, and account info
// ============================================================

import { useState, useMemo, useCallback, memo, useContext, useEffect } from 'react';
import type { useAuth } from '../hooks/useAuth';
import { useInventory } from '../hooks/useInventory';
import { usePricing } from '../hooks/usePricing';
import { useMarket } from '../hooks/useMarket';
import type { InventoryItem, StorageUnit, CasketOperation, SkinportPriceData } from '../../shared/types';
import { CurrencyContext } from '../App';
import NavBar from '../components/NavBar';
import type { AppPage } from '../utils/itemUtils';
import { parseMarketName, nameFontClass } from '../utils/itemUtils';

interface Props {
  auth: ReturnType<typeof useAuth>;
  onNavigate: (page: AppPage) => void;
}

// ---- Stacking helpers ----

interface StackedItem {
  item: InventoryItem;    // Representative item (first in group)
  count: number;          // Number of identical items
  allItems: InventoryItem[];
}

/** Group items into stacks. Items without paint_wear (cases, stickers, etc.) stack by defindex:paintIndex. */
function stackItems(items: InventoryItem[]): StackedItem[] {
  const groups = new Map<string, InventoryItem[]>();

  for (const item of items) {
    // Skins (with paint_wear) are always unique — don't stack
    // Storage units are always unique (each has different contents/name)
    // Items with custom_name are unique (name tags make them distinct)
    let key: string;
    if (item.paint_wear != null || item.is_storage_unit || item.custom_name) {
      key = `unique:${item.id}`;
    } else if (item.market_name) {
      // Use resolved market_name for stacking — this differentiates stickers,
      // graffiti, patches, etc. that share the same defindex but are different items
      key = `name:${item.market_name}`;
    } else {
      key = `${item.defindex}:${item.paint_index ?? 'none'}`;
    }

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  return Array.from(groups.values()).map((group) => ({
    item: group[0],
    count: group.length,
    allItems: group,
  }));
}

// ---- Wear thresholds for market hash name ----

const WEAR_RANGES: [number, string][] = [
  [0.07, 'Factory New'],
  [0.15, 'Minimal Wear'],
  [0.38, 'Field-Tested'],
  [0.45, 'Well-Worn'],
  [1.00, 'Battle-Scarred'],
];

/**
 * Gets wear condition.
 *
 * Characteristics:
 * - @param wear - The parameter for wear
 * - @returns string
 *
 */
function getWearCondition(wear: number): string {
  for (const [threshold, name] of WEAR_RANGES) {
    if (wear < threshold || (threshold === 1.0 && wear <= threshold)) return name;
  }
  return 'Battle-Scarred';
}

/**
 * Gets market hash name.
 *
 * Characteristics:
 * - @param item - The parameter for item
 * - @returns string
 *
 */
function getMarketHashName(item: InventoryItem): string | null {
  if (!item.market_name) return null;
  if (item.is_storage_unit) return null;
  if (item.defindex === 1349) return null; // Open (used) graffiti — not marketable
  if (item.weapon_type === 'Pass') return null;
  if (item.paint_wear != null && item.paint_wear > 0) {
    return `${item.market_name} (${getWearCondition(item.paint_wear)})`;
  }
  return item.market_name;
}

// ---- Storage unit movability check ----

/** Weapon types that require a skin — without one they cannot go into a storage unit */
const GUN_TYPES = new Set(['Pistol', 'Rifle', 'SMG', 'Shotgun', 'Machinegun', 'Sniper Rifle']);

/**
 * Returns false for items the CS2 GC won't accept in a storage unit.
 * Uses marketable as the primary signal, with explicit fallbacks for cases
 * where the marketable flag may not have been set correctly.
 */
function canMoveToStorage(item: InventoryItem): boolean {
  if (item.is_storage_unit) return false;

  // Primary gate: marketable === false means Steam (or heuristics) determined this
  // item cannot be traded/marketed — most such items also cannot be stored.
  if (item.marketable === false) {
    // Exception: items blocked only by a temporary 7-day trade cooldown can still
    // be deposited into CS2 storage units.
    const isOnlyTradeLocked = !!(item.tradable_after && item.tradable_after > new Date());
    if (!isOnlyTradeLocked) return false;
  }

  if (item.weapon_type === 'Collectible') return false;
  if (item.weapon_type === 'Pass' && item.market_name === 'Bonus Rank') return false;

  // Fallback name-based check for collectible-like items that may have slipped through
  // We use \b to ensure we don't accidentally block skins in other languages like "Alpina" by matching "pin"
  if (/\b(medal|coin|pin|trophy|service)\b/i.test(item.market_name || '') && item.weapon_type !== 'Container') {
    return false;
  }

  return true;
}

type ItemTypeFilter = 'all' | 'weapon' | 'tool' | 'collectible' | 'container' | 'music' | 'other';

/**
 * Gets item type for filter.
 *
 * Characteristics:
 * - @param item - The parameter for item
 * - @returns "weapon" | "tool" | "collectible" | "container" | "music" | "other"
 *
 */
function getItemTypeForFilter(item: InventoryItem): Exclude<ItemTypeFilter, 'all'> {
  if (item.is_storage_unit) return 'container';

  const wt = (item.weapon_type || '').toLowerCase();
  const name = (item.market_name || '').toLowerCase();

  if (wt === 'collectible' || /(medal|coin|pin|trophy|service)/.test(name)) return 'collectible';
  if (wt === 'music kit' || item.defindex === 1314) return 'music';
  if (wt === 'tool' || wt === 'equipment' || wt === 'key') return 'tool';
  if (GUN_TYPES.has(item.weapon_type || '') || wt === 'knife' || wt === 'gloves' || (item.market_name || '').includes('|')) return 'weapon';

  return 'other';
}

// ---- Speed presets for bulk operations ----

const SPEED_DELAYS = { normal: 500, fast: 100, turbo: 25 } as const;
type OperationSpeed = keyof typeof SPEED_DELAYS;

// ---- Item Card Component (memoized for perf) ----

const ItemCard = memo(function ItemCard({
  item, compact, stackCount, selected, onSelect, steamPrice, skinportData, currencySymbol, isListed, canSelect,
}: {
  item: InventoryItem;
  compact?: boolean;
  stackCount?: number;
  selected?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  /** Raw Steam currentPrice — may be -1 (not listed on Steam) */
  steamPrice?: number;
  skinportData?: SkinportPriceData;
  currencySymbol?: string;
  isListed?: boolean;
  /** Whether this item can be selected for storage unit move (false = cursor-not-allowed) */
  canSelect?: boolean;
}) {
  // For storage units, prefer custom_name as the display name
  const displayName = item.is_storage_unit
    ? (item.custom_name || item.market_name || 'Storage Unit')
    : (item.market_name || `Item #${item.defindex}`);
  const parsedName = parseMarketName(displayName);
  const titleName = parsedName.skinName || parsedName.weaponName;
  const subtitleName = parsedName.skinName ? parsedName.weaponName : null;
  const wearAbbr = item.paint_wear ? getWearAbbr(item.paint_wear) : null;
  const [imgError, setImgError] = useState(false);
  const sym = currencySymbol || '€';

  // Derived price values
  const notOnSteam = steamPrice === -1;
  const effectiveSteamPrice = notOnSteam ? null : (steamPrice != null && steamPrice > 0 ? steamPrice : null);
  const skinportPrice = skinportData?.minPrice ?? null;
  // For the stack badge, use Steam price if available, else Skinport
  const unitPrice = effectiveSteamPrice ?? skinportPrice ?? undefined;
  const totalPrice = unitPrice != null && stackCount ? unitPrice * stackCount : undefined;

  return (
    <div
      className={`bg-slate-700/50 hover:bg-slate-700 border rounded-lg transition-colors group relative ${compact ? 'p-2' : 'p-3'
        } ${selected ? 'ring-2 ring-blue-500 border-blue-500/50' : 'border-slate-600/50'} ${onSelect ? (canSelect === false ? 'cursor-not-allowed opacity-60' : 'cursor-pointer') : ''
        }`}
      title={item.custom_name ? `"${item.custom_name}" — ${displayName}` : displayName}
      onClick={onSelect}
    >
      {/* Selection checkmark */}
      {selected && (
        <div className="absolute top-1.5 left-1.5 w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center z-10">
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}

      {/* Rarity stripe */}
      {item.rarity_color && (
        <div
          className="absolute bottom-0 left-0 right-0 h-0.5 rounded-b-lg"
          style={{ backgroundColor: item.rarity_color }}
        />
      )}

      {/* ON SALE badge */}
      {isListed && (
        <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-0.5 bg-blue-600/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
          ON SALE
        </div>
      )}

      {/* Stack count badge + per-unit price for stacks */}
      {stackCount && stackCount > 1 && (
        <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-0.5 z-10">
          <div className="bg-slate-900/80 text-slate-200 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            x{stackCount}
          </div>
          {unitPrice != null && unitPrice > 0 && (
            <div className="bg-slate-900/80 text-green-400 text-[9px] font-medium px-1.5 py-0.5 rounded-full">
              {sym}{unitPrice.toFixed(2)}/ea
            </div>
          )}
        </div>
      )}

      {/* Item image */}
      <div className={`flex items-center justify-center bg-slate-800/50 rounded-md mb-2 overflow-hidden ${compact ? 'h-14' : 'h-20'}`}>
        {item.image_url && !imgError ? (
          <img
            src={item.image_url}
            alt={displayName}
            className="max-h-full max-w-full object-contain"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : item.is_storage_unit ? (
          <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        ) : item.weapon_type === 'Pass' ? (
          <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        ) : (
          <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        )}
      </div>

      {/* Item name */}
      <p className={`font-medium truncate ${nameFontClass(titleName, compact)}`}>
        {titleName}
      </p>
      {subtitleName && (
        <p className={`truncate text-slate-400 ${compact ? 'text-[10px]' : 'text-xs'}`}>
          {subtitleName}
        </p>
      )}

      {/* Custom name tag (if present, shown below market name — skip for storage units since custom_name is primary) */}
      {item.custom_name && !item.is_storage_unit && (
        <p className={`truncate text-slate-400 italic ${compact ? 'text-[10px]' : 'text-xs'}`}>
          &ldquo;{item.custom_name}&rdquo;
        </p>
      )}

      {/* Price display — Steam + Skinport */}
      {(effectiveSteamPrice != null || skinportPrice != null || notOnSteam) && (
        <div className={`mt-1 space-y-0.5 ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
          {/* Steam price row */}
          <div className="flex items-center gap-1">
            {/* Steam icon */}
            <svg className="w-2.5 h-2.5 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.607 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.662 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z" />
            </svg>
            {notOnSteam ? (
              <span className="text-amber-400 font-medium">Not on Steam</span>
            ) : effectiveSteamPrice != null ? (
              <span className="text-green-400 font-semibold">
                {sym}{((stackCount && stackCount > 1) ? effectiveSteamPrice * stackCount : effectiveSteamPrice).toFixed(2)}
              </span>
            ) : (
              <span className="text-slate-500">—</span>
            )}
          </div>
          {/* Skinport price row */}
          {skinportPrice != null && (
            <div className="flex items-center gap-1">
              {/* Skinport icon: simple "S" badge */}
              <span className="w-2.5 h-2.5 shrink-0 flex items-center justify-center rounded-sm bg-orange-500/80 text-white font-bold leading-none" style={{ fontSize: '7px' }}>S</span>
              <span className="text-orange-300 font-semibold">
                {sym}{((stackCount && stackCount > 1) ? skinportPrice * stackCount : skinportPrice).toFixed(2)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Wear + sticker badges */}
      <div className="flex items-center gap-1 mt-1 flex-wrap">
        {wearAbbr && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-600 text-slate-300">
            {wearAbbr}
          </span>
        )}
        {item.kill_eater_value !== undefined && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400">
            ST
          </span>
        )}
        {item.stickers && item.stickers.length > 0 && item.stickers.map((s, i) =>
          s.image_url ? (
            <img
              key={i}
              src={s.image_url}
              alt={s.name || ''}
              title={s.name || `Sticker #${s.sticker_id}`}
              className={`object-contain rounded ${compact ? 'w-5 h-5' : 'w-6 h-6'}`}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <span
              key={i}
              className="text-[9px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-400"
              title={s.name || `Sticker #${s.sticker_id}`}
            >S</span>
          )
        )}
        {item.charms && item.charms.length > 0 && item.charms.map((c, i) =>
          c.image_url ? (
            <img
              key={`charm-${i}`}
              src={c.image_url}
              alt={c.name || ''}
              title={c.name || `Charm #${c.charm_id}`}
              className={`object-contain rounded ${compact ? 'w-5 h-5' : 'w-6 h-6'}`}
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <span
              key={`charm-${i}`}
              className="text-[9px] px-1 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300"
              title={c.name || `Charm #${c.charm_id}`}
            >C</span>
          )
        )}
        {item.is_storage_unit && item.casket_contained_item_count !== undefined && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
            {item.casket_contained_item_count}/1000
          </span>
        )}
      </div>
    </div>
  );
});

// ---- Storage Unit Card Component (compact grid card) ----

/**
 * Storage unit card.
 *
 * Characteristics:
 * - @param {
 *   unit,
 *   isChecked,
 *   onToggleCheck,
 *   onOpen,
 *   onLoad,
 *   onStartRename,
 * } - The parameter for {
 *   unit,
 *   isChecked,
 *   onToggleCheck,
 *   onOpen,
 *   onLoad,
 *   onStartRename,
 * }
 * - @returns React.JSX.Element
 *
 */
function StorageUnitCard({
  unit,
  isChecked,
  onToggleCheck,
  onOpen,
  onLoad,
  onStartRename,
}: {
  unit: StorageUnit;
  isChecked: boolean;
  onToggleCheck: () => void;
  onOpen: () => void;
  onLoad: () => void;
  onStartRename: () => void;
}) {
  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!unit.isLoaded && !unit.isLoading) {
      onLoad();
    }
    onToggleCheck();
  };

  const pct = Math.min(100, (unit.item_count / 1000) * 100);
  const barColor = unit.item_count >= 900 ? 'bg-red-400' : unit.item_count >= 500 ? 'bg-yellow-400' : 'bg-green-400';

  return (
    <div
      className="bg-slate-800/50 border border-slate-700 rounded-lg p-2.5 w-[140px] h-[120px] flex flex-col justify-between hover:bg-slate-700/30 transition-colors cursor-pointer relative group"
      onClick={onOpen}
    >
      {/* Top row: checkbox + loaded badge */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleCheckboxClick}
          className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${isChecked ? 'bg-blue-600 border-blue-600' : 'border-slate-500 hover:border-slate-400'
            } ${unit.isLoading ? 'opacity-50' : ''}`}
          title={isChecked ? 'Hide items from All Items' : 'Show items in All Items'}
        >
          {unit.isLoading ? (
            <svg className="animate-spin w-2.5 h-2.5 text-white" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : isChecked ? (
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          ) : null}
        </button>
        <div className="flex items-center gap-1">
          {unit.isLoaded && (
            <span className="text-[9px] text-green-400 font-medium">✓</span>
          )}
          {/* Rename button (visible on hover) */}
          <button
            onClick={(e) => { e.stopPropagation(); onStartRename(); }}
            className="p-0.5 text-slate-600 group-hover:text-slate-400 hover:!text-slate-200 transition-colors"
            title="Rename"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Center: icon + name */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-0 gap-1 py-1">
        <svg className="w-5 h-5 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
        <p className="text-[10px] font-medium text-center leading-tight truncate w-full px-0.5" title={unit.custom_name || `Storage Unit #${unit.id}`}>
          {unit.custom_name || `Unit #${unit.id.slice(-4)}`}
        </p>
      </div>

      {/* Bottom: item count + capacity bar */}
      <div className="space-y-1">
        <p className="text-[9px] text-slate-400 text-center">{unit.item_count}/1000</p>
        <div className="w-full h-1 bg-slate-600 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

// ---- Wear abbreviation helper ----

/**
 * Gets wear abbr.
 *
 * Characteristics:
 * - @param wear - The parameter for wear
 * - @returns string
 *
 */
function getWearAbbr(wear: number): string {
  if (wear < 0.07) return 'FN';
  if (wear < 0.15) return 'MW';
  if (wear < 0.38) return 'FT';
  if (wear < 0.45) return 'WW';
  return 'BS';
}

// ---- Main Dashboard ----

/**
 * Dashboard page.
 *
 * Characteristics:
 * - @param { auth, onNavigate } - The parameter for { auth, onNavigate }
 * - @returns React.JSX.Element
 *
 */
export default function DashboardPage({ auth, onNavigate }: Props) {
  const { status, logout } = auth;
  const inventory = useInventory();
  const { portfolioData, pricingProgress, fetchPrices, cancelFetch, loadPortfolioData } = usePricing();
  const { listings, fetchListings } = useMarket();
  const { symbol: currencySymbol } = useContext(CurrencyContext);

  // Load current market listings on mount so ON SALE badges appear immediately
  useEffect(() => { fetchListings(); }, []);

  const listedAssetIds = useMemo(
    () => new Set(listings.map(l => l.assetId).filter(Boolean)),
    [listings],
  );

  // Load cached portfolio data on mount so prices are available
  useState(() => { loadPortfolioData(); });

  const isFetchingPrices = pricingProgress?.state === 'loading';

  const [searchQuery, setSearchQuery] = useState('');
  const [itemTypeFilter, setItemTypeFilter] = useState<ItemTypeFilter>('all');
  const [sortBy, setSortBy] = useState<'newest-first' | 'oldest-first' | 'name-asc' | 'name-desc' | 'qty-desc' | 'qty-asc'>('newest-first');
  const [minStackCount, setMinStackCount] = useState(1);
  // 'all' = inventory items + checked container items, 'container' = single container tab
  const [viewMode, setViewMode] = useState<'all' | 'container'>('all');
  // Which container is open in the dedicated tab
  const [openContainerId, setOpenContainerId] = useState<string | null>(null);
  // Set of container IDs whose items are merged into "All Items"
  const [checkedContainers, setCheckedContainers] = useState<Set<string>>(new Set());
  // Selected item IDs for bulk operations
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // "Move to" storage unit dialog
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  // Storage unit rename modal
  const [renamingUnit, setRenamingUnit] = useState<StorageUnit | null>(null);
  const [renameInput, setRenameInput] = useState('');
  // Speed control for bulk operations
  const [operationSpeed, setOperationSpeed] = useState<OperationSpeed>('normal');
  // Quantity picker for stacked items
  const [quantityPicker, setQuantityPicker] = useState<{
    allItems: InventoryItem[];
    count: number;
    quantity: number;
    x: number;
    y: number;
  } | null>(null);

  // Resolve the currently-open container (for dedicated tab)
  const openContainer = useMemo(
    () => (openContainerId ? inventory.storageUnits.find((u) => u.id === openContainerId) : null),
    [openContainerId, inventory.storageUnits],
  );

  // Check if a bulk operation is in progress
  const isOperating = inventory.operationProgress?.state === 'running';

  // Toggle a container's checkbox
  const toggleContainerCheck = useCallback((unitId: string) => {
    setCheckedContainers((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) {
        next.delete(unitId);
      } else {
        next.add(unitId);
      }
      return next;
    });
  }, []);

  // Open a container in its own dedicated tab
  const openContainerTab = useCallback((unitId: string) => {
    setOpenContainerId(unitId);
    setViewMode('container');
    setSelectedIds(new Set()); // Clear selection when switching views
    // Auto-load if not loaded
    const unit = inventory.storageUnits.find((u) => u.id === unitId);
    if (unit && !unit.isLoaded && !unit.isLoading) {
      inventory.loadCasketContents(unitId).catch(console.error);
    }
  }, [inventory]);

  // Toggle selection for all items in a stack
  const toggleSelection = useCallback((itemIds: string[]) => {
    if (isOperating) return; // Disable selection during operations
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = itemIds.every((id) => next.has(id));
      if (allSelected) {
        itemIds.forEach((id) => next.delete(id));
      } else {
        itemIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [isOperating]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Handle click on a stacked item — shows quantity picker for stacks > 1
  const handleStackClick = useCallback((stack: StackedItem, e: React.MouseEvent) => {
    if (isOperating) return;
    // In container view, allow selecting any non-listed item so remove-to-inventory works.
    // In all-items view, enforce move-to-storage constraints.
    const selectableItems = viewMode === 'container'
      ? stack.allItems.filter((i) => !listedAssetIds.has(i.id))
      : stack.allItems.filter((i) => !listedAssetIds.has(i.id) && canMoveToStorage(i));

    if (selectableItems.length === 0) return;
    if (selectableItems.length <= 1 || stack.count <= 1) {
      toggleSelection(selectableItems.map((i) => i.id));
      return;
    }
    // If any selectable items in this stack are already selected, deselect all
    const anySelected = selectableItems.some((i) => selectedIds.has(i.id));
    if (anySelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        selectableItems.forEach((i) => next.delete(i.id));
        return next;
      });
      return;
    }
    // Show quantity picker for selectable items only
    setQuantityPicker({
      allItems: selectableItems,
      count: selectableItems.length,
      quantity: selectableItems.length,
      x: Math.min(e.clientX, window.innerWidth - 200),
      y: Math.max(e.clientY - 100, 10),
    });
  }, [isOperating, selectedIds, listedAssetIds, toggleSelection, viewMode]);

  // Confirm quantity from picker
  const confirmQuantitySelection = useCallback(() => {
    if (!quantityPicker) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < quantityPicker.quantity && i < quantityPicker.allItems.length; i++) {
        next.add(quantityPicker.allItems[i].id);
      }
      return next;
    });
    setQuantityPicker(null);
  }, [quantityPicker]);

  // Move selected items to a storage unit (from inventory OR from another unit)
  const moveItemsToUnit = useCallback(async (targetUnitId: string) => {
    const delay = SPEED_DELAYS[operationSpeed];
    let ops: CasketOperation[];

    if (viewMode === 'container' && openContainerId) {
      // Unit-to-unit: interleave remove from source, then add to target
      ops = Array.from(selectedIds).flatMap((itemId) => [
        { type: 'remove' as const, casketId: openContainerId, itemId },
        { type: 'add' as const, casketId: targetUnitId, itemId },
      ]);
    } else {
      // Inventory → unit: just add
      ops = Array.from(selectedIds).map((itemId) => ({
        type: 'add' as const,
        casketId: targetUnitId,
        itemId,
      }));
    }

    const itemsCount = selectedIds.size;
    setShowMoveDialog(false);
    clearSelection();
    try {
      await inventory.executeBulkOperation(ops, delay, itemsCount);
    } catch (err) {
      console.error('Bulk operation failed:', err);
    }
  }, [selectedIds, inventory, clearSelection, viewMode, openContainerId, operationSpeed]);

  // Remove selected items from current container back to inventory
  const removeItemsFromUnit = useCallback(async () => {
    if (!openContainerId) return;
    const delay = SPEED_DELAYS[operationSpeed];
    const ops: CasketOperation[] = Array.from(selectedIds).map((itemId) => ({
      type: 'remove' as const,
      casketId: openContainerId,
      itemId,
    }));
    clearSelection();
    try {
      await inventory.executeBulkOperation(ops, delay);
    } catch (err) {
      console.error('Bulk operation failed:', err);
    }
  }, [selectedIds, openContainerId, inventory, clearSelection, operationSpeed]);

  // Items to display in the main grid
  const displayItems = useMemo(() => {
    let items: InventoryItem[];

    if (viewMode === 'container' && openContainer?.isLoaded) {
      items = openContainer.items;
    } else {
      // Inventory items (exclude casket contents) + items from checked containers
      items = inventory.items.filter((item) => !item.casket_id);

      // Merge items from checked containers
      for (const unitId of checkedContainers) {
        const unit = inventory.storageUnits.find((u) => u.id === unitId);
        if (unit?.isLoaded && unit.items.length > 0) {
          items = [...items, ...unit.items];
        }
      }
    }

    // Apply search filter
    if (itemTypeFilter !== 'all') {
      items = items.filter((item) => getItemTypeForFilter(item) === itemTypeFilter);
    }

    // Apply search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter((item) => {
        const name = (item.market_name || item.custom_name || '').toLowerCase();
        return name.includes(q) || String(item.defindex).includes(q);
      });
    }

    return items;
  }, [inventory.items, inventory.storageUnits, searchQuery, itemTypeFilter, viewMode, openContainer, checkedContainers]);

  // Stack identical items (cases, stickers, agents, etc.), then apply quantity/sort filters.
  const stackedItems = useMemo(() => {
    const stacks = stackItems(displayItems).filter((stack) => stack.count >= minStackCount);

    const byName = (a: StackedItem, b: StackedItem) => {
      const an = (a.item.market_name || a.item.custom_name || '').toLowerCase();
      const bn = (b.item.market_name || b.item.custom_name || '').toLowerCase();
      return an.localeCompare(bn);
    };

    const byQty = (a: StackedItem, b: StackedItem) => a.count - b.count;
    const byId = (a: StackedItem, b: StackedItem) => {
      try {
        const ai = BigInt(a.item.id || '0');
        const bi = BigInt(b.item.id || '0');
        if (ai === bi) return 0;
        return ai > bi ? 1 : -1;
      } catch {
        return (a.item.id || '').localeCompare(b.item.id || '');
      }
    };

    return [...stacks].sort((a, b) => {
      if (sortBy === 'newest-first') return byId(b, a);
      if (sortBy === 'oldest-first') return byId(a, b);
      if (sortBy === 'name-asc') return byName(a, b);
      if (sortBy === 'name-desc') return byName(b, a);
      if (sortBy === 'qty-desc') return byQty(b, a);
      return byQty(a, b);
    });
  }, [displayItems, minStackCount, sortBy]);

  // ---- Progressive rendering: show items in pages for large inventories ----
  const PAGE_SIZE = 100;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset visible count when display items change (search, view switch, etc.)
  useMemo(() => { setVisibleCount(PAGE_SIZE); }, [stackedItems]);

  const visibleStacks = useMemo(
    () => stackedItems.slice(0, visibleCount),
    [stackedItems, visibleCount],
  );
  const hasMore = visibleCount < stackedItems.length;

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, stackedItems.length));
  }, [stackedItems.length]);

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {/* Blocking loading overlay — forces user to wait until inventory is loaded */}
      {(inventory.state === 'loading' || inventory.state === 'idle') && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
          <div className="text-center space-y-4">
            <svg className="animate-spin h-10 w-10 mx-auto text-blue-400" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-slate-300 text-sm font-medium">
              {inventory.state === 'idle' ? 'Waiting for Game Coordinator...' : 'Loading inventory...'}
            </p>
            <p className="text-slate-500 text-xs">This may take a moment</p>
          </div>
        </div>
      )}

      {/* Top bar — shared NavBar */}
      <NavBar activePage="inventory" onNavigate={onNavigate} status={status} onLogout={logout} />

      {/* Content area */}
      <main className="flex-1 flex flex-col min-h-0 p-4 gap-4">
        {/* Inventory not connected yet */}
        {status.state !== 'gcConnected' && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4 max-w-md">
              <div className="w-20 h-20 mx-auto rounded-full bg-blue-500/20 flex items-center justify-center">
                <svg className="w-10 h-10 text-blue-400 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold">Waiting for Game Coordinator...</h2>
              <p className="text-slate-400 text-sm">
                Connected to Steam. Inventory will load once CS2 GC connects.
              </p>
            </div>
          </div>
        )}

        {/* GC connected — show inventory */}
        {status.state === 'gcConnected' && (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-3 shrink-0">
              {/* Search */}
              <div className="relative flex-1 max-w-md">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Search items..."
                />
              </div>

              <select
                value={itemTypeFilter}
                onChange={(e) => setItemTypeFilter(e.target.value as ItemTypeFilter)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                title="Filter by item type"
              >
                <option value="all">Type: All</option>
                <option value="weapon">Type: Weapon</option>
                <option value="tool">Type: Tool</option>
                <option value="collectible">Type: Collectible</option>
                <option value="music">Type: Music Kit</option>
                <option value="container">Type: Container</option>
                <option value="other">Type: Other</option>
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
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

              {/* View toggle */}
              <div className="flex rounded-lg border border-slate-700 overflow-hidden">
                <button
                  onClick={() => { setViewMode('all'); setOpenContainerId(null); clearSelection(); }}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${viewMode === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                >
                  All Items
                </button>
                {viewMode === 'container' && openContainer && (
                  <button
                    className="px-3 py-2 text-xs font-medium bg-amber-600 text-white flex items-center gap-1.5"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    {openContainer.custom_name || `Unit #${openContainer.id}`}
                  </button>
                )}
              </div>

              {/* Fetch Prices */}
              <button
                onClick={fetchPrices}
                disabled={isFetchingPrices || isOperating}
                className="flex items-center gap-1.5 bg-green-600/20 hover:bg-green-600/30 disabled:opacity-50 border border-green-500/30 rounded-lg px-3 py-2 text-xs text-green-400 font-medium transition-colors"
                title="Fetch/refresh market prices for all items (including storage unit contents)"
              >
                <svg className={`w-3.5 h-3.5 ${isFetchingPrices ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {isFetchingPrices ? 'Fetching...' : 'Fetch Prices'}
              </button>
              {isFetchingPrices && (
                <button
                  onClick={cancelFetch}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors px-1"
                >
                  Cancel
                </button>
              )}

              {/* Stats */}
              <div className="text-xs text-slate-500">
                {inventory.totalItems} items
              </div>

              {/* Speed control */}
              <div className="flex rounded-lg border border-slate-700 overflow-hidden" title="Delay between operations">
                {(['normal', 'fast', 'turbo'] as const).map((speed) => (
                  <button
                    key={speed}
                    onClick={() => setOperationSpeed(speed)}
                    className={`px-2 py-1.5 text-[10px] font-medium transition-colors ${operationSpeed === speed
                        ? speed === 'turbo'
                          ? 'bg-red-600 text-white'
                          : speed === 'fast'
                            ? 'bg-amber-600 text-white'
                            : 'bg-slate-600 text-white'
                        : 'bg-slate-800 text-slate-500 hover:text-slate-300'
                      }`}
                  >
                    {speed === 'normal' ? '0.5s' : speed === 'fast' ? '0.1s' : '0.025s'}
                  </button>
                ))}
              </div>

              {/* Reload */}
              <button
                onClick={inventory.reloadInventory}
                disabled={inventory.state === 'loading' || isOperating}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 transition-colors"
              >
                <svg
                  className={`w-3.5 h-3.5 ${inventory.state === 'loading' ? 'animate-spin' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Reload
              </button>
            </div>

            {/* Pricing progress banner */}
            {isFetchingPrices && pricingProgress && (
              <div className="bg-slate-800/80 border border-blue-500/30 rounded-lg px-4 py-2.5 shrink-0">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span>
                    {pricingProgress.currentItem?.startsWith('Loading ')
                      ? pricingProgress.currentItem
                      : `Fetching prices... ${pricingProgress.current}/${pricingProgress.total}`
                    }
                  </span>
                  {pricingProgress.currentItem && !pricingProgress.currentItem.startsWith('Loading ') && (
                    <span className="text-slate-500 truncate ml-2 max-w-xs">
                      {pricingProgress.currentItem}
                    </span>
                  )}
                </div>
                <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style={{ width: `${pricingProgress.total > 0 ? (pricingProgress.current / pricingProgress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}

            {/* Error banner */}
            {inventory.error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm shrink-0">
                {inventory.error}
              </div>
            )}

            {/* Loading state */}
            {inventory.state === 'loading' && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-3">
                  <svg className="animate-spin h-8 w-8 mx-auto text-blue-400" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <p className="text-slate-400 text-sm">Loading inventory from Game Coordinator...</p>
                </div>
              </div>
            )}

            {/* Inventory loaded */}
            {inventory.state === 'loaded' && (
              <div className="flex-1 flex flex-col min-h-0 gap-4">
                {/* ---- Container dedicated tab ---- */}
                {viewMode === 'container' && openContainer && (
                  <div className="flex-1 flex flex-col min-h-0">
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-3 shrink-0">
                      <button
                        onClick={() => { setViewMode('all'); setOpenContainerId(null); clearSelection(); }}
                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        Back to Inventory
                      </button>
                      <span className="text-sm font-semibold text-slate-300">
                        {openContainer.custom_name || `Storage Unit #${openContainer.id}`}
                      </span>
                      <span className="text-xs text-slate-500">
                        ({openContainer.item_count} items)
                      </span>
                    </div>

                    {/* Loading */}
                    {openContainer.isLoading && (
                      <div className="flex-1 flex items-center justify-center">
                        <div className="flex items-center gap-2 text-slate-400 text-sm">
                          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Loading container contents...
                        </div>
                      </div>
                    )}

                    {/* Not loaded */}
                    {!openContainer.isLoaded && !openContainer.isLoading && (
                      <div className="flex-1 flex items-center justify-center">
                        <button
                          onClick={() => inventory.loadCasketContents(openContainer.id).catch(console.error)}
                          className="bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
                        >
                          Load Container Contents
                        </button>
                      </div>
                    )}

                    {/* Items grid */}
                    {openContainer.isLoaded && (
                      <div className="flex-1 min-h-0 overflow-y-auto">
                        <p className="text-xs text-slate-500 mb-2">
                          {displayItems.length} items{stackedItems.length !== displayItems.length ? `, ${stackedItems.length} unique` : ''}
                          {' · Click items to select, then remove from unit'}
                        </p>
                        {stackedItems.length === 0 ? (
                          <div className="text-center py-12 text-slate-500">
                            {searchQuery ? `No items matching "${searchQuery}"` : 'This storage unit is empty.'}
                          </div>
                        ) : (
                          <>
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2">
                              {visibleStacks.map((stack) => {
                                const mhn = getMarketHashName(stack.item);
                                const pd = mhn ? portfolioData?.itemPrices?.[mhn] : undefined;
                                const stackCanSelect = stack.allItems.some(i => !listedAssetIds.has(i.id));
                                return (
                                  <ItemCard
                                    key={stack.item.id}
                                    item={stack.item}
                                    stackCount={stack.count}
                                    selected={stack.allItems.some((i) => selectedIds.has(i.id))}
                                    onSelect={(e) => handleStackClick(stack, e)}
                                    steamPrice={pd?.currentPrice}
                                    skinportData={pd?.skinport}
                                    currencySymbol={currencySymbol}
                                    isListed={stack.allItems.some(i => listedAssetIds.has(i.id))}
                                    canSelect={stackCanSelect}
                                  />
                                );
                              })}
                            </div>
                            {hasMore && (
                              <div className="flex justify-center py-4">
                                <button
                                  onClick={loadMore}
                                  className="px-6 py-2 text-sm font-medium rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                                >
                                  Show more ({stackedItems.length - visibleCount} remaining)
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ---- All Items view ---- */}
                {viewMode === 'all' && (
                  <>
                    {/* Storage Units panel with checkboxes */}
                    {inventory.storageUnits.length > 0 && (
                      <div className="shrink-0">
                        <div className="flex items-center justify-between mb-2">
                          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
                            Storage Units ({inventory.storageUnits.length})
                          </h2>
                          {checkedContainers.size > 0 && (
                            <button
                              onClick={() => setCheckedContainers(new Set())}
                              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                            >
                              Uncheck all
                            </button>
                          )}
                        </div>
                        <div className={`flex flex-wrap gap-2 ${inventory.storageUnits.length > 12 ? 'max-h-[280px] overflow-y-auto pr-1' : ''}`}>
                          {inventory.storageUnits.map((unit) => (
                            <StorageUnitCard
                              key={unit.id}
                              unit={unit}
                              isChecked={checkedContainers.has(unit.id)}
                              onToggleCheck={() => toggleContainerCheck(unit.id)}
                              onOpen={() => openContainerTab(unit.id)}
                              onLoad={() => inventory.loadCasketContents(unit.id).catch(console.error)}
                              onStartRename={() => {
                                setRenameInput(unit.custom_name || '');
                                setRenamingUnit(unit);
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Item grid */}
                    <div className="flex-1 min-h-0 overflow-y-auto">
                      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">
                        Inventory ({displayItems.length} items{stackedItems.length !== displayItems.length ? `, ${stackedItems.length} unique` : ''})
                        {checkedContainers.size > 0 && (
                          <span className="text-blue-400 text-xs font-normal ml-2">
                            +{checkedContainers.size} container{checkedContainers.size > 1 ? 's' : ''} included
                          </span>
                        )}
                      </h2>
                      <p className="text-xs text-slate-500 mb-2">
                        Click items to select, then move to a storage unit
                      </p>

                      {stackedItems.length === 0 ? (
                        <div className="text-center py-12 text-slate-500">
                          {searchQuery
                            ? `No items matching "${searchQuery}"`
                            : 'No items in inventory'}
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2">
                            {visibleStacks.map((stack) => {
                              const mhn = getMarketHashName(stack.item);
                              const pd = mhn ? portfolioData?.itemPrices?.[mhn] : undefined;
                              const stackCanSelect = stack.allItems.some(i => !listedAssetIds.has(i.id) && canMoveToStorage(i));
                              return (
                                <ItemCard
                                  key={stack.item.id}
                                  item={stack.item}
                                  stackCount={stack.count}
                                  selected={stack.allItems.some((i) => selectedIds.has(i.id))}
                                  onSelect={(e) => handleStackClick(stack, e)}
                                  steamPrice={pd?.currentPrice}
                                  skinportData={pd?.skinport}
                                  currencySymbol={currencySymbol}
                                  isListed={stack.allItems.some(i => listedAssetIds.has(i.id))}
                                  canSelect={stackCanSelect}
                                />
                              );
                            })}
                          </div>
                          {hasMore && (
                            <div className="flex justify-center py-4">
                              <button
                                onClick={loadMore}
                                className="px-6 py-2 text-sm font-medium rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                              >
                                Show more ({stackedItems.length - visibleCount} remaining)
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Idle state (no inventory loaded yet) */}
            {inventory.state === 'idle' && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-4">
                  <p className="text-slate-400">Inventory not loaded yet.</p>
                  <button
                    onClick={inventory.reloadInventory}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg px-6 py-2.5 transition-colors"
                  >
                    Load Inventory
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* ---- Selection Action Bar ---- */}
      {selectedIds.size > 0 && !isOperating && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl px-5 py-3 flex items-center gap-3 z-40">
          <span className="text-sm font-medium text-slate-200">
            {selectedIds.size} item{selectedIds.size > 1 ? 's' : ''} selected
          </span>

          <div className="w-px h-6 bg-slate-600" />

          {viewMode === 'all' && inventory.storageUnits.length > 0 && (
            <button
              onClick={() => setShowMoveDialog(true)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg px-3 py-1.5 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              Move to Storage Unit
            </button>
          )}

          {viewMode === 'container' && openContainerId && (
            <>
              {inventory.storageUnits.length > 1 && (
                <button
                  onClick={() => setShowMoveDialog(true)}
                  className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg px-3 py-1.5 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  Move to Storage Unit
                </button>
              )}
              <button
                onClick={removeItemsFromUnit}
                className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg px-3 py-1.5 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
                Remove to Inventory
              </button>
            </>
          )}

          <button
            onClick={clearSelection}
            className="text-sm text-slate-400 hover:text-slate-200 transition-colors px-2"
          >
            Clear
          </button>
        </div>
      )}

      {/* ---- Move-to-Storage-Unit Dialog ---- */}
      {showMoveDialog && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setShowMoveDialog(false)}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold mb-1">Move to Storage Unit</h3>
            <p className="text-sm text-slate-400 mb-4">
              {viewMode === 'container' && openContainerId
                ? `Transfer ${selectedIds.size} item${selectedIds.size > 1 ? 's' : ''} to another unit`
                : `Moving ${selectedIds.size} item${selectedIds.size > 1 ? 's' : ''}`
              }
              <span className="ml-1 text-slate-500">
                ({operationSpeed === 'normal' ? '0.5s' : operationSpeed === 'fast' ? '0.1s' : '0.025s'} delay)
              </span>
            </p>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {inventory.storageUnits
                .filter((u) => u.id !== openContainerId) // exclude source unit in unit-to-unit
                .map((unit) => {
                  const available = 1000 - unit.item_count;
                  const canFit = available >= selectedIds.size;
                  return (
                    <button
                      key={unit.id}
                      onClick={() => canFit && moveItemsToUnit(unit.id)}
                      disabled={!canFit}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${canFit
                          ? 'bg-slate-700/50 hover:bg-slate-700 cursor-pointer'
                          : 'bg-slate-700/20 opacity-40 cursor-not-allowed'
                        }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">
                            {unit.custom_name || `Storage Unit #${unit.id}`}
                          </p>
                          <p className="text-xs text-slate-400">
                            {unit.item_count} / 1,000 items · {available} slots available
                          </p>
                        </div>
                        {canFit && (
                          <svg className="w-4 h-4 text-slate-400 shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        )}
                      </div>
                      {/* Capacity bar */}
                      <div className="w-full h-1 bg-slate-600 rounded-full overflow-hidden mt-2">
                        <div
                          className={`h-full rounded-full ${unit.item_count >= 900
                              ? 'bg-red-400'
                              : unit.item_count >= 500
                                ? 'bg-yellow-400'
                                : 'bg-green-400'
                            }`}
                          style={{ width: `${Math.min(100, (unit.item_count / 1000) * 100)}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
            </div>

            <button
              onClick={() => setShowMoveDialog(false)}
              className="mt-4 w-full text-center text-sm text-slate-400 hover:text-slate-200 transition-colors py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ---- Quantity Picker Modal ---- */}
      {quantityPicker && (
        <div className="fixed inset-0 z-50 pointer-events-auto" onClick={() => setQuantityPicker(null)}>
          <div
            className="absolute bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-3 w-64 popup-animate"
            style={{
              left: Math.min(quantityPicker.x - 128, window.innerWidth - 270),
              top: Math.min(quantityPicker.y + 10, window.innerHeight - 150)
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-semibold text-slate-200">Select Quantity</span>
            </div>
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => setQuantityPicker((p) => p && { ...p, quantity: Math.max(1, p.quantity - 1) })}
                className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-lg flex items-center justify-center transition-colors"
                disabled={quantityPicker.quantity <= 1}
              >
                -
              </button>
              <input
                type="number"
                min={1}
                max={quantityPicker.count}
                value={quantityPicker.quantity}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(quantityPicker.count, Number(e.target.value) || 1));
                  setQuantityPicker((p) => p && { ...p, quantity: v });
                }}
                className="flex-1 text-center bg-slate-700 border border-slate-600 rounded-lg py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                onClick={() => setQuantityPicker((p) => p && { ...p, quantity: Math.min(p.count, p.quantity + 1) })}
                className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold text-lg flex items-center justify-center transition-colors"
                disabled={quantityPicker.quantity >= quantityPicker.count}
              >
                +
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setQuantityPicker(null)}
                className="flex-1 text-center text-sm text-slate-400 hover:text-slate-200 border border-slate-600 rounded-lg py-1.5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmQuantitySelection}
                className="flex-1 text-center text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg py-1.5 transition-colors"
              >
                Select
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Rename Modal ---- */}
      {renamingUnit && (
        <div className="fixed inset-0 bg-black/60 z-[9999] flex flex-col items-center justify-center p-4 popup-animate" onClick={() => setRenamingUnit(null)}>
          <div
            className="bg-slate-800 border border-slate-700 rounded-xl p-6 flex flex-col w-[400px] shadow-2xl items-center text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold text-white mb-2">Rename Storage Unit</h2>
            <p className="text-sm text-slate-400 mb-6">Enter a new name for your container unit.</p>

            <input
              autoFocus
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const trimmed = renameInput.trim();
                  if (trimmed && trimmed !== renamingUnit.custom_name) {
                    inventory.renameCasket(renamingUnit.id, trimmed).catch(console.error);
                  }
                  setRenamingUnit(null);
                } else if (e.key === 'Escape') {
                  setRenamingUnit(null);
                }
              }}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 mb-6 font-medium text-center text-lg placeholder-slate-600"
              maxLength={36}
              placeholder={renamingUnit.custom_name || `Storage Unit #${renamingUnit.id.slice(-4)}`}
            />

            <div className="flex w-full gap-3">
              <button
                onClick={() => setRenamingUnit(null)}
                className="flex-1 py-2.5 rounded-lg font-semibold bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const trimmed = renameInput.trim();
                  if (trimmed && trimmed !== renamingUnit.custom_name) {
                    inventory.renameCasket(renamingUnit.id, trimmed).catch(console.error);
                  }
                  setRenamingUnit(null);
                }}
                className="flex-1 py-2.5 rounded-lg font-bold bg-green-600 text-white hover:bg-green-500 transition-colors shadow-lg shadow-green-500/20"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Bulk Operation Progress ---- */}
      {inventory.operationProgress && (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 border rounded-xl shadow-2xl px-6 py-4 z-50 min-w-80 ${inventory.operationProgress.state === 'completed'
            ? 'bg-green-900/80 border-green-500/50'
            : inventory.operationProgress.state === 'cancelled'
              ? 'bg-yellow-900/80 border-yellow-500/50'
              : inventory.operationProgress.state === 'error'
                ? 'bg-red-900/80 border-red-500/50'
                : 'bg-slate-800 border-blue-500/50'
          }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              {inventory.operationProgress.state === 'running' && (
                <>Moving items... {inventory.operationProgress.completed}/{inventory.operationProgress.total}</>
              )}
              {inventory.operationProgress.state === 'completed' && (
                <>Done! {inventory.operationProgress.completed}/{inventory.operationProgress.total} moved</>
              )}
              {inventory.operationProgress.state === 'cancelled' && (
                <>Cancelled. {inventory.operationProgress.completed}/{inventory.operationProgress.total} completed</>
              )}
              {inventory.operationProgress.state === 'error' && (
                <>Error. {inventory.operationProgress.completed}/{inventory.operationProgress.total} completed</>
              )}
            </span>
            {inventory.operationProgress.state === 'running' && (
              <button
                onClick={inventory.cancelBulkOperation}
                className="text-xs text-red-400 hover:text-red-300 transition-colors ml-4"
              >
                Cancel
              </button>
            )}
          </div>
          <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${inventory.operationProgress.state === 'completed'
                  ? 'bg-green-500'
                  : inventory.operationProgress.state === 'cancelled'
                    ? 'bg-yellow-500'
                    : 'bg-blue-500'
                }`}
              style={{
                width: `${inventory.operationProgress.total > 0
                  ? (inventory.operationProgress.completed / inventory.operationProgress.total) * 100
                  : 0}%`,
              }}
            />
          </div>
          {inventory.operationProgress.failed > 0 && (
            <p className="text-xs text-red-400 mt-1">
              {inventory.operationProgress.failed} item{inventory.operationProgress.failed > 1 ? 's' : ''} failed
            </p>
          )}
        </div>
      )}
    </div>
  );
}
