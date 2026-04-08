// ============================================================
// CSInventoryPorter — ExchangeRateService
// Fetches and caches exchange rates from exchangerate-api.com
// ============================================================

import fs from 'fs';
import path from 'path';
import type { ExchangeRates } from '../../shared/types';
import type { LegacyCurrencyCode } from '../../shared/constants';

const API_URL = 'https://api.frankfurter.dev/v1/latest?base=USD';

/** Cache exchange rates for 12 hours */
const RATE_TTL_MS = 12 * 60 * 60 * 1000;

const CACHE_FILENAME = 'exchange-rates.json';

export class ExchangeRateService {
  private rates: ExchangeRates | null = null;
  private cacheFilePath: string;

  constructor(userDataPath: string) {
    this.cacheFilePath = path.join(userDataPath, CACHE_FILENAME);
    this.loadFromDisk();
  }

  /** Get cached exchange rates, fetching fresh ones if stale/missing */
  async getRates(): Promise<ExchangeRates | null> {
    if (this.rates && Date.now() - this.rates.lastFetched < RATE_TTL_MS) {
      return this.rates;
    }

    try {
      await this.fetchRates();
    } catch (err: any) {
      console.warn('[ExchangeRateService] Failed to fetch rates:', err.message);
    }

    return this.rates;
  }

  /**
   * Convert an amount from one currency to another.
   * Returns the converted amount, or the original amount if conversion fails.
   * Only USD->EUR is supported for legacy investment conversion.
   */
  async convert(amount: number, from: LegacyCurrencyCode, to: 'EUR'): Promise<number> {
    if (from === to) return amount;
    if (to !== 'EUR') {
      throw new Error('Only conversion to EUR is supported');
    }

    const rates = await this.getRates();
    if (!rates) return amount; // Fallback: no conversion

    if (from === 'EUR') return amount;

    const eurRate = rates.rates['EUR'];
    if (!eurRate) return amount;

    return Math.round(amount * eurRate * 100) / 100;
  }

  /**
   * Get the conversion rate between two currencies.
   * Returns 1 if conversion rate is unavailable.
   */
  async getRate(from: LegacyCurrencyCode, to: 'EUR'): Promise<number> {
    if (from === to) return 1;
    if (to !== 'EUR') {
      throw new Error('Only conversion to EUR is supported');
    }

    const rates = await this.getRates();
    if (!rates) return 1;

    if (from === 'EUR') return 1;

    const eurRate = rates.rates['EUR'];
    if (!eurRate) return 1;

    return eurRate;
  }

  // ---- Private ----

  /**
     * Fetches rates.
     *
     * Characteristics:
     * - @returns Promise<void>
     *
     */
    private async fetchRates(): Promise<void> {
    console.log('[ExchangeRateService] Fetching fresh exchange rates...');
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const json = await response.json();

    if (!json.rates) {
      throw new Error('Unexpected API response format');
    }

    this.rates = {
      base: 'USD',
      rates: { ...json.rates, USD: 1 },
      lastFetched: Date.now(),
    };

    this.saveToDisk();
    console.log(`[ExchangeRateService] Fetched ${Object.keys(this.rates.rates).length} exchange rates (EUR=${this.rates.rates['EUR']})`);
  }

  /**
     * Loads from disk.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.cacheFilePath)) return;
      const raw = fs.readFileSync(this.cacheFilePath, 'utf-8');
      const data: ExchangeRates = JSON.parse(raw);
      if (data.rates && data.lastFetched) {
        this.rates = data;
        console.log(`[ExchangeRateService] Loaded cached rates (age: ${Math.round((Date.now() - data.lastFetched) / 60000)}min)`);
      }
    } catch (err: any) {
      console.warn('[ExchangeRateService] Failed to load cached rates:', err.message);
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
    try {
      if (this.rates) {
        fs.writeFileSync(this.cacheFilePath, JSON.stringify(this.rates), 'utf-8');
      }
    } catch (err: any) {
      console.warn('[ExchangeRateService] Failed to save rates cache:', err.message);
    }
  }
}
