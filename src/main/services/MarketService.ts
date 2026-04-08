// ============================================================
// CSInventoryPorter — MarketService
// Handles Steam Community Market operations:
//   - List items for sale
//   - Fetch active listings
//   - Remove (delist) items
//   - Fee calculations (Valve 5% + CS2 10%)
// ============================================================

import { EventEmitter } from 'events';
import type { SteamService } from './SteamService';
import type {
  MarketListing,
  ListItemRequest,
  MarketFeeBreakdown,
  MarketProgress,
} from '../../shared/types';
import { CS2_APP_ID } from '../../shared/constants';

// ---- Configuration ----

/** Delay between sequential market operations (ms) */
const MARKET_OP_DELAY_MS = 2000;

/** Steam Community Market endpoints */
const MARKET_BASE = 'https://steamcommunity.com/market';

/** Context ID for CS2 items (always 2 for game items) */
const CS2_CONTEXT_ID = 2;

// ---- Fee calculation ----

/**
 * Calculate Steam Community Market fees.
 *
 * Steam takes 5% (min $0.01 = 1 cent) as the Steam Transaction Fee.
 * CS2 takes an additional 10% (min $0.01 = 1 cent) as the Game Fee.
 *
 * The buyer pays: youReceive + steamFee + gameFee
 * The seller receives: buyerPays - steamFee - gameFee
 */
export function calculateFees(youReceiveCents: number): MarketFeeBreakdown {
  // Valve fee: 5% of buyer amount, minimum 1 cent
  const steamFee = Math.max(1, Math.floor(youReceiveCents * 0.05));
  // CS2 game fee: 10% of buyer amount, minimum 1 cent
  const gameFee = Math.max(1, Math.floor(youReceiveCents * 0.10));

  const buyerPays = youReceiveCents + steamFee + gameFee;

  return {
    buyerPays,
    steamFee,
    gameFee,
    youReceive: youReceiveCents,
  };
}

/**
 * Reverse fee calculation: given what the buyer pays, what does the seller get?
 */
export function calculateFromBuyerPrice(buyerPaysCents: number): MarketFeeBreakdown {
  // Steam fee: floor(buyerPays / 1.15 * 0.05), min 1
  // Game fee: floor(buyerPays / 1.15 * 0.10), min 1
  const base = buyerPaysCents / 1.15;
  const steamFee = Math.max(1, Math.floor(base * 0.05));
  const gameFee = Math.max(1, Math.floor(base * 0.10));
  const youReceive = buyerPaysCents - steamFee - gameFee;

  return {
    buyerPays: buyerPaysCents,
    steamFee,
    gameFee,
    youReceive: Math.max(1, youReceive),
  };
}

// ---- Service ----

export class MarketService extends EventEmitter {
  private steam: SteamService;
  private _listings: MarketListing[] = [];
  private _cancelled = false;
  private _busy = false;

  constructor(steam: SteamService) {
    super();
    this.steam = steam;
  }

  get listings(): MarketListing[] {
    return this._listings;
  }

  get isBusy(): boolean {
    return this._busy;
  }

  // ---- Public API ----

