// ============================================================
// CSInventoryPorter — PricingService
// Fetches Steam Community Market price history for items.
// Approach inspired by github.com/HilliamT/scm-price-history:
// scrapes market listing pages and extracts embedded price data.
// Also uses /market/priceoverview/ API for quick current prices.
// Uses native fetch() + regex instead of axios/cheerio.
// ============================================================

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import type {
  PriceSnapshot,
  ItemPriceData,
  PricingProgress,
  PortfolioSnapshot,
  InventoryItem,
  StorageUnit,
  PriceServerConfig,
  SkinportPriceData,
} from '../../shared/types';
import { PRICE_CACHE_TTL_MS, PRICE_HISTORY_TTL_MS, STEAM_CURRENCY_IDS, type CurrencyCode } from '../../shared/constants';
import { HttpPriceServerProvider, type ExternalPriceProvider } from './pricing/ExternalPriceProvider';


// ---- Configuration ----

const PRICE_CACHE_VERSION = 2;
const PRICE_CACHE_FILES: Record<CurrencyCode, string> = {
  EUR: 'price-cache-eur.json',
  USD: 'price-cache-usd.json',
};
const LEGACY_PRICE_CACHE_FILES = ['price-cache.json', 'price-cache-usd.json'];

/** Max history points to keep per item (~90 days of hourly data) */
const MAX_HISTORY_POINTS = 2200;

/** Delay between current-price requests to avoid Steam rate limiting */
const CURRENT_PRICE_DELAY_MS = 450;

/** Parallel workers for fallback per-item priceoverview fetches */
const FALLBACK_CONCURRENCY = 3;

/** Maximum retries for a single fallback priceoverview item on rate limit */
const FALLBACK_MAX_RATE_LIMIT_RETRIES = 3;

/** Delay between grouped search/render requests */
const BULK_DELAY_MS = 200;

/** Save cache to disk every N successful fetches for crash resilience */
const QUICK_SAVE_INTERVAL = 10;

/** Retry zero-priced entries sooner so newly-listed items get covered faster */
const ZERO_PRICE_RETRY_TTL_MS = 15 * 60 * 1000;

/** Steam Community Market listing URL template */
const SCM_LISTING_URL = 'https://steamcommunity.com/market/listings/730/';

/** Steam Community Market priceoverview API — returns JSON with current price */
const SCM_PRICEOVERVIEW_URL = 'https://steamcommunity.com/market/priceoverview/';

/** Steam Community Market search/render API — can resolve many items per query */
const SCM_SEARCH_RENDER_URL = 'https://steamcommunity.com/market/search/render/';

/** FX API used to convert price-server USD prices to EUR */
const FRANKFURTER_LATEST_URL = 'https://api.frankfurter.dev/v1/latest';

/** Reuse FX rate briefly to avoid extra API traffic */
const FX_RATE_TTL_MS = 10 * 60 * 1000;

/** Steam has a practical floor around 0.03 EUR for marketable items */
const MIN_STEAM_PRICE_EUR = 0.03;

/** Country codes that help Steam serve the correct currency */
const CURRENCY_COUNTRY: Partial<Record<CurrencyCode, string>> = {
  EUR: 'de',
  USD: 'us',
};

/** Wear condition thresholds for skins */
const WEAR_RANGES: [number, string][] = [
  [0.07, 'Factory New'],
  [0.15, 'Minimal Wear'],
  [0.38, 'Field-Tested'],
  [0.45, 'Well-Worn'],
  [1.00, 'Battle-Scarred'],
];

// ---- Cache types ----

interface PriceCacheEntry {
  marketHashName: string;
  currentPrice: number;
  priceHistory: PriceSnapshot[];
  lastFetched: number;
  lastHistoryFetch?: number; // When full history was last scraped (vs quick price refresh)
  skinport?: SkinportPriceData;
}

interface PriceCacheFile {
  version: number;
  currency?: CurrencyCode;
  entries: Record<string, PriceCacheEntry>;
}

// ---- Service ----

export class PricingService extends EventEmitter {
  private cache = new Map<string, ItemPriceData>();
  private historyFetchTimes = new Map<string, number>(); // marketHashName → last full history scrape timestamp
  private cacheDir: string;
  private _cancelled = false;
  private _fetching = false;
  private _currency: CurrencyCode = 'EUR';
  private _priceServer: PriceServerConfig | null = null;
  private _externalPriceProvider: ExternalPriceProvider = new HttpPriceServerProvider();
  /** External Skinport price map injected by AccountManager after SkinportService fetches */
  private _skinportPrices: Map<string, SkinportPriceData> | null = null;
  private _usdToEurRateCache: { rate: number; fetchedAt: number } | null = null;

  constructor(userDataPath: string) {
    super();
    this.cacheDir = userDataPath;
    this.loadCacheFromDisk();
  }

  get currency(): CurrencyCode {
    return this._currency;
  }

  // ---- Skinport prices (from SkinportService) ----

  /**
     * Sets skinport prices.
     *
     * Characteristics:
     * - @param prices - The parameter for prices
     * - @returns Nothing (void)
     *
     */
    setSkinportPrices(prices: Map<string, SkinportPriceData>): void {
    this._skinportPrices = prices;
    // Merge into existing cache entries so already-cached items get Skinport data too
    for (const [name, sp] of prices) {
      const existing = this.cache.get(name);
      if (existing && !existing.skinport) {
        existing.skinport = sp;
        this.cache.set(name, existing);
      }
    }
    console.log(`[PricingService] Merged ${prices.size} Skinport prices into cache`);
  }

