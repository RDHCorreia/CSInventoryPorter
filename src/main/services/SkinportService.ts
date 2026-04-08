
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import https from 'https';
import type { SkinportPriceData } from '../../shared/types';

const SKINPORT_API_URL = 'https://api.skinport.com/v1/items?app_id=730&currency=EUR';
const CACHE_FILE = 'skinport-cache.json';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface SkinportCacheFile {
  fetchedAt: number;
  items: Record<string, SkinportPriceData>; // marketHashName → price data
}

export class SkinportService {
  private cacheDir: string;
  private cache = new Map<string, SkinportPriceData>();
  private lastFetchedAt = 0;
  private fetchPromise: Promise<void> | null = null;

  constructor(userDataPath: string) {
    this.cacheDir = userDataPath;
    this.loadFromDisk();
  }

  /** Returns cached Skinport price for an item, or undefined if not available. */
  getPrice(marketHashName: string): SkinportPriceData | undefined {
    return this.cache.get(marketHashName);
  }

  /** Returns the full cache map (read-only reference). */
  getAllPrices(): Map<string, SkinportPriceData> {
    return this.cache;
  }

  get itemCount(): number {
    return this.cache.size;
  }

  /**
   * Fetch all Skinport prices. Deduplicates concurrent calls.
   * Uses disk cache if fresh (< 6h old). Call once on app startup.
   */
  async fetchAll(): Promise<void> {
    if (this.cache.size > 0 && Date.now() - this.lastFetchedAt < CACHE_TTL_MS) {
      console.log(`[SkinportService] Using cached Skinport prices (${this.cache.size} items, age ${Math.round((Date.now() - this.lastFetchedAt) / 60000)}min)`);
      return;
    }

    if (this.fetchPromise) return this.fetchPromise;

    this.fetchPromise = this._doFetch().finally(() => {
      this.fetchPromise = null;
    });
    return this.fetchPromise;
  }

  /**
     * _do fetch.
     *
     * Characteristics:
     * - @returns Promise<void>
     *
     */
    private async _doFetch(): Promise<void> {
    console.log('[SkinportService] Fetching all prices from Skinport public API...');
    try {
      const raw = await this.httpGet(SKINPORT_API_URL);
      const items: any[] = JSON.parse(raw);

      const now = Date.now();
      const newCache = new Map<string, SkinportPriceData>();

      for (const item of items) {
        const name: string = item.market_hash_name;
        if (!name) continue;
        newCache.set(name, {
          minPrice: typeof item.min_price === 'number' ? item.min_price : null,
          maxPrice: typeof item.max_price === 'number' ? item.max_price : null,
          meanPrice: typeof item.mean_price === 'number' ? item.mean_price : null,
          medianPrice: typeof item.median_price === 'number' ? item.median_price : null,
          quantity: typeof item.quantity === 'number' ? item.quantity : 0,
          currency: 'EUR',
          lastFetched: now,
        });
      }

      this.cache = newCache;
      this.lastFetchedAt = now;
      console.log(`[SkinportService] Loaded ${this.cache.size} Skinport prices`);
      this.saveToDisk();
    } catch (err: any) {
      console.warn('[SkinportService] Failed to fetch from Skinport API:', err.message);
    }
  }

  /**
     * Http get.
     *
     * Characteristics:
     * - @param url - The parameter for url
     * - @returns Promise<string>
     *
     */
    private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'br, gzip, deflate',
          'User-Agent': 'CSInventoryPorter/1.0',
        },
      };

      https.get(options, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const encoding = res.headers['content-encoding'];
        let stream: NodeJS.ReadableStream = res;
        if (encoding === 'br') {
          stream = res.pipe(zlib.createBrotliDecompress());
        } else if (encoding === 'gzip') {
          stream = res.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
          stream = res.pipe(zlib.createInflate());
        }

        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        stream.on('error', reject);
      }).on('error', reject);
    });
  }

  /**
     * Loads from disk.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private loadFromDisk(): void {
    const filePath = path.join(this.cacheDir, CACHE_FILE);
    try {
      if (!fs.existsSync(filePath)) return;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed: SkinportCacheFile = JSON.parse(raw);
      const age = Date.now() - (parsed.fetchedAt ?? 0);
      if (age > CACHE_TTL_MS * 2) {
        console.log('[SkinportService] Disk cache too old, will refresh on next fetch');
        return;
      }
      for (const [name, data] of Object.entries(parsed.items ?? {})) {
        this.cache.set(name, data);
      }
      this.lastFetchedAt = parsed.fetchedAt ?? 0;
      console.log(`[SkinportService] Loaded ${this.cache.size} Skinport prices from disk cache (age ${Math.round(age / 60000)}min)`);
    } catch (err: any) {
      console.warn('[SkinportService] Failed to load Skinport cache from disk:', err.message);
    }
  }

  /**
     * Save to disk.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private saveToDisk(): void {
    const filePath = path.join(this.cacheDir, CACHE_FILE);
    try {
      const items: Record<string, SkinportPriceData> = {};
      for (const [name, data] of this.cache) {
        items[name] = data;
      }
      const payload: SkinportCacheFile = { fetchedAt: this.lastFetchedAt, items };
      fs.writeFileSync(filePath, JSON.stringify(payload), 'utf-8');
    } catch (err: any) {
      console.warn('[SkinportService] Failed to save Skinport cache to disk:', err.message);
    }
  }
}