  /**
   * Fetch the user's active market listings from Steam.
   * Returns the parsed listings array.
   */
  async fetchMyListings(): Promise<MarketListing[]> {
    this.ensureWebSession();

    this.emitProgress({ state: 'loading', message: 'Loading active listings...' });

    try {
      const steamID = this.steam.steamClient.steamID?.getSteamID64();
      if (!steamID) throw new Error('Not logged in');

      // Steam market mylistings endpoint returns JSON with listing data
      const url = `${MARKET_BASE}/mylistings?norender=1&count=100`;
      let response = await fetch(url, {
        headers: this.buildHeaders(),
      });

      if (response.status === 403) {
        await this.delay(1200);
        response = await fetch(url, {
          headers: this.buildHeaders(),
        });
      }

      if (!response.ok) {
        if (response.status === 403) {
          const message = 'Steam temporarily denied listings access (403). Using cached listings.';
          this.emitProgress({ state: 'error', message });
          return this._listings;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as any;

      // Parse listings from the JSON response
      this._listings = this.parseListingsResponse(data);

      this.emitProgress({ state: 'idle' });
      this.emit('listings-updated', this._listings);

      return this._listings;
    } catch (err: any) {
      console.error('[MarketService] Failed to fetch listings:', err.message);
      this.emitProgress({ state: 'error', message: err.message });
      throw err;
    }
  }

  /**
   * List a single item for sale on the Steam Community Market.
   * @param assetId The asset ID of the item in the inventory
   * @param priceInCents The price the seller wants to receive (in cents)
   */
  async listItem(assetId: string, priceInCents: number): Promise<{ success: boolean; listingId?: string; error?: string; requiresConfirmation?: boolean }> {
    this.ensureWebSession();

    if (priceInCents < 1) {
      return { success: false, error: 'Price must be at least 1 cent' };
    }

    const fees = calculateFees(priceInCents);

    this.emitProgress({ state: 'listing', message: `Listing item for ${(fees.buyerPays / 100).toFixed(2)}...` });

    try {
      const sessionId = this.steam.webSessionID;

      const formData = new URLSearchParams({
        sessionid: sessionId!,
        appid: CS2_APP_ID.toString(),
        contextid: CS2_CONTEXT_ID.toString(),
        assetid: assetId,
        amount: '1',
        price: priceInCents.toString(), // What the seller receives (in cents)
      });

      const response = await fetch(`${MARKET_BASE}/sellitem/`, {
        method: 'POST',
        headers: {
          ...this.buildHeaders(),
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `https://steamcommunity.com/profiles/${this.steam.steamClient.steamID?.getSteamID64()}/inventory`,
        },
        body: formData.toString(),
      });

      const result = await response.json() as any;

      if (result.success) {
        console.log(`[MarketService] Listed item ${assetId} for ${fees.buyerPays} cents (buyer pays)`);
        this.emitProgress({ state: 'idle' });

        // Check if mobile confirmation is needed
        const requiresConfirmation = result.requires_confirmation === true || result.needs_mobile_confirmation === true;

        return {
          success: true,
          listingId: result.listing_id?.toString(),
          requiresConfirmation,
        };
      } else {
        const errorMsg = result.message || 'Failed to list item';
        console.warn(`[MarketService] List failed: ${errorMsg}`);
        this.emitProgress({ state: 'error', message: errorMsg });
        return { success: false, error: errorMsg };
      }
    } catch (err: any) {
      console.error('[MarketService] List item error:', err.message);
      this.emitProgress({ state: 'error', message: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * List multiple items for sale sequentially with rate limiting.
   */
  async listMultipleItems(requests: ListItemRequest[]): Promise<{ succeeded: number; failed: number; errors: string[] }> {
    this.ensureWebSession();

    if (this._busy) {
      return { succeeded: 0, failed: 0, errors: ['A market operation is already in progress'] };
    }

    this._busy = true;
    this._cancelled = false;

    const total = requests.length;
    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    this.emitProgress({ state: 'listing', message: `Listing ${total} items...`, current: 0, total });

    for (let i = 0; i < requests.length; i++) {
      if (this._cancelled) {
        this.emitProgress({ state: 'idle', message: 'Cancelled' });
        break;
      }

      const req = requests[i];
      this.emitProgress({
        state: 'listing',
        message: `Listing item ${i + 1} of ${total}...`,
        current: i,
        total,
      });

      const result = await this.listItem(req.assetId, req.priceInCents);

      if (result.success) {
        succeeded++;
      } else {
        failed++;
        errors.push(result.error || 'Unknown error');
      }

      // Rate limit between requests
      if (i < requests.length - 1 && !this._cancelled) {
        await this.delay(MARKET_OP_DELAY_MS);
      }
    }

    this._busy = false;
    this.emitProgress({ state: 'idle', message: `Listed ${succeeded}/${total} items`, current: total, total });

    // Refresh listings after batch operation
    try {
      await this.delay(1000);
      await this.fetchMyListings();
    } catch { /* ignore */ }

    return { succeeded, failed, errors };
  }

  /**
   * Remove a single listing from the market.
   */
  async delistItem(listingId: string): Promise<{ success: boolean; error?: string }> {
    this.ensureWebSession();

    this.emitProgress({ state: 'delisting', message: 'Removing listing...' });

    try {
      const sessionId = this.steam.webSessionID;

      const formData = new URLSearchParams({
        sessionid: sessionId!,
      });

      const response = await fetch(`${MARKET_BASE}/removelisting/${listingId}`, {
        method: 'POST',
        headers: {
          ...this.buildHeaders(),
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${MARKET_BASE}/`,
        },
        body: formData.toString(),
      });

      // Steam returns empty body with 200 on success
      if (response.ok) {
        console.log(`[MarketService] Delisted listing ${listingId}`);

        // Remove from local cache
        this._listings = this._listings.filter((l) => l.listingId !== listingId);
        this.emit('listings-updated', this._listings);
        this.emitProgress({ state: 'idle' });
        return { success: true };
      } else {
        const text = await response.text();
        const errorMsg = `HTTP ${response.status}: ${text.substring(0, 200)}`;
        console.warn(`[MarketService] Delist failed: ${errorMsg}`);
        this.emitProgress({ state: 'error', message: errorMsg });
        return { success: false, error: errorMsg };
      }
    } catch (err: any) {
      console.error('[MarketService] Delist error:', err.message);
      this.emitProgress({ state: 'error', message: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Remove all active listings sequentially.
   */
  async delistAll(): Promise<{ succeeded: number; failed: number }> {
    this.ensureWebSession();

    if (this._busy) {
      return { succeeded: 0, failed: 0 };
    }

    this._busy = true;
    this._cancelled = false;

    // Refresh listings first to make sure we have the current set
    try {
      await this.fetchMyListings();
    } catch { /* continue with cached */ }

    const activeListings = this._listings.filter((l) => l.status === 'active');
    const total = activeListings.length;
    let succeeded = 0;
    let failed = 0;

    this.emitProgress({ state: 'delisting', message: `Removing ${total} listings...`, current: 0, total });

    for (let i = 0; i < activeListings.length; i++) {
      if (this._cancelled) {
        break;
      }

      this.emitProgress({
        state: 'delisting',
        message: `Removing listing ${i + 1} of ${total}...`,
        current: i,
        total,
      });

      const result = await this.delistItem(activeListings[i].listingId);

      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }

      if (i < activeListings.length - 1 && !this._cancelled) {
        await this.delay(MARKET_OP_DELAY_MS);
      }
    }

    this._busy = false;
    this.emitProgress({ state: 'idle', message: `Removed ${succeeded}/${total} listings`, current: total, total });

    return { succeeded, failed };
  }

  /** Cancel an in-progress market operation */
  cancel(): void {
    this._cancelled = true;
  }

  // ---- Private helpers ----

  /**
     * Ensure web session.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private ensureWebSession(): void {
    if (!this.steam.webSessionID || !this.steam.webCookies.length) {
      throw new Error('No web session available - please wait for login to complete');
    }
  }

  /**
     * Build headers.
     *
     * Characteristics:
     * - @returns Record<string, string>
     *
     */
    private buildHeaders(): Record<string, string> {
    return {
      'Cookie': this.steam.cookieHeader,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CSInventoryPorter/1.0',
      'Accept': 'application/json, text/javascript, */*',
      'Accept-Language': 'en-US,en;q=0.9',
    };
  }

  /**
   * Parse Steam's mylistings JSON response into our MarketListing format.
   */
  private parseListingsResponse(data: any): MarketListing[] {
    const listings: MarketListing[] = [];

    if (!data?.listings_on_hold && !data?.listings_to_confirm && !data?.listings) {
      // Try the "active" format
      if (data?.results_html) {
        // HTML-based response — try to extract from assets + listings arrays
        return this.parseListingsFromAssets(data);
      }
      return listings;
    }

    // Parse active listings
    const allListings = [
      ...(data.listings || []).map((l: any) => ({ ...l, _sourceArray: 'active' as const })),
      ...(data.listings_on_hold || []).map((l: any) => ({ ...l, _sourceArray: 'on_hold' as const })),
      ...(data.listings_to_confirm || []).map((l: any) => ({ ...l, _sourceArray: 'to_confirm' as const })),
    ];

    // Build asset lookup map
    const assetMap = new Map<string, any>();
    if (data.assets?.[CS2_APP_ID.toString()]?.['2']) {
      for (const [assetId, assetData] of Object.entries(data.assets[CS2_APP_ID.toString()]['2'])) {
        assetMap.set(assetId, assetData);
      }
    }

    for (const listing of allListings) {
      const listingId = listing.listingid?.toString();
      if (!listingId) continue;

      const assetInfo = listing.asset;
      const assetId = assetInfo?.id?.toString() || assetInfo?.assetid?.toString() || '';

      // Get asset details for market hash name and image
      const asset = assetMap.get(assetId);
      const marketHashName = asset?.market_hash_name || listing.description?.market_hash_name || '';
      const iconUrl = asset?.icon_url || listing.description?.icon_url || '';
      const imageUrl = iconUrl
        ? `https://community.akamai.steamstatic.com/economy/image/${iconUrl}/330x192`
        : undefined;

      // Determine status
      let status: MarketListing['status'] = 'active';
      if (listing._sourceArray === 'on_hold' || listing._sourceArray === 'to_confirm') {
        status = 'pending';
      } else if (listing.status === 14) {
        status = 'pending'; // Awaiting confirmation
      }

      // Parse price — Steam provides price in lowest denomination (cents)
      const buyerPays = listing.price + (listing.fee || 0);
      const youReceive = listing.price || 0;

      // Trade hold: use Steam's actual confirmation/escrow data if available
      // Don't assume 7-day hold; items already listed may have no hold
      const listedAt = (listing.time_created || 0) * 1000;
      const tradeHoldExpires = listing.time_escrow_end
        ? listing.time_escrow_end * 1000
        : undefined;

      listings.push({
        listingId,
        assetId,
        marketHashName,
        image_url: imageUrl,
        buyerPays,
        youReceive,
        status,
        listedAt,
        tradeHoldExpires,
      });
    }

    return listings;
  }

  /**
   * Fallback parser for mylistings response that uses the assets structure.
   */
  private parseListingsFromAssets(data: any): MarketListing[] {
    const listings: MarketListing[] = [];

    // If we have num_active_listings but no structured data, return empty
    // The user can retry or the HTML would need parsing
    if (data.total_count !== undefined) {
      console.log(`[MarketService] Found ${data.total_count} total listings`);
    }

    return listings;
  }

  /**
     * Emit progress.
     *
     * Characteristics:
     * - @param progress - The parameter for progress
     * - @returns Nothing (void)
     *
     */
    private emitProgress(progress: MarketProgress): void {
    this.emit('market-progress', progress);
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
}