  // ---- Price Server config ----

  get priceServer(): PriceServerConfig | null {
    return this._priceServer;
  }

  /**
     * Sets price server.
     *
     * Characteristics:
     * - @param config - The parameter for config
     * - @returns Nothing (void)
     *
     */
    setPriceServer(config: PriceServerConfig | null): void {
    this._priceServer = config;
    console.log(`[PricingService] Price server ${config?.enabled ? `enabled: ${config.url}` : 'disabled'}`);
  }

  /** Override the external pricing provider (for custom integrations). */
  setExternalPriceProvider(provider: ExternalPriceProvider): void {
    this._externalPriceProvider = provider;
  }

  /** Test connection to the price server. Returns status info. */
  async testPriceServer(config: PriceServerConfig): Promise<{ success: boolean; totalPrices?: number; latencyMs?: number; error?: string }> {
    return this._externalPriceProvider.testConnection(config);
  }

  /**
   * Fetch prices from the remote price server in bulk.
   * Returns a Set of names that were successfully resolved.
   * Also pushes missing items to the server's scrape queue.
   */
  private async fetchFromPriceServer(names: string[]): Promise<Set<string>> {
    const resolved = new Set<string>();
    if (!this._priceServer?.enabled || !this._priceServer.url || names.length === 0) {
      return resolved;
    }

    const maybeUsdToEurRate = this._currency === 'EUR' ? await this.getUsdToEurRate() : null;

    try {
      const result = await this._externalPriceProvider.fetchPrices(names, this._priceServer);

      for (const [name, record] of result.records) {
        const convertedCurrentPrice = this.convertPriceServerPrice(record.currentPrice, maybeUsdToEurRate);
        const convertedHistory = (record.priceHistory ?? []).map((snap: any) => ({
          ...snap,
          value: this.convertPriceServerPrice(typeof snap?.value === 'number' ? snap.value : 0, maybeUsdToEurRate),
        }));

        const itemData: ItemPriceData = {
          marketHashName: name,
          currentPrice: convertedCurrentPrice,
          priceHistory: convertedHistory,
          // Mark as fresh now so matched server entries are not immediately re-fetched from Steam.
          lastFetched: Date.now(),
          skinport: record.skinport,
        };

        const existing = this.cache.get(name);
        if (existing?.priceHistory?.length) {
          itemData.priceHistory = this.mergeHistory(existing.priceHistory, itemData.priceHistory);
        }

        this.cache.set(name, itemData);
        if (itemData.priceHistory.length > 0) {
          this.historyFetchTimes.set(name, Date.now());
        }
        resolved.add(name);
      }

      console.log(`[PricingService] Bulk download: scanned ${result.totalScanned} server prices, matched ${resolved.size}/${names.length} inventory items`);

      // Step 3: Push missing items to the server's scrape queue so they get scraped next cycle.
      const missing = names.filter(n => !resolved.has(n));
      if (missing.length > 0) {
        try {
          await this._externalPriceProvider.queueMissing(missing, this._priceServer);
          console.log(`[PricingService] Queued ${missing.length} items on price server for future scraping`);
        } catch { /* non-critical */ }
      }
    } catch (err: any) {
      console.warn(`[PricingService] Price server fetch failed:`, err.message);
    }

    return resolved;
  }

  /** Set the active currency. If changed, clears the in-memory cache and reloads from the currency-specific cache file. */
  setCurrency(code: CurrencyCode): void {
    const next: CurrencyCode = code;
    if (next === this._currency) return;
    console.log(`[PricingService] Currency changed: ${this._currency} → ${next}`);
    this._currency = next;
    // Clear and reload from the currency-specific cache file
    this.cache.clear();
    this.historyFetchTimes.clear();
    this.loadCacheFromDisk();
  }

  private get cacheFileName(): string {
    return PRICE_CACHE_FILES[this._currency];
  }

  /**
   * Clears in-memory and on-disk price caches for a cold refresh.
   * Returns the number of cache files removed from disk.
   */
  clearAllPriceCaches(): number {
    this.cache.clear();
    this.historyFetchTimes.clear();

    let removed = 0;
    const fileNames = [this.cacheFileName, ...LEGACY_PRICE_CACHE_FILES];
    for (const fileName of fileNames) {
      const filePath = path.join(this.cacheDir, fileName);
      try {
        if (!fs.existsSync(filePath)) continue;
        fs.unlinkSync(filePath);
        removed++;
      } catch (err: any) {
        console.warn(`[PricingService] Failed to remove cache file ${fileName}:`, err.message);
      }
    }

    return removed;
  }

  get isFetching(): boolean {
    return this._fetching;
  }

  // ---- Public API ----

