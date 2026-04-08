// ============================================================
// CSInventoryPorter — Shared item utilities
// Shared helpers for item stacking, wear conditions, market hash names
// ============================================================

import type { InventoryItem } from '../../shared/types';

// ---- AppPage type (shared across all pages) ----

export type AppPage =
  | 'home'
  | 'portfolio'
  | 'inventory'
  | 'market'
  | 'trade'
  | 'investments'
  | 'tradeup'
  | 'armory'
  | 'login'
  | 'loading'
  | 'settings';

// ---- Stacking helpers ----

export interface StackedItem {
  item: InventoryItem;
  count: number;
  allItems: InventoryItem[];
}

/**
 * Group items into stacks. Items without paint_wear (cases, stickers, etc.)
 * stack by market_name or defindex:paintIndex. Skins, storage units, and
 * custom-named items are always unique.
 */
export function stackItems(items: InventoryItem[]): StackedItem[] {
  const groups = new Map<string, InventoryItem[]>();

  for (const item of items) {
    let key: string;
    if (item.paint_wear != null || item.is_storage_unit || item.custom_name) {
      key = `unique:${item.id}`;
    } else if (item.market_name) {
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

// ---- Wear condition helpers ----

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
export function getWearCondition(wear: number): string {
  for (const [threshold, name] of WEAR_RANGES) {
    if (wear < threshold || (threshold === 1.0 && wear <= threshold)) return name;
  }
  return 'Battle-Scarred';
}

/** Short wear abbreviation (FN, MW, FT, WW, BS) */
export function getWearShort(wear: number): string {
  const full = getWearCondition(wear);
  const map: Record<string, string> = {
    'Factory New': 'FN',
    'Minimal Wear': 'MW',
    'Field-Tested': 'FT',
    'Well-Worn': 'WW',
    'Battle-Scarred': 'BS',
  };
  return map[full] ?? 'BS';
}


// ---- Market hash name construction ----

/**
 * Build the Steam Community Market hash name for an item.
 * Returns null for non-marketable items.
 */
export function getMarketHashName(item: InventoryItem): string | null {
  if (!item.market_name) return null;
  if (item.marketable === false) return null;
  if (item.is_storage_unit) return null;
  if (item.weapon_type === 'Pass') return null;
  if (item.weapon_type === 'Collectible') return null;
  if (item.weapon_type === 'Equipment') return null;
  if (item.defindex === 1349) return null; // Open (used) graffiti — not marketable

  if (item.paint_wear != null && item.paint_wear > 0) {
    return `${item.market_name} (${getWearCondition(item.paint_wear)})`;
  }

  return item.market_name;
}

// ---- Name display helpers ----

export interface ParsedMarketName {
  fullName: string;
  weaponName: string;
  skinName: string | null;
}

/**
 * Splits "Weapon | Skin" names into two parts for richer card display.
 * For non-skin names, returns skinName=null.
 */
export function parseMarketName(name: string): ParsedMarketName {
  const fullName = name.trim();
  const parts = fullName.split(/\s*\|\s*/, 2);
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return { fullName, weaponName: fullName, skinName: null };
  }
  return {
    fullName,
    weaponName: parts[0].trim(),
    skinName: parts[1].trim(),
  };
}

/**
 * Returns a Tailwind text-size class tuned for card titles based on name length.
 */
export function nameFontClass(name: string, compact = false): string {
  const len = name.length;
  if (compact) {
    if (len > 38) return 'text-[10px]';
    if (len > 26) return 'text-[11px]';
    return 'text-xs';
  }
  if (len > 46) return 'text-[11px]';
  if (len > 34) return 'text-xs';
  return 'text-sm';
}

// ---- Time range types (shared by charts) ----

export type TimeRange = '7d' | '30d' | '90d' | '1y' | 'all';

export const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  '7d': '7D',
  '30d': '1M',
  '90d': '3M',
  '1y': '1Y',
  'all': 'ALL',
};

export const TIME_RANGE_MS: Record<TimeRange, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
  'all': Infinity,
};

// ---- Relative time helper ----

/**
 * Time ago.
 *
 * Characteristics:
 * - @param timestamp - The parameter for timestamp
 * - @returns string
 *
 */
export function timeAgo(timestamp: number): string {
  if (!timestamp) return 'Never';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
