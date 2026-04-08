// ============================================================
// CSInventoryPorter — Shared constants
// ============================================================

/** CS2 AppID on Steam */
export const CS2_APP_ID = 730;


/** Defindex for Storage Unit (casket) items */
export const STORAGE_UNIT_DEFINDEX = 1201;

/** Delay in ms between casket operations to avoid rate limits */
export const CASKET_OPERATION_DELAY_MS = 1500;

/** Price cache TTL in ms (6 hours) — how often currentPrice is refreshed */
export const PRICE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Price history TTL in ms (7 days) — full history scraping happens less frequently */
export const PRICE_HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;



/** Steam CDN base for item images */
export const STEAM_CDN_IMAGE_BASE =
  'https://community.akamai.steamstatic.com/economy/image/';

/** Steam avatar base URL */
export const STEAM_AVATAR_BASE =
  'https://avatars.akamai.steamstatic.com/';

/** Account store filename */
export const ACCOUNTS_FILE = 'accounts.json';

/** Settings filename */
export const SETTINGS_FILE = 'settings.json';

// ---- Currency ----

export type CurrencyCode = 'USD' | 'EUR';

/** Legacy currency codes kept only for backward-compatible investment conversion */
export type LegacyCurrencyCode = 'USD' | 'EUR';

/** Steam Community Market currency IDs */
export const STEAM_CURRENCY_IDS: Record<CurrencyCode, number> = {
  USD: 1,
  EUR: 3,
};



/** Display symbols for each currency */
export const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  USD: '$',
  EUR: '€',
};

/** Default currency */
export const DEFAULT_CURRENCY: CurrencyCode = 'EUR';