  /**
   * Fetch current prices for all inventory + storage items.
   *
   * Current mode intentionally skips history scraping for speed and reliability:
   * - Uses Steam `market/priceoverview` only
   * - Updates `currentPrice` + `lastFetched`
   * - Preserves any existing history already in cache for future use
   */
  async fetchAllPrices(
    items: InventoryItem[],
    storageUnits: StorageUnit[],
  ): Promise<void> {
    if (this._fetching) {
      console.log('[PricingService] Already fetching, ignoring duplicate request');
      return;
    }

    this._fetching = true;
    this._cancelled = false;

    // Collect all items (inventory + inside storage units)
    const allItems = [...items];
    for (const unit of storageUnits) {
      if (unit.items?.length) {
        allItems.push(...unit.items);
      }
    }

    // Build unique market hash names with their quantities
    const itemMap = this.buildItemMap(allItems);

    // Filter to only marketable items (skip storage units, bonus rank, etc.)
    const marketableNames = [...itemMap.keys()].filter((name) => name.length > 0);

    // ── Try price server first (bulk fetch) ──────────────────────
    if (this._priceServer?.enabled && this._priceServer.url) {
      this.emitProgress({ current: 0, total: marketableNames.length, state: 'loading', currentItem: '🌐 Fetching from price server...' });
      const serverResolved = await this.fetchFromPriceServer(marketableNames);
      if (serverResolved.size > 0) {
        this.saveCacheToDisk();
      }
      // If server resolved ALL items, we're done
      if (serverResolved.size === marketableNames.length) {
        this.emitProgress({ current: marketableNames.length, total: marketableNames.length, state: 'loaded' });
        this._fetching = false;
        return;
      }
    }

    // Build list of items that need a fresh current-price lookup.
    const toFetch: string[] = [];
    for (const name of marketableNames) {
      const cached = this.cache.get(name);
      if (!cached) {
        toFetch.push(name);
        continue;
      }
      if (cached.currentPrice <= 0 && (Date.now() - cached.lastFetched > ZERO_PRICE_RETRY_TTL_MS)) {
        toFetch.push(name);
        continue;
      }
      if (Date.now() - cached.lastFetched > PRICE_CACHE_TTL_MS) {
        toFetch.push(name);
      }
    }

    // Oldest first to refresh stale values first.
    toFetch.sort((a, b) => (this.cache.get(a)?.lastFetched ?? 0) - (this.cache.get(b)?.lastFetched ?? 0));

    const total = toFetch.length;
    console.log(`[PricingService] ${marketableNames.length} unique items, ${total} need current-price fetch (currency=${this._currency})`);

    if (total === 0) {
      this.emitProgress({ current: 0, total: 0, state: 'loaded' });
      this._fetching = false;
      return;
    }

    this.emitProgress({ current: 0, total, state: 'loading' });

    let completed = 0;
    let rateLimited = false;

    // 1) Bulk pass: resolve many items per request via search/render.
    const unresolved = new Set<string>(toFetch);
    const grouped = this.groupNamesForBulkFetch(toFetch);
    for (const [prefix, namesInGroup] of grouped) {
      if (this._cancelled) break;

      this.emitProgress({
        current: completed,
        total,
        state: 'loading',
        currentItem: `Bulk: ${prefix}`,
      });

      try {
        const matchedThisGroup = await this.fetchGroupPrices(prefix, namesInGroup, unresolved);

        if (matchedThisGroup > 0) {
          completed += matchedThisGroup;
          this.emitProgress({
            current: completed,
            total,
            state: 'loading',
            currentItem: `Bulk matched ${matchedThisGroup}`,
          });
          if (completed % QUICK_SAVE_INTERVAL === 0) {
            this.saveCacheToDisk();
          }
        }
      } catch (err: any) {
        if (err.message?.includes('Rate limited')) {
          console.warn(`[PricingService] Rate limited during bulk fetch after ${completed}/${total}`);
          rateLimited = true;
          break;
        }
      }

      if (!this._cancelled) {
        await this.delay(BULK_DELAY_MS);
      }
    }

    // 2) Fallback pass: unresolved items via priceoverview in parallel workers.
    const fallback = [...unresolved];
    const workerCount = Math.max(1, Math.min(FALLBACK_CONCURRENCY, fallback.length));
    let nextIndex = 0;
    const retryCounts = new Map<string, number>();

    const runWorker = async (): Promise<void> => {
      while (!this._cancelled) {
        const i = nextIndex++;
        if (i >= fallback.length) return;

        const marketHashName = fallback[i];
        this.emitProgress({ current: completed, total, state: 'loading', currentItem: marketHashName });

        try {
          const newPrice = await this.fetchQuickPrice(marketHashName);
          this.upsertCurrentPrice(marketHashName, newPrice);
        } catch (err: any) {
          if (this.isTransientPriceError(err)) {
            const retryCount = (retryCounts.get(marketHashName) ?? 0) + 1;
            if (retryCount <= FALLBACK_MAX_RATE_LIMIT_RETRIES) {
              retryCounts.set(marketHashName, retryCount);
              fallback.push(marketHashName);
              rateLimited = true;
              await this.delay(700 * retryCount);
              continue;
            }
            completed++;
            this.emitProgress({
              current: completed,
              total,
              state: 'loading',
              currentItem: `${marketHashName} (transient error, will retry later)`,
            });
            continue;
          }

          // Not all items are sellable/listed; keep quiet and cache as zero.
          if (!err.message?.includes('No price data')) {
            console.warn(`[PricingService] Failed to fetch price for "${marketHashName}":`, err.message);
          }
          const existing = this.cache.get(marketHashName);
          if (!existing) {
            this.upsertCurrentPrice(marketHashName, 0);
          }
        }

        completed++;
        this.emitProgress({ current: completed, total, state: 'loading', currentItem: marketHashName });

        if (completed % QUICK_SAVE_INTERVAL === 0) {
          this.saveCacheToDisk();
        }

        if (!this._cancelled) {
          await this.delay(CURRENT_PRICE_DELAY_MS);
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    // Always save cache to disk (includes partial results from rate limiting)
    this.saveCacheToDisk();

    if (this._cancelled) {
      this.emitProgress({ current: completed, total, state: 'error', error: 'Cancelled by user' });
    } else {
      if (rateLimited) {
        console.log('[PricingService] Completed with rate-limit retries applied');
      }
      this.emitProgress({ current: total, total, state: 'loaded' });
    }

    this._fetching = false;
  }

  /** Cancel an in-progress price fetch */
  cancelFetch(): void {
    this._cancelled = true;
  }

  /**
   * Get cached price data for an item.
   * Returns undefined if no price data is available.
   */
  getCachedPrice(marketHashName: string): ItemPriceData | undefined {
    return this.cache.get(marketHashName);
  }

  /**
   * Get all cached prices as a plain object (for IPC serialization).
   */
  getAllCachedPrices(): Record<string, ItemPriceData> {
    const result: Record<string, ItemPriceData> = {};
    for (const [key, value] of this.cache) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Compute portfolio history: for each historical date, sum up
   * (item_count × price_at_date) for all items.
   */
  computePortfolioHistory(
    items: InventoryItem[],
    storageUnits: StorageUnit[],
  ): PortfolioSnapshot[] {
    const allItems = [...items];
    for (const unit of storageUnits) {
      if (unit.items?.length) allItems.push(...unit.items);
    }

    // Build quantity map: marketHashName → count
    const quantityMap = new Map<string, number>();
    for (const item of allItems) {
      const name = this.getMarketHashName(item);
      if (!name) continue;
      quantityMap.set(name, (quantityMap.get(name) ?? 0) + 1);
    }

    // Collect all unique timestamps across all items (use daily granularity)
    const timestampSet = new Set<number>();
    const priceByNameAndTime = new Map<string, Map<number, number>>();

    for (const [name, qty] of quantityMap) {
      if (qty === 0) continue;
      const priceData = this.cache.get(name);
      if (!priceData?.priceHistory?.length) continue;

      const timeMap = new Map<number, number>();

      for (const snap of priceData.priceHistory) {
        // Normalize to start of day (UTC)
        const dayMs = this.toDayTimestamp(snap.time);
        timestampSet.add(dayMs);
        // Keep latest price for each day
        timeMap.set(dayMs, snap.value);
      }

      priceByNameAndTime.set(name, timeMap);
    }

    if (timestampSet.size === 0) return [];

    // Sort timestamps chronologically
    const sortedDays = [...timestampSet].sort((a, b) => a - b);

    // For each day, compute total portfolio value
    // Use last known price (forward-fill) for items without data for that day
    const lastPriceByName = new Map<string, number>();
    const portfolio: PortfolioSnapshot[] = [];

    for (const day of sortedDays) {
      let totalValue = 0;

      for (const [name, qty] of quantityMap) {
        const timeMap = priceByNameAndTime.get(name);
        if (!timeMap) continue;

        // Use price for this day, or last known price
        const priceForDay = timeMap.get(day);
        if (priceForDay !== undefined) {
          lastPriceByName.set(name, priceForDay);
        }

        const price = lastPriceByName.get(name);
        if (price !== undefined) {
          totalValue += price * qty;
        }
      }

      portfolio.push({ time: day, value: Math.round(totalValue * 100) / 100 });
    }

    return portfolio;
  }

  /**
   * Compute total current portfolio value.
   */
  computeTotalValue(
    items: InventoryItem[],
    storageUnits: StorageUnit[],
  ): number {
    const allItems = [...items];
    for (const unit of storageUnits) {
      if (unit.items?.length) allItems.push(...unit.items);
    }

    let total = 0;
    for (const item of allItems) {
      const name = this.getMarketHashName(item);
      if (!name) continue;
      const priceData = this.cache.get(name);
      if (priceData) {
        // -1 means not listed on Steam; fall back to Skinport min price
        const steamPrice = priceData.currentPrice;
        const effectivePrice = steamPrice === -1
          ? (priceData.skinport?.minPrice ?? 0)
          : Math.max(0, steamPrice);
        total += effectivePrice;
      }
    }

    return Math.round(total * 100) / 100;
  }

  /**
   * Compute portfolio history from a pre-built quantity map.
   * Used for combined multi-account views with cached item counts.
   */
  computePortfolioHistoryFromMap(quantityMap: Record<string, number>): PortfolioSnapshot[] {
    const timestampSet = new Set<number>();
    const priceByNameAndTime = new Map<string, Map<number, number>>();

    for (const [name, qty] of Object.entries(quantityMap)) {
      if (qty <= 0) continue;
      const priceData = this.cache.get(name);
      if (!priceData?.priceHistory?.length) continue;

      const timeMap = new Map<number, number>();
      for (const snap of priceData.priceHistory) {
        const dayMs = this.toDayTimestamp(snap.time);
        timestampSet.add(dayMs);
        timeMap.set(dayMs, snap.value);
      }
      priceByNameAndTime.set(name, timeMap);
    }

    if (timestampSet.size === 0) return [];

    const sortedDays = [...timestampSet].sort((a, b) => a - b);
    const lastPriceByName = new Map<string, number>();
    const portfolio: PortfolioSnapshot[] = [];

    for (const day of sortedDays) {
      let totalValue = 0;
      for (const [name, qty] of Object.entries(quantityMap)) {
        const timeMap = priceByNameAndTime.get(name);
        if (!timeMap) continue;
        const priceForDay = timeMap.get(day);
        if (priceForDay !== undefined) {
          lastPriceByName.set(name, priceForDay);
        }
        const price = lastPriceByName.get(name);
        if (price !== undefined) {
          totalValue += price * qty;
        }
      }
      portfolio.push({ time: day, value: Math.round(totalValue * 100) / 100 });
    }

    return portfolio;
  }

  /**
   * Compute total current value from a pre-built quantity map.
   */
  computeTotalValueFromMap(quantityMap: Record<string, number>): number {
    let total = 0;
    for (const [name, qty] of Object.entries(quantityMap)) {
      const priceData = this.cache.get(name);
      if (priceData) {
        // -1 means not listed on Steam; fall back to Skinport min price
        const steamPrice = priceData.currentPrice;
        const effectivePrice = steamPrice === -1
          ? (priceData.skinport?.minPrice ?? 0)
          : Math.max(0, steamPrice);
        total += effectivePrice * qty;
      }
    }
    return Math.round(total * 100) / 100;
  }

  // ---- Market hash name construction ----

  /**
   * Construct the Steam Community Market hash name for an item.
   * This is the name used in market listing URLs.
   */
  getMarketHashName(item: InventoryItem): string | null {
    if (!item.market_name) return null;

    const normalizedName = this.normalizeMarketName(item.market_name);
    const hasSkinSegment = normalizedName.includes('|');
    const SKIN_REQUIRED_WEAPON_TYPES = new Set(['Pistol', 'Rifle', 'SMG', 'Shotgun', 'Machinegun', 'Sniper Rifle']);
    if (!normalizedName) return null;

    // Skip non-marketable items
    if (item.marketable === false) return null;
    if (item.is_storage_unit) return null;
    if (item.weapon_type === 'Pass') return null; // Bonus Rank
    if (item.weapon_type === 'Collectible') return null; // Service medals, coins, pins
    if (item.weapon_type === 'Equipment') return null;
    if (item.defindex === 1349) return null; // Open (used) graffiti — not marketable
    if (/^Item #\d+$/i.test(normalizedName)) return null;
    if (/(medal|service coin|coin|pin)$/i.test(normalizedName)) return null;
    if (SKIN_REQUIRED_WEAPON_TYPES.has(item.weapon_type || '') && !hasSkinSegment) return null;
    if (item.origin === 0 && SKIN_REQUIRED_WEAPON_TYPES.has(item.weapon_type || '') && !hasSkinSegment) return null;

    // If we only have a base weapon name plus wear (no skin after '|'), skip pricing.
    // Example to skip: "P2000 (Field-Tested)"
    if (item.paint_wear != null && item.paint_wear > 0 && !normalizedName.includes('|')) {
      return null;
    }

    // Skins with wear need wear condition appended
    if (item.paint_wear != null && item.paint_wear > 0) {
      const wear = this.getWearCondition(item.paint_wear);
      return `${normalizedName} (${wear})`;
    }

    // Non-skin items: just the market name
    return normalizedName;
  }

  // ---- Private helpers ----

  /**
   * Quick price refresh: only calls the priceoverview API (1 request)
   * to update the current price. Does NOT scrape the listing page for history.
   * Used for items that already have recent price history.
   */
  private async fetchQuickPrice(marketHashName: string): Promise<number> {
    const currencyId = STEAM_CURRENCY_IDS[this._currency];
    const cc = CURRENCY_COUNTRY[this._currency] || 'de';
    const country = cc.toUpperCase();

    const overviewUrl = `${SCM_PRICEOVERVIEW_URL}?appid=730&currency=${currencyId}&country=${country}&cc=${cc}&market_hash_name=${encodeURIComponent(marketHashName)}`;

    const resp = await fetch(overviewUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CSInventoryPorter/1.0',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.5',
        'Cookie': `Steam_Language=english; steamCurrencyId=${currencyId}; steamCountry=${cc}`,
      },
    });

    if (resp.status === 429 || resp.status === 403) {
      throw new Error('Rate limited by Steam — try again later');
    }

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    const json = await resp.json();
    if (!json.success) {
      throw new Error('priceoverview returned success=false');
    }

    const priceStr = json.lowest_price || json.median_price;
    if (!priceStr) {
      throw new Error('No price data in priceoverview response');
    }

    const price = this.parseLocalizedPrice(priceStr);
    return this.normalizeSteamPrice(price ?? 0);
  }

  /**
   * Fetch price history for a single item from Steam Community Market.
   * Uses two approaches:
   *   1. /market/priceoverview/ API for reliable current price in the correct currency
   *   2. /market/listings/ page scraping for historical price data (var line1=)
   *
   * The priceoverview API respects the ?currency= parameter reliably.
   * The listing page's embedded line1 data may not always honor the currency param,
   * so we use priceoverview as the authoritative current price source.
   */
  private async fetchSingleItemPrice(marketHashName: string): Promise<ItemPriceData> {
    const currencyId = STEAM_CURRENCY_IDS[this._currency];
    const cc = CURRENCY_COUNTRY[this._currency] || 'de';
    const country = cc.toUpperCase();

    // --- Step 1: Get current price from priceoverview API (reliable currency) ---
    let overviewPrice: number | null = null;
    try {
      const overviewUrl = `${SCM_PRICEOVERVIEW_URL}?appid=730&currency=${currencyId}&country=${country}&cc=${cc}&market_hash_name=${encodeURIComponent(marketHashName)}`;
      const overviewResp = await fetch(overviewUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CSInventoryPorter/1.0',
          'Accept-Language': 'de-DE,de;q=0.9,en;q=0.5',
          'Cookie': `Steam_Language=english; steamCurrencyId=${currencyId}; steamCountry=${cc}`,
        },
      });

      if (overviewResp.status === 429) {
        throw new Error('Rate limited by Steam — try again later');
      }

      if (overviewResp.ok) {
        const json = await overviewResp.json();
        // json.lowest_price = "$4.30" or "3,80€"
        // json.median_price = "$4.12" or "3,62€"
        if (json.success) {
          const lowestStr = json.lowest_price || json.median_price;
          if (lowestStr) {
            overviewPrice = this.parseLocalizedPrice(lowestStr);
          }
        }
      }
    } catch (err: any) {
      // Re-throw rate limit errors
      if (err.message?.includes('Rate limited')) throw err;
      console.warn(`[PricingService] priceoverview failed for "${marketHashName}":`, err.message);
    }

    // Small delay between overview and listing requests
    await this.delay(1500);

    // --- Step 2: Scrape listing page for price history (var line1=) ---
    const url = SCM_LISTING_URL + encodeURIComponent(marketHashName) + `?currency=${currencyId}&cc=${cc}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CSInventoryPorter/1.0',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.5',
        'Cookie': `Steam_Language=english; steamCurrencyId=${currencyId}; steamCountry=${cc}`,
      },
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Rate limited by Steam — try again later');
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    // Extract the "line1" variable containing price history
    const line1Match = html.match(/var line1=(\[.+?\]);/s);
    if (!line1Match) {
      // No history — use priceoverview price or extracted current price
      const currentPrice = overviewPrice ?? this.extractCurrentPrice(html) ?? 0;
      return {
        marketHashName,
        currentPrice: this.normalizeSteamPrice(currentPrice),
        priceHistory: [],
        lastFetched: Date.now(),
      };
    }

    // Parse the embedded JSON array
    const rawSnapshots: [string, number, string][] = JSON.parse(line1Match[1]);

    const priceHistory: PriceSnapshot[] = rawSnapshots
      .slice(-MAX_HISTORY_POINTS)
      .map(([time, value, volume]) => ({
        time: Date.parse(time),
        value,
        volume: parseInt(volume, 10) || 0,
      }));

    // Current price: prefer priceoverview (guaranteed correct currency),
    // fall back to most recent history point
    const currentPrice = overviewPrice ??
      (priceHistory.length > 0 ? priceHistory[priceHistory.length - 1].value : 0);

    return {
      marketHashName,
      currentPrice: this.normalizeSteamPrice(currentPrice),
      priceHistory,
      lastFetched: Date.now(),
    };
  }

  /**
   * Try to extract current sale price from the listing page HTML.
   * Handles both USD ($12.34) and EUR (12,34€ or 1.234,56€) formatting.
   */
  private extractCurrentPrice(html: string): number | null {
    // Look for the median price in the item nameBanner
    const match = html.match(/market_listing_price_with_fee[^>]*>([^<]+)/);
    if (match) {
      const price = this.parseLocalizedPrice(match[1]);
      if (price !== null) return price;
    }
    return null;
  }

  /**
   * Parse a localized price string into a numeric value.
   * Handles formats like:
   *   $12.34       (USD)
   *   12,34€       (EUR — comma decimal)
   *   1.234,56€    (EUR — dot thousands, comma decimal)
   *   1 234,56€    (EUR — space thousands, comma decimal)
   *   --           (no price)
   */
  private parseLocalizedPrice(raw: string): number | null {
    // Remove currency symbols, whitespace, and non-breaking spaces
    let s = raw.replace(/[\s\u00A0]/g, '').replace(/[$€£¥₽R]/g, '').trim();

    if (!s || s === '--') return null;

    // Detect the format by checking position of last comma vs last dot
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');

    if (lastComma > lastDot) {
      // European format: dots are thousands separators, comma is decimal
      // e.g. "1.234,56" → remove dots, replace comma with dot
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (lastDot > lastComma) {
      // US format: commas are thousands separators, dot is decimal
      // e.g. "1,234.56" → remove commas
      s = s.replace(/,/g, '');
    } else {
      // Only one separator — could be either, but no ambiguity
      // If there's a comma, treat as decimal (common for EUR single values like "12,34")
      if (lastComma !== -1) {
        s = s.replace(',', '.');
      }
      // If only dot, leave as-is (US format)
    }

    const price = parseFloat(s);
    return isNaN(price) ? null : price;
  }

  /**
   * Get wear condition string from float value.
   */
  private getWearCondition(wear: number): string {
    for (const [threshold, name] of WEAR_RANGES) {
      if (wear < threshold || (threshold === 1.0 && wear <= threshold)) {
        return name;
      }
    }
    return 'Battle-Scarred';
  }

  /**
   * Build a map of market_hash_name → count of items with that name.
   */
  private buildItemMap(items: InventoryItem[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const item of items) {
      const name = this.getMarketHashName(item);
      if (name) {
        map.set(name, (map.get(name) ?? 0) + 1);
      }
    }
    return map;
  }

  /** Normalize a timestamp to the start of its UTC day */
  private toDayTimestamp(ms: number): number {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  /**
     * Emit progress.
     *
     * Characteristics:
     * - @param progress - The parameter for progress
     * - @returns Nothing (void)
     *
     */
    private emitProgress(progress: PricingProgress): void {
    this.emit('pricing-progress', progress);
  }

  /**
     * Upsert current price.
     *
     * Characteristics:
     * - @param marketHashName - The parameter for marketHashName
     * - @param currentPrice - The parameter for currentPrice
     * - @returns Nothing (void)
     *
     */
    private upsertCurrentPrice(marketHashName: string, currentPrice: number): void {
    const existing = this.cache.get(marketHashName);
    this.cache.set(marketHashName, {
      marketHashName,
      currentPrice: this.normalizeSteamPrice(currentPrice),
      priceHistory: existing?.priceHistory ?? [],
      lastFetched: Date.now(),
      // Prefer existing cached skinport, then fall back to SkinportService direct lookup
      skinport: existing?.skinport ?? this._skinportPrices?.get(marketHashName),
    });
  }

  /**
     * Normalize steam price.
     *
     * Characteristics:
     * - @param price - The parameter for price
     * - @returns number
     *
     */
    private normalizeSteamPrice(price: number): number {
    if (!Number.isFinite(price)) return 0;
    if (price < 0) return price; // preserve sentinel values like -1
    if (price === 0) return 0;

    const roundedUpToCent = Math.ceil(price * 100) / 100;
    if (this._currency === 'EUR') {
      return Math.max(MIN_STEAM_PRICE_EUR, roundedUpToCent);
    }
    return roundedUpToCent;
  }

  /**
     * Convert price server price.
     *
     * Characteristics:
     * - @param price - The parameter for price
     * - @param usdToEurRate - The parameter for usdToEurRate
     * - @returns number
     *
     */
    private convertPriceServerPrice(price: number, usdToEurRate: number | null): number {
    if (!Number.isFinite(price)) return 0;
    if (price < 0 || price === 0) return price;

    const converted = this._currency === 'EUR' && usdToEurRate && usdToEurRate > 0
      ? price * usdToEurRate
      : price;

    return this.normalizeSteamPrice(converted);
  }

  /**
     * Gets usd to eur rate.
     *
     * Characteristics:
     * - @returns Promise<number>
     *
     */
    private async getUsdToEurRate(): Promise<number | null> {
    const cached = this._usdToEurRateCache;
    if (cached && (Date.now() - cached.fetchedAt) < FX_RATE_TTL_MS) {
      return cached.rate;
    }

    try {
      const url = `${FRANKFURTER_LATEST_URL}?base=USD&symbols=EUR`;
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const json = await resp.json() as any;
      const rate = typeof json?.rates?.EUR === 'number' ? json.rates.EUR : null;
      if (!rate || rate <= 0) {
        throw new Error('Missing EUR rate');
      }

      this._usdToEurRateCache = { rate, fetchedAt: Date.now() };
      return rate;
    } catch (err: any) {
      console.warn(`[PricingService] Failed to fetch USD→EUR rate from Frankfurter:`, err.message);
      return null;
    }
  }

  /**
     * Normalize market name.
     *
     * Characteristics:
     * - @param name - The parameter for name
     * - @returns string
     *
     */
    private normalizeMarketName(name: string): string {
    return name
      .replace(/Ôäó/g, '™')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
     * Group names for bulk fetch.
     *
     * Characteristics:
     * - @param names - The parameter for names
     * - @returns Map<string, string[]>
     *
     */
    private groupNamesForBulkFetch(names: string[]): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const name of names) {
      const pipeIdx = name.indexOf(' | ');
      const key = pipeIdx > 0 ? name.slice(0, pipeIdx) : name;
      const arr = groups.get(key);
      if (arr) arr.push(name);
      else groups.set(key, [name]);
    }
    return groups;
  }

  /**
     * Fetches group prices.
     *
     * Characteristics:
     * - @param prefix - The parameter for prefix
     * - @param namesInGroup - The parameter for namesInGroup
     * - @param unresolved - The parameter for unresolved
     * - @returns Promise<number>
     *
     */
    private async fetchGroupPrices(prefix: string, namesInGroup: string[], unresolved: Set<string>): Promise<number> {
    const targets = new Set(namesInGroup.filter((n) => unresolved.has(n)));
    if (targets.size === 0) return 0;

    let matched = 0;
    let start = 0;
    const pageSize = 100;
    const maxPages = 4;

    for (let page = 0; page < maxPages; page++) {
      const results = await this.searchRender(prefix, pageSize, start);
      if (results.length === 0) break;

      for (const r of results) {
        if (!targets.has(r.hashName)) continue;
        this.upsertCurrentPrice(r.hashName, r.price);
        unresolved.delete(r.hashName);
        targets.delete(r.hashName);
        matched++;
      }

      if (targets.size === 0 || results.length < pageSize) break;
      start += pageSize;
      await this.delay(80);
    }

    return matched;
  }

  /**
     * Search render.
     *
     * Characteristics:
     * - @param query - The parameter for query
     * - @param count - The parameter for count
     * - @param start - The parameter for start
     * - @returns Promise<{ hashName: string; price: number; }[]>
     *
     */
    private async searchRender(query: string, count: number, start = 0): Promise<Array<{ hashName: string; price: number }>> {
    const currencyId = STEAM_CURRENCY_IDS[this._currency];
    const url = new URL(SCM_SEARCH_RENDER_URL);
    url.searchParams.set('norender', '1');
    url.searchParams.set('appid', '730');
    url.searchParams.set('currency', String(currencyId));
    url.searchParams.set('query', query);
    url.searchParams.set('start', String(start));
    url.searchParams.set('count', String(count));
    url.searchParams.set('search_descriptions', '0');
    url.searchParams.set('sort_column', 'popular');
    url.searchParams.set('sort_dir', 'desc');

    const resp = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CSInventoryPorter/1.0',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (resp.status === 429 || resp.status === 403) {
      throw new Error('Rate limited by Steam — try again later');
    }
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    const body = await resp.json() as any;
    if (body?.success !== true || !Array.isArray(body?.results)) {
      return [];
    }

    const parsed: Array<{ hashName: string; price: number }> = [];
    for (const r of body.results) {
      const hashName = typeof r?.hash_name === 'string' ? this.normalizeMarketName(r.hash_name) : '';
      const sellPriceCents = typeof r?.sell_price === 'number' ? r.sell_price : 0;
      if (!hashName || sellPriceCents <= 0) continue;
      parsed.push({ hashName, price: this.normalizeSteamPrice(sellPriceCents / 100) });
    }

    return parsed;
  }

  /**
     * Delay.
     *
     * Characteristics:
     * - @param ms - The parameter for ms
     * - @returns Promise<void>
     *
     */
    private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
     * Is transient price error.
     *
     * Characteristics:
     * - @param err - The parameter for err
     * - @returns boolean
     *
     */
    private isTransientPriceError(err: any): boolean {
    const msg = String(err?.message || '');
    if (msg.includes('Rate limited')) return true;
    if (msg.includes('HTTP 403')) return true;
    if (msg.includes('HTTP 429')) return true;
    if (/HTTP 5\d\d/.test(msg)) return true;
    if (msg.includes('fetch failed') || msg.includes('network')) return true;
    return false;
  }

  /**
   * Merge old and new price history arrays, deduplicating by day timestamp.
   * Keeps newest data when both arrays have data for the same day.
   * Trims to MAX_HISTORY_POINTS.
   */
  private mergeHistory(oldHistory: PriceSnapshot[], newHistory: PriceSnapshot[]): PriceSnapshot[] {
    const byDay = new Map<number, PriceSnapshot>();

    // Add old entries first
    for (const snap of oldHistory) {
      const dayMs = this.toDayTimestamp(snap.time);
      byDay.set(dayMs, snap);
    }

    // Overwrite/add with new entries (newer data wins)
    for (const snap of newHistory) {
      const dayMs = this.toDayTimestamp(snap.time);
      byDay.set(dayMs, snap);
    }

    // Sort chronologically and trim
    return [...byDay.values()]
      .sort((a, b) => a.time - b.time)
      .slice(-MAX_HISTORY_POINTS);
  }

  // ---- Disk cache ----

  /**
     * Loads cache from disk.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private loadCacheFromDisk(): void {
    const filePath = path.join(this.cacheDir, this.cacheFileName);
    try {
      if (!fs.existsSync(filePath)) return;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed: PriceCacheFile = JSON.parse(raw);
      // Accept both v1 and v2 cache files
      if (parsed.version !== PRICE_CACHE_VERSION && parsed.version !== 1) {
        console.log('[PricingService] Cache version mismatch, discarding');
        return;
      }
      for (const [key, entry] of Object.entries(parsed.entries)) {
        this.cache.set(key, {
          marketHashName: entry.marketHashName,
          currentPrice: entry.currentPrice,
          // Trim old history on load to prevent unbounded memory growth
          priceHistory: entry.priceHistory.slice(-MAX_HISTORY_POINTS),
          lastFetched: entry.lastFetched,
          skinport: entry.skinport,
        });

        // Restore history fetch timestamps
        if (entry.lastHistoryFetch) {
          this.historyFetchTimes.set(key, entry.lastHistoryFetch);
        } else if (entry.priceHistory.length > 0) {
          // Migration: for legacy cache entries without lastHistoryFetch,
          // assume history was scraped at lastFetched time
          this.historyFetchTimes.set(key, entry.lastFetched);
        }
      }
      console.log(`[PricingService] Loaded ${this.cache.size} cached prices from disk (currency=${this._currency})`);
    } catch (err: any) {
      console.warn('[PricingService] Failed to load price cache:', err.message);
    }
  }

  /**
     * Save cache to disk.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private saveCacheToDisk(): void {
    const filePath = path.join(this.cacheDir, this.cacheFileName);
    try {
      const entries: Record<string, PriceCacheEntry> = {};
      for (const [key, value] of this.cache) {
        entries[key] = {
          marketHashName: value.marketHashName,
          currentPrice: value.currentPrice,
          priceHistory: value.priceHistory,
          lastFetched: value.lastFetched,
          lastHistoryFetch: this.historyFetchTimes.get(key),
          skinport: value.skinport,
        };
      }
      const data: PriceCacheFile = { version: PRICE_CACHE_VERSION, currency: this._currency, entries };
      fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
    } catch (err: any) {
      console.warn('[PricingService] Failed to save price cache:', err.message);
    }
  }
}
