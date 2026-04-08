import type { PriceSnapshot, PriceServerConfig, SkinportPriceData } from '../../../shared/types';

export interface ExternalPriceRecord {
  marketHashName: string;
  currentPrice: number;
  priceHistory: PriceSnapshot[];
  lastFetched?: number;
  skinport?: SkinportPriceData;
}

export interface ExternalPriceFetchResult {
  totalScanned: number;
  records: Map<string, ExternalPriceRecord>;
}

export interface ExternalPriceProvider {
  testConnection(config: PriceServerConfig): Promise<{ success: boolean; totalPrices?: number; latencyMs?: number; error?: string }>;
  fetchPrices(names: string[], config: PriceServerConfig): Promise<ExternalPriceFetchResult>;
  queueMissing(names: string[], config: PriceServerConfig): Promise<void>;
}

/**
 * Default HTTP provider for the built-in CSInventoryPorter price server.
 *
 * To integrate another external pricing system, implement ExternalPriceProvider
 * and inject it into PricingService via setExternalPriceProvider().
 */
export class HttpPriceServerProvider implements ExternalPriceProvider {
  /**
     * Test connection.
     *
     * Characteristics:
     * - @param config - The parameter for config
     * - @returns Promise<{ success: boolean; totalPrices?: number; latencyMs?: number; error?: string; }>
     *
     */
    async testConnection(config: PriceServerConfig): Promise<{ success: boolean; totalPrices?: number; latencyMs?: number; error?: string }> {
    const start = Date.now();
    try {
      const baseUrl = this.normalizeUrl(config.url);
      const statusUrl = this.withApiKeyQuery(`${baseUrl}/api/status`, config.apiKey);
      const headers = this.buildHeaders(config.apiKey);

      const resp = await fetch(statusUrl, { headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json() as any;
      return {
        success: true,
        totalPrices: data.totalPrices ?? 0,
        latencyMs: Date.now() - start,
      };
    } catch (err: any) {
      return { success: false, error: err.message, latencyMs: Date.now() - start };
    }
  }

  /**
     * Fetches prices.
     *
     * Characteristics:
     * - @param names - The parameter for names
     * - @param config - The parameter for config
     * - @returns Promise<import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/main/services/pricing/ExternalPriceProvider").ExternalPriceFetchResult>
     *
     */
    async fetchPrices(names: string[], config: PriceServerConfig): Promise<ExternalPriceFetchResult> {
    const records = new Map<string, ExternalPriceRecord>();
    const nameSet = new Set(names);
    const baseUrl = this.normalizeUrl(config.url);
    const headers = this.buildHeaders(config.apiKey);

    const pageSize = 500;
    let offset = 0;
    let hasMore = true;
    let totalScanned = 0;

    while (hasMore) {
      const allUrl = this.withApiKeyQuery(
        `${baseUrl}/api/prices/current/all?limit=${pageSize}&offset=${offset}`,
        config.apiKey,
      );

      const resp = await fetch(allUrl, { headers });
      if (!resp.ok) {
        throw new Error(`/api/prices/current/all returned HTTP ${resp.status}`);
      }

      const data = await resp.json() as any;
      const items: any[] = Array.isArray(data.items) ? data.items : [];
      hasMore = !!data.hasMore;
      offset += pageSize;
      totalScanned += items.length;

      for (const pd of items) {
        const name = typeof pd?.marketHashName === 'string' ? pd.marketHashName : '';
        if (!name || !nameSet.has(name)) continue;

        records.set(name, {
          marketHashName: name,
          currentPrice: typeof pd.currentPrice === 'number' ? pd.currentPrice : 0,
          priceHistory: Array.isArray(pd.priceHistory) ? pd.priceHistory : [],
          lastFetched: typeof pd.lastFetched === 'number' ? pd.lastFetched : undefined,
          skinport: pd.skinport && typeof pd.skinport === 'object' ? pd.skinport : undefined,
        });
      }

      if (items.length === 0) break;
    }

    // Some deployments omit skinport in /all response; enrich per-name for missing ones.
    const needSkinport = [...records.keys()].filter((name) => !records.get(name)?.skinport);
    if (needSkinport.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < needSkinport.length; i += batchSize) {
        const batch = needSkinport.slice(i, i + batchSize);
        const encodedNames = batch.map((n) => encodeURIComponent(n)).join(',');
        const url = this.withApiKeyQuery(`${baseUrl}/api/prices/current?names=${encodedNames}`, config.apiKey);

        try {
          const r = await fetch(url, { headers });
          if (!r.ok) continue;

          const d = await r.json() as any;
          for (const [name, pd] of Object.entries(d.prices ?? {})) {
            const existing = records.get(name);
            if (!existing || !(pd as any)?.skinport) continue;
            existing.skinport = (pd as any).skinport;
            records.set(name, existing);
          }
        } catch {
          // Non-critical enrichment failure.
        }
      }
    }

    return { totalScanned, records };
  }

  /**
     * Queue missing.
     *
     * Characteristics:
     * - @param names - The parameter for names
     * - @param config - The parameter for config
     * - @returns Promise<void>
     *
     */
    async queueMissing(names: string[], config: PriceServerConfig): Promise<void> {
    if (!names.length) return;

    const baseUrl = this.normalizeUrl(config.url);
    const headers = this.buildHeaders(config.apiKey);

    await fetch(this.withApiKeyQuery(`${baseUrl}/api/prices/request`, config.apiKey), {
      method: 'POST',
      headers,
      body: JSON.stringify({ names, priority: 5 }),
    });
  }

  /**
     * Normalize url.
     *
     * Characteristics:
     * - @param url - The parameter for url
     * - @returns string
     *
     */
    private normalizeUrl(url: string): string {
    return String(url || '').trim().replace(/\/+$/, '');
  }

  /**
     * Build headers.
     *
     * Characteristics:
     * - @param apiKey - The parameter for apiKey
     * - @returns Record<string, string>
     *
     */
    private buildHeaders(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey && apiKey.trim()) {
      headers['x-api-key'] = apiKey.trim();
    }
    return headers;
  }

  /**
     * With api key query.
     *
     * Characteristics:
     * - @param url - The parameter for url
     * - @param apiKey - The parameter for apiKey
     * - @returns string
     *
     */
    private withApiKeyQuery(url: string, apiKey?: string): string {
    if (!apiKey || !apiKey.trim()) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}key=${encodeURIComponent(apiKey.trim())}`;
  }
}
