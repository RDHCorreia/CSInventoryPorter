// ============================================================
// CSInventoryPorter — InventoryService
// Manages CS2 inventory data from the Game Coordinator
// ============================================================

import { EventEmitter } from 'events';
import type GlobalOffensive from 'globaloffensive';
import {
  type InventoryItem,
  type StorageUnit,
  type InventoryData,
  type InventoryLoadState,
  type StickerInfo,
  type CharmInfo,
  type CasketOperation,
  type BulkOperationProgress,
} from '../../shared/types';
import { STORAGE_UNIT_DEFINDEX, CASKET_OPERATION_DELAY_MS, STEAM_CDN_IMAGE_BASE } from '../../shared/constants';
import { ItemDataService } from './ItemDataService';
import { WEAPON_DEFS, RARITY_INFO } from '../../shared/cs2-item-data';

export interface InventoryServiceEvents {
  'inventory-updated': (data: InventoryData) => void;
  'casket-contents-loaded': (casketId: string, items: InventoryItem[]) => void;
  'error': (error: Error) => void;
}

export class InventoryService extends EventEmitter {
  private csgo: GlobalOffensive | null = null;
  private _items: Map<string, InventoryItem> = new Map();
  private _storageUnits: Map<string, StorageUnit> = new Map();
  private _state: InventoryLoadState = 'idle';
  private _error: string | undefined;
  private _casketContentsCallbacks: Map<string, (items: InventoryItem[]) => void> = new Map();
  private _itemData: ItemDataService | null = null;
  private _bulkCancelled = false;
  private _boundHandlers: {
    itemAcquired?: (...args: any[]) => void;
    itemRemoved?: (...args: any[]) => void;
    itemChanged?: (...args: any[]) => void;
  } = {};

  // ---- Cached data snapshot (avoids re-creating arrays on every emit) ----
  private _cachedItems: InventoryItem[] | null = null;
  private _cachedUnits: StorageUnit[] | null = null;
  private _dirty = true;

  /** Invalidate cached arrays so the next inventoryData read rebuilds them */
  private invalidateCache(): void {
    this._dirty = true;
    this._cachedItems = null;
    this._cachedUnits = null;
  }

  // ---- Getters ----

  get state(): InventoryLoadState {
    return this._state;
  }

  get items(): InventoryItem[] {
    if (this._dirty || !this._cachedItems) {
      this._cachedItems = Array.from(this._items.values());
    }
    return this._cachedItems;
  }

  get storageUnits(): StorageUnit[] {
    if (this._dirty || !this._cachedUnits) {
      this._cachedUnits = Array.from(this._storageUnits.values());
    }
    return this._cachedUnits;
  }

  get inventoryData(): InventoryData {
    if (this._dirty) {
      this._cachedItems = Array.from(this._items.values());
      this._cachedUnits = Array.from(this._storageUnits.values());
      this._dirty = false;
    }
    return {
      state: this._state,
      items: this._cachedItems!,
      storageUnits: this._cachedUnits!,
      totalItems: this._items.size,
      error: this._error,
    };
  }

  /** Attach an ItemDataService for name/image resolution */
  setItemDataService(service: ItemDataService): void {
    this._itemData = service;
  }

  // ---- Attach / detach from GC client ----

  /**
     * Attach to g c.
     *
     * Characteristics:
     * - @param csgo - The parameter for csgo
     * - @returns Nothing (void)
     *
     */
    attachToGC(csgo: GlobalOffensive): void {
    this.detachFromGC();
    this.csgo = csgo;
    this.setupGCListeners();
  }

  /**
     * Detach from g c.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    detachFromGC(): void {
    if (this.csgo && this._boundHandlers.itemAcquired) {
      this.csgo.removeListener('itemAcquired', this._boundHandlers.itemAcquired);
      this.csgo.removeListener('itemRemoved', this._boundHandlers.itemRemoved!);
      this.csgo.removeListener('itemChanged', this._boundHandlers.itemChanged!);
    }
    this._boundHandlers = {};
    this.csgo = null;
  }

  /**
     * Setup g c listeners.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private setupGCListeners(): void {
    if (!this.csgo) return;

    this._boundHandlers.itemAcquired = (item: any) => {
      const parsed = this.parseItem(item);

      // Don't add items that belong inside a storage unit
      if (parsed.casket_id) {
        return;
      }

      this._items.set(parsed.id, parsed);
      this.invalidateCache();

      if (parsed.is_storage_unit) {
        this.upsertStorageUnit(parsed);
      }

      this.emitUpdate();
    };

    this._boundHandlers.itemRemoved = (item: any) => {
      const id = String(item.id ?? item);
      this._items.delete(id);
      this._storageUnits.delete(id);
      this.invalidateCache();
      this.emitUpdate();
    };

    this._boundHandlers.itemChanged = (item: any) => {
      const parsed = this.parseItem(item);
      this._items.set(parsed.id, parsed);
      this.invalidateCache();

      if (parsed.is_storage_unit) {
        this.upsertStorageUnit(parsed);
      }

      this.emitUpdate();
    };

    this.csgo.on('itemAcquired', this._boundHandlers.itemAcquired);
    this.csgo.on('itemRemoved', this._boundHandlers.itemRemoved);
    this.csgo.on('itemChanged', this._boundHandlers.itemChanged);
  }

  // ---- Load full inventory ----

  /**
     * Loads inventory.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    loadInventory(): void {
    if (!this.csgo) {
      this._error = 'Not connected to Game Coordinator';
      this._state = 'error';
      this.emitUpdateNow();
      return;
    }

    console.log('[InventoryService] Loading inventory from GC...');
    this._state = 'loading';
    this._error = undefined;
    this.emitUpdateNow();

    // The globaloffensive library exposes inventory via csgo.inventory
    // after connectedToGC. We poll for it since it may arrive asynchronously.
    this.waitForInventory();
  }

  /**
     * Wait for inventory.
     *
     * Characteristics:
     * - @param retries - The parameter for retries
     * - @returns Nothing (void)
     *
     */
    private waitForInventory(retries = 0): void {
    if (!this.csgo) return;

    const inventory = (this.csgo as any).inventory;

    if (inventory && Array.isArray(inventory) && inventory.length > 0) {
      this.processFullInventory(inventory);
      return;
    }

    // Poll at 100ms for fast responsiveness (max ~10s total wait).
    // The GC typically delivers inventory within 1-3 seconds.
    if (retries < 100) {
      setTimeout(() => this.waitForInventory(retries + 1), 100);
    } else {
      // After 10 seconds, check if it's truly empty or an error
      const inv = (this.csgo as any).inventory;
      if (inv && Array.isArray(inv)) {
        // Empty inventory is valid
        this.processFullInventory(inv);
      } else {
        console.warn('[InventoryService] Inventory not received after timeout');
        this._state = 'error';
        this._error = 'Inventory not received from Game Coordinator. Try reconnecting.';
        this.emitUpdateNow();
      }
    }
  }

  /**
     * Process full inventory.
     *
     * Characteristics:
     * - @param rawItems - The parameter for rawItems
     * - @returns Nothing (void)
     *
     */
    private processFullInventory(rawItems: any[]): void {
    console.log(`[InventoryService] Processing ${rawItems.length} raw items from GC`);

    this._items.clear();
    this._storageUnits.clear();

    // Known system/phantom item IDs to always exclude
    const EXCLUDED_IDS = new Set(['17293822569110896676', '17293822569102708641']);

    for (const raw of rawItems) {
      const rawId = String(raw.id ?? raw.item_id ?? raw.itemid ?? '');

      // Skip known system item IDs
      if (EXCLUDED_IDS.has(rawId)) continue;

      // Filter out phantom / default items from the GC:
      // 1) flags === 24 (0x18, bits 3+4 both set) = preview/promotional items (P250 X-Ray, Weapon Case)
      // 2) origin=24 sealed graffiti = system-granted default sprays
      // 3) attribute 277 === 1 = free reward / default items (phantom Nova, etc.)
      const rawFlags = raw.flags ?? 0;
      const rawOrigin = raw.origin ?? 0;
      const defindex = raw.def_index ?? raw.defindex ?? 0;

      if (rawFlags === 24) continue;
      if (defindex === 1348 && rawOrigin === 24) continue;

      // attribute 277 = "is_default_item" / free reward flag
      // We skip loading these entirely as they generally clutter the UI and aren't
      // true manifestable items that users interact with.
      const isFreeReward = ItemDataService.getAttributeUint32(raw, 277);
      if (isFreeReward === 1) {
        continue;
      }

      const item = this.parseItem(raw);

      // Skip items stored inside a casket — they'll be loaded on demand
      if (item.casket_id) {
        //console.log(`[InventoryService]   SKIP casket item: defindex=${item.defindex} casket=${item.casket_id}`);
        continue;
      }

      this._items.set(item.id, item);

      if (item.is_storage_unit) {
        this.upsertStorageUnit(item);
      }
    }

    this._state = 'loaded';
    this._error = undefined;
    this.invalidateCache();

    console.log(
      `[InventoryService] Inventory loaded: ${this._items.size} items, ${this._storageUnits.size} storage units`,
    );

    this.emitUpdateNow();
  }

  // ---- Re-resolve item data (called when ItemDataService becomes available after initial load) ----

  /**
   * Re-parse all loaded items to update names, images, rarity, etc.
   * Called by AccountManager when ItemDataService finishes initializing
   * AFTER the inventory was already loaded (parallel init optimization).
   */
  reResolveItemData(): void {
    if (this._items.size === 0) return;

    const start = Date.now();
    let updated = 0;

    for (const [id, _existing] of this._items) {
      // We don't have the raw GC data anymore, but parseItem works with
      // the stored InventoryItem fields. Instead, re-resolve the name/image
      // fields using the ItemDataService directly.
      const item = this._items.get(id)!;
      if (!this._itemData) break;

      const isStickerOrPatchItem = item.defindex === 1209 || item.defindex === 4609;
      const isMusicKitItem = item.defindex === 1314;
      const isGraffitiItem = item.defindex === 1348 || item.defindex === 1349;
      const isSpecialResolverItem = isStickerOrPatchItem || isMusicKitItem || isGraffitiItem;

      // Special classes need richer synthetic raw reconstruction because early
      // inventory payloads are often incomplete compared to casket payloads.
      if (isSpecialResolverItem) {
        const syntheticAttrs: any[] = [];
        if (isMusicKitItem && item.music_id && item.music_id > 0) {
          syntheticAttrs.push({ def_index: 166, value_int: item.music_id });
        }
        if (isGraffitiItem && item.graffiti_tint_id !== undefined) {
          syntheticAttrs.push({ def_index: 233, value_int: item.graffiti_tint_id });
        }

        const stickerIds: number[] = [];
        if (item.sticker_item_id && item.sticker_item_id > 0) {
          stickerIds.push(item.sticker_item_id);
        }
        if (item.paint_index && item.paint_index > 0 && !stickerIds.includes(item.paint_index)) {
          stickerIds.push(item.paint_index);
        }
        for (const s of item.stickers || []) {
          if (s.sticker_id && s.sticker_id > 0 && !stickerIds.includes(s.sticker_id)) {
            stickerIds.push(s.sticker_id);
          }
        }

        const syntheticRaw = {
          def_index: item.defindex,
          paint_index: item.paint_index,
          attribute: syntheticAttrs,
          stickers: stickerIds.slice(0, 1).map((sid) => ({ sticker_id: sid, stickerId: sid })),
        };

        const resolvedSpecialItem = this._itemData.resolveItemFromRaw(syntheticRaw);
        const isExpectedCategory = (() => {
          if (!resolvedSpecialItem) return false;
          if (isMusicKitItem) return resolvedSpecialItem.category === 'music_kit';
          if (isGraffitiItem) return resolvedSpecialItem.category === 'graffiti';
          if (item.defindex === 1209) return resolvedSpecialItem.category === 'sticker';
          if (item.defindex === 4609) return resolvedSpecialItem.category === 'patch';
          return false;
        })();

        if (resolvedSpecialItem && isExpectedCategory) {
          if (resolvedSpecialItem.name && item.market_name !== resolvedSpecialItem.name) {
            item.market_name = resolvedSpecialItem.name;
            updated++;
          }
          if (resolvedSpecialItem.image && item.image_url !== resolvedSpecialItem.image) {
            item.image_url = resolvedSpecialItem.image;
            updated++;
          }

          if (resolvedSpecialItem.category === 'sticker' && item.weapon_type !== 'Sticker') {
            item.weapon_type = 'Sticker';
            updated++;
          } else if (resolvedSpecialItem.category === 'patch' && item.weapon_type !== 'Patch') {
            item.weapon_type = 'Patch';
            updated++;
          } else if (resolvedSpecialItem.category === 'music_kit' && item.weapon_type !== 'Music Kit') {
            item.weapon_type = 'Music Kit';
            updated++;
          } else if (resolvedSpecialItem.category === 'graffiti' && item.weapon_type !== 'Graffiti') {
            item.weapon_type = 'Graffiti';
            updated++;
          }
        }
      }

      // Re-resolve via ItemDataService
      const resolveIndex = (item.defindex === 1314 && item.music_id)
        ? item.music_id
        : item.paint_index;
      const resolved = this._itemData.getItemInfo(item.defindex, resolveIndex);
      if (resolved) {
        const hasPlaceholderName = !item.market_name || /^Item #\d+$/i.test(item.market_name);
        const currentHasPipe = item.market_name?.includes('|') ?? false;
        const resolvedHasPipe = resolved.name?.includes('|') ?? false;
        if (resolved.name && (hasPlaceholderName || (!currentHasPipe && resolvedHasPipe))) {
          item.market_name = resolved.name;
          updated++;
        }
        if (resolved.image && !item.image_url) {
          item.image_url = resolved.image;
          updated++;
        }
        if (resolved.rarityColor && !item.rarity_color) {
          item.rarity_color = resolved.rarityColor;
        }
        if (item.rarity === undefined && resolved.rarity !== undefined) {
          item.rarity = resolved.rarity;
          updated++;
        }
        if (resolved.weaponType && !item.weapon_type) {
          item.weapon_type = resolved.weaponType;
        }
        if (resolved.collectionId && !item.collection_id) {
          item.collection_id = resolved.collectionId;
          updated++;
        }
        if (resolved.collectionName && !item.collection_name) {
          item.collection_name = resolved.collectionName;
          updated++;
        }
        if (resolved.minFloat !== undefined && item.min_float === undefined) {
          item.min_float = resolved.minFloat;
          updated++;
        }
        if (resolved.maxFloat !== undefined && item.max_float === undefined) {
          item.max_float = resolved.maxFloat;
          updated++;
        }
      }

      // Re-resolve sticker names if missing
      if (item.stickers) {
        for (const s of item.stickers) {
          if (!s.name && s.sticker_id) {
            const sinfo = this._itemData.getStickerInfo(s.sticker_id);
            if (sinfo) {
              s.name = sinfo.name;
              s.image_url = sinfo.image;
            }
          }
        }
      }

      // Re-resolve charm names if missing
      if (item.charms) {
        for (const c of item.charms) {
          if (!c.name && c.charm_id) {
            const chInfo = this._itemData.getCharmInfo(c.charm_id);
            if (chInfo) {
              c.name = chInfo.name;
              c.image_url = chInfo.image;
            }
          }
        }
      }
    }

    if (updated > 0) {
      this.invalidateCache();
      console.log(`[InventoryService] Re-resolved ${updated} item fields in ${Date.now() - start}ms`);
      this.emitUpdateNow();
    }
  }

  // ---- Storage Unit contents ----

  /**
     * Loads casket contents.
     *
     * Characteristics:
     * - @param casketId - The parameter for casketId
     * - @returns Promise<import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").InventoryItem[]>
     *
     */
    async loadCasketContents(casketId: string): Promise<InventoryItem[]> {
    if (!this.csgo) {
      throw new Error('Not connected to Game Coordinator');
    }

    const unit = this._storageUnits.get(casketId);
    if (!unit) {
      throw new Error(`Storage unit ${casketId} not found`);
    }

    if (unit.isLoaded) {
      return unit.items;
    }

    // Mark as loading
    unit.isLoading = true;
    this.emitUpdate();

    console.log(`[InventoryService] Loading casket contents for ${casketId}...`);

    return new Promise<InventoryItem[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._casketContentsCallbacks.delete(casketId);
        unit.isLoading = false;
        this.emitUpdate();
        reject(new Error('Timed out waiting for casket contents'));
      }, 30000);

      this._casketContentsCallbacks.set(casketId, (items: InventoryItem[]) => {
        clearTimeout(timeout);
        resolve(items);
      });

      // Listen for the casketContents response
      const handler = (contents: any[], id: string) => {
        if (String(id) !== String(casketId)) return;

        // Remove the one-time listener
        (this.csgo as any).removeListener('getCasketContents', handler);

        const parsedItems = contents.map((raw: any) => this.parseItem(raw));

        // Update the storage unit
        unit.items = parsedItems;
        unit.isLoaded = true;
        unit.isLoading = false;

        console.log(
          `[InventoryService] Casket ${casketId} loaded: ${parsedItems.length} items`,
        );

        this.emitUpdate();
        this.emit('casket-contents-loaded', casketId, parsedItems);

        // Resolve the callback
        const cb = this._casketContentsCallbacks.get(casketId);
        if (cb) {
          this._casketContentsCallbacks.delete(casketId);
          cb(parsedItems);
        }
      };

      (this.csgo as any).on('getCasketContents', handler);

      // Request the contents from GC
      try {
        (this.csgo as any).getCasketContents(casketId, (err: Error | null, items: any[]) => {
          // Some versions use callback style instead of events
          if (err) {
            (this.csgo as any).removeListener('getCasketContents', handler);
            clearTimeout(timeout);
            this._casketContentsCallbacks.delete(casketId);
            unit.isLoading = false;
            this.emitUpdate();
            reject(err);
            return;
          }
          if (items) {
            // Callback style worked, remove the event listener
            (this.csgo as any).removeListener('getCasketContents', handler);
            clearTimeout(timeout);

            const parsedItems = items.map((raw: any) => this.parseItem(raw));
            unit.items = parsedItems;
            unit.isLoaded = true;
            unit.isLoading = false;

            this.emitUpdate();
            this.emit('casket-contents-loaded', casketId, parsedItems);

            const cb = this._casketContentsCallbacks.get(casketId);
            if (cb) {
              this._casketContentsCallbacks.delete(casketId);
              cb(parsedItems);
            }
          }
        });
      } catch {
        // If getCasketContents doesn't accept a callback, the event listener will handle it
        // The globaloffensive library uses: getCasketContents(casketId) and emits event
        try {
          (this.csgo as any).getCasketContents(casketId);
        } catch (e: any) {
          // Already called above with callback, ignore
        }
      }
    });
  }

  // ---- Casket operations (Phase 3) ----

  /**
     * Can move item to casket.
     *
     * Characteristics:
     * - @param item - The parameter for item
     * - @returns boolean
     *
     */
    private canMoveItemToCasket(item: InventoryItem): boolean {
    if (item.is_storage_unit) return false;

    if (item.marketable === false) {
      // Items blocked ONLY by a temporary trade cooldown (7-day purchase ban) can
      // still be deposited into CS2 storage units — the GC allows casket operations
      // regardless of the trade restriction.
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

  // ---- Steam Web API tradability enrichment ----

  /**
   * After the GC inventory is loaded, fetch the Steam Web API inventory endpoint
   * (steamcommunity.com/inventory/730/2) which returns authoritative `tradable` and
   * `marketable` booleans computed by Steam itself.  This corrects any items that the
   * GC flag / attribute heuristics got wrong in the initial parse.
   *
   * Trade-locked items (7-day purchase ban) stay storable — see canMoveItemToCasket.
   */
  async enrichTradabilityFromWebAPI(steamId: string, cookieHeader: string): Promise<void> {
    const CS2_APP_ID = 730;
    const CONTEXT_ID = 2;
    const PAGE_SIZE = 2000;

    // assetid → { tradable, marketable } from Steam Web API
    const assetData = new Map<string, { tradable: boolean; marketable: boolean }>();

    let lastAssetId: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const url = new URL(
        `https://steamcommunity.com/inventory/${steamId}/${CS2_APP_ID}/${CONTEXT_ID}`,
      );
      url.searchParams.set('l', 'english');
      url.searchParams.set('count', String(PAGE_SIZE));
      if (lastAssetId) url.searchParams.set('start_assetid', lastAssetId);

      let data: any;
      try {
        const res = await fetch(url.toString(), {
          headers: {
            'Cookie': cookieHeader,
            'User-Agent': 'Mozilla/5.0',
          },
        });
        if (!res.ok) {
          console.warn(`[InventoryService] Web API inventory fetch failed: HTTP ${res.status}`);
          return;
        }
        data = await res.json();
      } catch (err: any) {
        console.warn('[InventoryService] Web API inventory fetch error:', err.message);
        return;
      }

      if (!data?.success || !Array.isArray(data.assets) || !Array.isArray(data.descriptions)) {
        console.warn('[InventoryService] Web API inventory: unexpected response format');
        return;
      }

      // Build classid_instanceid → { tradable, marketable }
      const descMap = new Map<string, { tradable: boolean; marketable: boolean }>();
      for (const desc of data.descriptions) {
        descMap.set(`${desc.classid}_${desc.instanceid}`, {
          tradable: desc.tradable === 1,
          marketable: desc.marketable === 1,
        });
      }

      // Map assetid → tradability
      for (const asset of data.assets) {
        const entry = descMap.get(`${asset.classid}_${asset.instanceid}`);
        if (entry) assetData.set(String(asset.assetid), entry);
      }

      hasMore = data.more_items === 1 && !!data.last_assetid;
      lastAssetId = data.last_assetid ? String(data.last_assetid) : undefined;
    }

    // Apply authoritative values, overriding any heuristic estimate
    let changed = 0;
    for (const item of this._items.values()) {
      const entry = assetData.get(item.id);
      if (!entry) continue;
      if (item.marketable !== entry.marketable) {
        item.marketable = entry.marketable;
        changed++;
      }
    }

    if (changed > 0) {
      this.invalidateCache();
      console.log(`[InventoryService] Web API tradability: updated ${changed} items`);
      this.emitUpdateNow();
    } else {
      console.log('[InventoryService] Web API tradability: no corrections needed');
    }
  }

  /**
     * Add item to casket.
     *
     * Characteristics:
     * - @param casketId - The parameter for casketId
     * - @param itemId - The parameter for itemId
     * - @returns Promise<void>
     *
     */
    async addItemToCasket(casketId: string, itemId: string): Promise<void> {
    if (!this.csgo) throw new Error('Not connected to Game Coordinator');

    // Capture item data before the GC removes it from inventory
    const itemData = this._items.get(itemId);
    if (itemData && !this.canMoveItemToCasket(itemData)) {
      throw new Error('This item type cannot be moved into storage units');
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Add to casket timed out'));
      }, 15000);

      const onItemRemoved = (item: any) => {
        const removedId = String(item.id ?? item);
        if (removedId === itemId) {
          cleanup();
          // Update storage unit's cached items list
          const unit = this._storageUnits.get(casketId);
          if (unit && unit.isLoaded && itemData) {
            unit.items.push({ ...itemData, casket_id: casketId });
          }
          resolve();
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        (this.csgo as any).removeListener('itemRemoved', onItemRemoved);
      };

      (this.csgo as any).on('itemRemoved', onItemRemoved);

      console.log(`[InventoryService] Adding item ${itemId} to casket ${casketId}`);
      (this.csgo as any).addToCasket(casketId, itemId);
    });
  }

  /**
     * Remove item from casket.
     *
     * Characteristics:
     * - @param casketId - The parameter for casketId
     * - @param itemId - The parameter for itemId
     * - @returns Promise<void>
     *
     */
    async removeItemFromCasket(casketId: string, itemId: string): Promise<void> {
    if (!this.csgo) throw new Error('Not connected to Game Coordinator');

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Remove from casket timed out'));
      }, 15000);

      const onItemAcquired = (item: any) => {
        const acquiredId = String(item.id ?? item.item_id ?? '');
        if (acquiredId === itemId) {
          cleanup();
          // Update storage unit's cached items list
          const unit = this._storageUnits.get(casketId);
          if (unit && unit.isLoaded) {
            unit.items = unit.items.filter(i => i.id !== itemId);
          }
          resolve();
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        (this.csgo as any).removeListener('itemAcquired', onItemAcquired);
      };

      (this.csgo as any).on('itemAcquired', onItemAcquired);

      console.log(`[InventoryService] Removing item ${itemId} from casket ${casketId}`);
      (this.csgo as any).removeFromCasket(casketId, itemId);
    });
  }

  /**
     * Rename casket.
     *
     * Characteristics:
     * - @param casketId - The parameter for casketId
     * - @param name - The parameter for name
     * - @returns Promise<void>
     *
     */
    async renameCasket(casketId: string, name: string): Promise<void> {
    if (!this.csgo) throw new Error('Not connected to Game Coordinator');

    const gc = this.csgo as any;
    if (typeof gc.nameItem === 'function') {
      console.log(`[InventoryService] Renaming casket ${casketId} to "${name}"`);
      gc.nameItem(casketId, casketId, name);
    } else {
      throw new Error('Storage unit renaming is not supported by this library version');
    }

    // Optimistically update local state
    const unit = this._storageUnits.get(casketId);
    if (unit) {
      unit.custom_name = name;
    }
    const item = this._items.get(casketId);
    if (item) {
      item.custom_name = name;
    }
    this.emitUpdate();
  }

  /**
     * Execute bulk operation.
     *
     * Characteristics:
     * - @param operations - The parameter for operations
     * - @param delayMs - The parameter for delayMs
     * - @param itemCount - The parameter for itemCount
     * - @returns Promise<void>
     *
     */
    async executeBulkOperation(operations: CasketOperation[], delayMs?: number, itemCount?: number): Promise<void> {
    if (!this.csgo) throw new Error('Not connected to Game Coordinator');
    this._bulkCancelled = false;
    const delay = delayMs ?? CASKET_OPERATION_DELAY_MS;
    const opsPerItem = itemCount ? Math.max(1, Math.round(operations.length / itemCount)) : 1;
    const displayTotal = itemCount ?? operations.length;

    const progress: BulkOperationProgress = {
      queueId: Date.now().toString(36),
      total: displayTotal,
      completed: 0,
      failed: 0,
      state: 'running',
    };
    this.emit('casket-operation-progress', { ...progress });

    let rawCompleted = 0;
    let rawFailed = 0;

    for (let i = 0; i < operations.length; i++) {
      if (this._bulkCancelled) {
        progress.state = 'cancelled';
        this.emit('casket-operation-progress', { ...progress });
        return;
      }

      const op = operations[i];
      progress.currentItem = op.itemId;
      this.emit('casket-operation-progress', { ...progress });

      try {
        if (op.type === 'add') {
          await this.addItemToCasket(op.casketId, op.itemId);
        } else {
          await this.removeItemFromCasket(op.casketId, op.itemId);
        }
        rawCompleted++;
      } catch (err: any) {
        console.error(`[InventoryService] Bulk op failed for item ${op.itemId}:`, err.message);
        rawFailed++;
      }

      progress.completed = Math.floor(rawCompleted / opsPerItem);
      progress.failed = Math.ceil(rawFailed / opsPerItem);
      this.emit('casket-operation-progress', { ...progress });

      // Rate-limit delay between operations
      if (i < operations.length - 1 && !this._bulkCancelled) {
        await new Promise(r => setTimeout(r, delay));
      }
    }

    if (!this._bulkCancelled) {
      progress.state = 'completed';
      this.emit('casket-operation-progress', { ...progress });
    }
  }

  /**
     * Cancel bulk operation.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    cancelBulkOperation(): void {
    this._bulkCancelled = true;
  }

  // ---- Item parsing ----

  /**
     * Parse item.
     *
     * Characteristics:
     * - @param raw - The parameter for raw
     * - @returns import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").InventoryItem
     *
     */
    private parseItem(raw: any): InventoryItem {
    const id = String(raw.id ?? raw.item_id ?? raw.itemid ?? '');
    const defindex = raw.def_index ?? raw.defindex ?? 0;
    const isStorageUnit = defindex === STORAGE_UNIT_DEFINDEX;
    const rawFlags = raw.flags ?? 0;

    // Extract paint/wear info from attributes
    const attrs = this.extractAttributes(raw);

    // Resolve name, image, rarity from ItemDataService (or static fallback)
    let market_name: string | undefined;
    let image_url: string | undefined;
    let rarity_color: string | undefined;
    let weapon_type: string | undefined;
    let quality_name: string | undefined;
    let collection_id: string | undefined;
    let collection_name: string | undefined;
    let min_float: number | undefined;
    let max_float: number | undefined;

    const rawRarity = raw.rarity as number | undefined;
    const rawQuality = raw.quality as number | undefined;
    let itemRarity: number | undefined = rawRarity;
    const rawMarketName = raw.market_hash_name ?? raw.market_name ?? raw.name ?? raw.item_name;
    const rawImage = raw.image_url ?? raw.icon_url_large ?? raw.icon_url;

    // --- PRIMARY: Try comprehensive resolution from bundled cs2-inventory-resolver data ---
    // This handles graffiti, stickers-as-items, keychains, highlights, music kits,
    // crates, cases, keys, collectibles, and skins all in one pass.
    if (this._itemData) {
      const resolved = this._itemData.resolveItemFromRaw(raw);
      //if (defindex === 1209) {
        //console.log(`[InventoryService] DEBUG defindex=1209 id=${id} resolved=${JSON.stringify(resolved)} raw.stickers=${JSON.stringify(raw.stickers)} raw.paint_index=${raw.paint_index} raw.attribute?.length=${raw.attribute?.length}`);
      //}
      if (resolved) {
        market_name = resolved.name;

        // For skins, prefer the freshly-fetched CSGO-API image over the bundled
        // package image — CSGO-API images are regenerated from current game data
        // while the bundled package URLs are frozen at package build time.
        if (resolved.category === 'skin') {
          const apiImage = this._itemData.getImageUrl(defindex, attrs.paint_index ?? 0);
          image_url = apiImage || resolved.image;
        } else {
          image_url = resolved.image;
        }

        // Map the resolved category to a weapon_type for display
        const categoryToType: Record<string, string> = {
          skin: '', // weapon_type comes from ByMykel/static data below
          tool: 'Tool',
          music_kit: 'Music Kit',
          highlight: 'Collectible',
          keychain: 'Charm',
          graffiti: 'Graffiti',
          crate: 'Container',
          collectible: 'Collectible',
          sticker: 'Sticker',
          patch: 'Patch',
        };
        weapon_type = categoryToType[resolved.category] ?? resolved.category;
      }
    }

    // --- SECONDARY: ByMykel API data (for rarity colors, weapon_type, and as fallback) ---
    if (this._itemData) {
      const resolveIndex = (defindex === 1314 && attrs.music_id)
        ? attrs.music_id
        : (attrs.paint_index ?? 0);
      const resolvedInfo = this._itemData.getItemInfo(defindex, resolveIndex);

      // If primary resolution failed, use ByMykel-based name
      if (!market_name) {
        market_name = this._itemData.resolveItemName(
          defindex,
          resolveIndex,
          raw.kill_eater_score_type,
          rawQuality,
        );
      } else {
        // Primary succeeded — still add StatTrak/Souvenir prefix if needed
        if (raw.kill_eater_score_type !== undefined && !market_name.startsWith('StatTrak')) {
          market_name = `StatTrak™ ${market_name}`;
        } else if (rawQuality === 12 && !market_name.startsWith('Souvenir')) {
          market_name = `Souvenir ${market_name}`;
        }
      }

      if (!image_url) {
        image_url = resolvedInfo?.image || this._itemData.getImageUrl(defindex, resolveIndex);
      }
      rarity_color = this._itemData.getRarityColor(defindex, resolveIndex, rawRarity);
      if (!weapon_type || weapon_type === '') {
        weapon_type = this._itemData.getWeaponType(defindex, resolveIndex);
      }

      if (resolvedInfo) {
        if (itemRarity === undefined && resolvedInfo.rarity !== undefined) {
          itemRarity = resolvedInfo.rarity;
        }
        collection_id = resolvedInfo.collectionId;
        collection_name = resolvedInfo.collectionName;
        min_float = resolvedInfo.minFloat;
        max_float = resolvedInfo.maxFloat;
      }
    } else {
      // Static fallback only
      const weaponDef = WEAPON_DEFS[defindex];
      market_name = weaponDef?.name;
      weapon_type = weaponDef?.type;
      if (rawRarity !== undefined) rarity_color = RARITY_INFO[rawRarity]?.color;
    }

    const isStickerOrPatchItem = defindex === 1209 || defindex === 4609;
    const isMusicKitItem = defindex === 1314;
    const isGraffitiItem = defindex === 1348 || defindex === 1349;
    const isSensitiveResolvedItem = isStickerOrPatchItem || isMusicKitItem || isGraffitiItem;

    const rawStickerId = Array.isArray(raw.stickers) && raw.stickers.length > 0
      ? Number(raw.stickers[0]?.sticker_id ?? raw.stickers[0]?.stickerId ?? 0)
      : 0;
    const sticker_item_id = (isStickerOrPatchItem || isGraffitiItem)
      ? ((attrs.paint_index && attrs.paint_index > 0)
        ? attrs.paint_index
        : (rawStickerId > 0 ? rawStickerId : undefined))
      : undefined;

    const normalizedRawName =
      typeof rawMarketName === 'string' && rawMarketName.trim().length > 0
        ? this.normalizeMarketName(rawMarketName)
        : undefined;

    // Prefer richer raw market names when available (e.g. includes "| Skin Name").
    // For sticker/patch/music/graffiti item classes, avoid trusting early
    // inventory raw names because they are often stale/incorrect and can block
    // later re-resolution parity with casket contents.
    if (
      !isSensitiveResolvedItem &&
      normalizedRawName &&
      (
        !market_name ||
        /^Item #\d+$/i.test(market_name) ||
        (!market_name.includes('|') && normalizedRawName.includes('|'))
      )
    ) {
      market_name = normalizedRawName;
    }

    // Raw fallback values from GC payload for unresolved entries.
    if (!market_name && normalizedRawName && !isSensitiveResolvedItem) {
      market_name = normalizedRawName;
    }
    if (market_name) {
      market_name = this.normalizeMarketName(market_name);
    }
    if (!image_url && typeof rawImage === 'string' && rawImage.trim().length > 0) {
      image_url = rawImage.startsWith('http') ? rawImage : `${STEAM_CDN_IMAGE_BASE}${rawImage}`;
    }

    // Storage Unit — always use known Steam CDN image
    if (isStorageUnit) {
      image_url = 'https://community.fastly.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJG51EejH_XV0MGkITXE5AB094KtuwG0Exv1yMfkqXcCtvT_MPw5JPTKV2bDk7Z3sudtHSjr2w0ptCMWPT2u/96fx96f';
    }

    // Defindex 4607 is shared between Keychains (charms) and Bonus Rank (XP boost) items.
    // Origin 23 = season/operation reward → these are Bonus Rank items, not keychains.
    const rawOrigin = raw.origin ?? 0;
    if (defindex === 4607 && rawOrigin === 23) {
      market_name = 'Bonus Rank';
      weapon_type = 'Pass';
      image_url = 'https://community.fastly.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGJai2l-lQ8ndwMWvJjSP9VFn9YngpA-2REugm5LiryENvaP5OqBocPXHVzbBx7l3trJsHy-wzBx_6zvVmNq3MSXASr-XS2k/96fx96f';
    }

    // Parse applied stickers/charms only for attachable weapon-like items.
    const ATTACHMENT_EXCLUDED_TYPES = new Set([
      'Pass', 'Equipment', 'Collectible', 'Sticker', 'Graffiti', 'Music Kit', 'Patch', 'Tool', 'Charm', 'Container', 'Agent',
    ]);
    const CHARM_EXCLUDED_TYPES = new Set([
      'Pass', 'Collectible', 'Sticker', 'Graffiti', 'Music Kit', 'Patch', 'Tool', 'Charm', 'Container', 'Agent',
    ]);
    const ATTACHMENT_EXCLUDED_DEFINDEXES = new Set([1209, 1314, 1348, 1349, 4607, 4609]);
    const canHaveAttachments = !isStorageUnit
      && !ATTACHMENT_EXCLUDED_DEFINDEXES.has(defindex)
      && !ATTACHMENT_EXCLUDED_TYPES.has(weapon_type || '')
      && !!market_name;
    const canHaveCharms = !isStorageUnit
      && !ATTACHMENT_EXCLUDED_DEFINDEXES.has(defindex)
      && !CHARM_EXCLUDED_TYPES.has(weapon_type || '')
      && !!market_name;

    const stickers = canHaveAttachments ? this.extractStickers(raw) : undefined;
    if (stickers && this._itemData) {
      for (const s of stickers) {
        const sid = s.sticker_id;
        if (!sid) continue;
        const info = this._itemData.getStickerInfo(sid);
        if (!info) continue;
        s.name = info.name;
        s.image_url = info.image;
      }
    }

    let charms: CharmInfo[] | undefined;
    if (canHaveCharms && attrs.charm_id && attrs.charm_id > 0) {
      const charmInfo = this._itemData?.getCharmInfo(attrs.charm_id);
      charms = [{
        charm_id: attrs.charm_id,
        name: charmInfo?.name,
        image_url: charmInfo?.image,
      }];
    }

    // ── Marketability — layered evaluation (recommended order) ─────────────────
    //
    // Step 1 · Dynamic attributes: parse tradable_after date so it can gate
    //          marketability. Note that trade-locked items CAN still be moved
    //          into storage units in CS2 (casket operations ignore the trade
    //          cooldown), so canMoveItemToCasket makes an exception for them.
    const tradableAfterDate: Date | undefined = raw.tradable_after instanceof Date
      ? raw.tradable_after
      : (raw.tradable_after
          ? new Date(typeof raw.tradable_after === 'number' ? raw.tradable_after * 1000 : raw.tradable_after)
          : undefined);
    const tradeLockedNow = tradableAfterDate ? tradableAfterDate > new Date() : false;

    // Step 2 · Instance flags bitmask.
    // kEconItemFlag_CannotTrade = bit 3 (0x08).
    // Bit pattern 0x18 (flags === 24) means CannotTrade | CannotBeUsedInCrafting;
    // those phantom/preview items are already excluded during inventory loading,
    // so checking & 0x08 here catches any remaining permanently-restricted items.
    const CANNOT_TRADE_FLAG = 0x08;
    const flagsPreventTrade = (rawFlags & CANNOT_TRADE_FLAG) !== 0;

    // Step 3 · Schema / def_index fallback.
    // (Origin-level checks are deferred to the Steam Web API enrichment pass,
    //  which returns authoritative tradable/marketable booleans per item.)
    const cannotTradeAttr = ItemDataService.getAttributeUint32(raw, 272);
    // Weapon/gloves types require a skin — if no paint is present the item is
    // a default (account-locked) variant. Require origin === 0 to stay conservative —
    // the Steam Web API enrichment pass will authoratively correct anything this misses.
    const SKIN_REQUIRED_WEAPON_TYPES = new Set(['Pistol', 'Rifle', 'SMG', 'Shotgun', 'Machinegun', 'Sniper Rifle', 'Knife', 'Gloves']);
    const isDefault = rawOrigin === 0
      && !attrs.paint_index
      && !attrs.paint_wear
      && !isStorageUnit
      && SKIN_REQUIRED_WEAPON_TYPES.has(weapon_type || '');
    const NON_MARKETABLE_DEFINDEXES = new Set([
      31,    // Zeus x27
      42,    // Default CT Knife
      59,    // Default T Knife
      1349,  // Open Graffiti (used/applied — depleted)
      4950,  // Charm Detachment Tool
    ]);

    let marketable = true;
    // 1. Temporary trade lock (e.g. 7-day purchase cooldown)
    if (tradeLockedNow) marketable = false;
    // 2. Permanent flag-level restriction
    else if (flagsPreventTrade) marketable = false;
    // 3. Schema / category checks
    else if (!market_name) marketable = false;
    else if (isStorageUnit) marketable = false;
    else if (weapon_type === 'Pass') marketable = false;
    else if (weapon_type === 'Equipment') marketable = false;
    else if (weapon_type === 'Collectible') marketable = false;
    else if (NON_MARKETABLE_DEFINDEXES.has(defindex)) marketable = false;
    else if (isDefault) marketable = false;
    else if (defindex === 1314 && !attrs.music_id) marketable = false; // default (no-skin) music kit
    else if (cannotTradeAttr === 1) marketable = false;

    const item: InventoryItem = {
      id,
      defindex,
      origin: rawOrigin,
      position: raw.inventory ?? raw.position ?? 0,
      custom_name: raw.custom_name || raw.custom_desc || undefined,
      paint_index: attrs.paint_index,
      music_id: attrs.music_id,
      graffiti_tint_id: attrs.graffiti_tint_id,
      sticker_item_id,
      paint_seed: attrs.paint_seed,
      paint_wear: attrs.paint_wear,
      kill_eater_value: raw.kill_eater_value ?? undefined,
      kill_eater_score_type: raw.kill_eater_score_type ?? undefined,
      quest_id: raw.quest_id ?? undefined,
      tradable_after: tradableAfterDate,
      stickers,
      charms,
      casket_id: raw.casket_id ? String(raw.casket_id) : undefined,
      casket_contained_item_count: raw.casket_contained_item_count ?? undefined,
      is_storage_unit: isStorageUnit,
      marketable,
      market_name,
      image_url,
      rarity_color,
      rarity: itemRarity,
      collection_id,
      collection_name,
      min_float,
      max_float,
      quality_name,
      quality: rawQuality,
      weapon_type,
    };

    return item;
  }

  /**
     * Extract stickers.
     *
     * Characteristics:
     * - @param raw - The parameter for raw
     * - @returns import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").StickerInfo[]
     *
     */
    private extractStickers(raw: any): StickerInfo[] | undefined {
    // Path 1: globaloffensive library pre-parses stickers into raw.stickers array
    if (raw.stickers && Array.isArray(raw.stickers) && raw.stickers.length > 0) {
      // Normalize: ensure each object has our expected field names
      const result: StickerInfo[] = [];
      for (const s of raw.stickers) {
        // The library may use sticker_id or stickerId — handle both
        const stickerId = s.sticker_id ?? s.stickerId ?? s.id ?? 0;
        if (!stickerId) continue;
        result.push({
          slot: s.slot ?? 0,
          sticker_id: stickerId,
          wear: s.wear ?? null,
          scale: s.scale ?? null,
          rotation: s.rotation ?? null,
          tint_id: s.tint_id ?? s.tintId ?? 0,
          offset_x: s.offset_x ?? s.offsetX ?? null,
          offset_y: s.offset_y ?? s.offsetY ?? null,
        });
      }
      return result.length > 0 ? result : undefined;
    }

    // Path 2: Extract from raw attribute array (protobuf)
    // In CS2, each sticker slot uses 4 consecutive attribute def_indexes:
    //   slot 0: 113 (id), 114 (wear), 115 (scale), 116 (rotation)
    //   slot 1: 117 (id), 118 (wear), 119 (scale), 120 (rotation)
    //   slot 2: 121 (id), 122 (wear), 123 (scale), 124 (rotation)
    //   slot 3: 125 (id), 126 (wear), 127 (scale), 128 (rotation)
    //   slot 4: 129 (id), 130 (wear), 131 (scale), 132 (rotation)
    const stickers: StickerInfo[] = [];
    const attrs = raw.attribute ?? raw.attributes ?? [];
    if (!Array.isArray(attrs)) return undefined;

    // Build a lookup map by def_index for O(1) access instead of repeated Array.find()
    const attrMap = new Map<number, any>();
    for (const a of attrs) {
      if (a.def_index !== undefined) {
        const defIndexNum = Number(a.def_index);
        if (!Number.isNaN(defIndexNum)) attrMap.set(defIndexNum, a);
      }
    }

    // Sticker ID attributes are at def_index 113, 117, 121, 125, 129 (every 4th starting at 113)
    const STICKER_ID_BASES = [113, 117, 121, 125, 129];
    for (const baseIdx of STICKER_ID_BASES) {
      const idAttr = attrMap.get(baseIdx);
      if (idAttr && idAttr.value_int) {
        const slot = (baseIdx - 113) / 4;
        const wearAttr = attrMap.get(baseIdx + 1);
        const scaleAttr = attrMap.get(baseIdx + 2);
        const rotAttr = attrMap.get(baseIdx + 3);
        stickers.push({
          slot,
          sticker_id: idAttr.value_int,
          wear: wearAttr?.value_float ?? null,
          scale: scaleAttr?.value_float ?? null,
          rotation: rotAttr?.value_float ?? null,
          tint_id: 0,
          offset_x: null,
          offset_y: null,
        });
      }
    }

    return stickers.length > 0 ? stickers : undefined;
  }

  /**
     * Extract attributes.
     *
     * Characteristics:
     * - @param raw - The parameter for raw
     * - @returns { paint_index?: number; paint_seed?: number; paint_wear?: number; music_id?: number; graffiti_tint_id?: number; charm_id?: number; }
     *
     */
    private extractAttributes(raw: any): {
    paint_index?: number;
    paint_seed?: number;
    paint_wear?: number;
    music_id?: number;
    graffiti_tint_id?: number;
    charm_id?: number;
  } {
    const result: any = {};

    const toBuffer = (valueBytes: any): Buffer | null => {
      try {
        if (!valueBytes) return null;
        if (Buffer.isBuffer(valueBytes)) return valueBytes;
        if (valueBytes instanceof Uint8Array) return Buffer.from(valueBytes);
        if (Array.isArray(valueBytes)) return Buffer.from(valueBytes);
        if (typeof valueBytes === 'string') {
          // Some payloads expose base64 strings.
          return Buffer.from(valueBytes, 'base64');
        }
        if (Array.isArray(valueBytes.data)) return Buffer.from(valueBytes.data);
        return null;
      } catch {
        return null;
      }
    };

    // Direct properties (from globaloffensive library)
    if (raw.paint_index !== undefined) result.paint_index = raw.paint_index;
    if (raw.paint_seed !== undefined) result.paint_seed = raw.paint_seed;
    if (raw.paint_wear !== undefined) result.paint_wear = raw.paint_wear;
    if (raw.paintwear !== undefined) result.paint_wear = raw.paintwear;
    if (raw.float_value !== undefined) result.paint_wear = raw.float_value;
    if (raw.wear !== undefined) result.paint_wear = raw.wear;
    // Some library versions expose music kit ID directly
    if (raw.music_index !== undefined) result.music_id = raw.music_index;
    if (raw.music_definition_index !== undefined) result.music_id = raw.music_definition_index;
    if (raw.keychain_index !== undefined) result.charm_id = raw.keychain_index;

    // Always scan attribute array for fields not available as direct properties
    // (e.g. music_id at attribute 166)
    const attrs = raw.attribute ?? raw.attributes ?? [];
    if (Array.isArray(attrs)) {
      for (const attr of attrs) {
        // Attribute value can be in value, value_int, value_float, or value_bytes.
        // The protobuf stores values in value_bytes as raw 4-byte little-endian.
        // Integer attrs (6, 7, 166) use UInt32LE; float attrs (8) use FloatLE.
        let decodedUint32: number | undefined;
        let decodedFloat: number | undefined;
        if ((attr.value === null || attr.value === undefined) && attr.value_bytes) {
          const buf = toBuffer(attr.value_bytes);
          if (buf && buf.length >= 4) {
            decodedUint32 = buf.readUInt32LE(0);
            decodedFloat = buf.readFloatLE(0);
          }
        }

        const intVal = attr.value_int ?? attr.value ?? decodedUint32 ?? undefined;
        const floatVal = attr.value_float ?? decodedFloat ?? undefined;

        switch (Number(attr.def_index)) {
          case 6: // Paint Kit — only use if no direct property
            if (result.paint_index === undefined) {
              result.paint_index = intVal ?? floatVal;
            }
            break;
          case 7: // Paint Seed
            if (result.paint_seed === undefined) {
              result.paint_seed = intVal ?? floatVal;
            }
            break;
          case 8: // Paint Wear
            if (result.paint_wear === undefined) {
              result.paint_wear = floatVal ?? intVal;
            }
            break;
          case 166: // Music Kit ID
            if (result.music_id === undefined) {
              // Music kit ID is an integer; round in case it was decoded from float bytes
              const val = intVal ?? floatVal;
              result.music_id = val !== undefined ? Math.round(val) : undefined;
            }
            break;
          case 233: // Graffiti Tint ID
            if (result.graffiti_tint_id === undefined) {
              const tintVal = intVal ?? floatVal;
              result.graffiti_tint_id = tintVal !== undefined ? Math.round(tintVal) : undefined;
            }
            break;
          case 299: // Keychain / charm ID
            if (result.charm_id === undefined) {
              const attrNumber = typeof attr.value === 'number' ? attr.value : undefined;
              const charmVal =
                (typeof attr.value_int === 'number' ? attr.value_int : undefined)
                ?? decodedUint32
                ?? (attrNumber !== undefined && Number.isInteger(attrNumber) ? attrNumber : undefined);
              result.charm_id = charmVal !== undefined && charmVal > 0
                ? Math.trunc(charmVal)
                : undefined;
            }
            break;
        }
      }
    }

    return result;
  }

  // ---- Storage unit helpers ----

  /**
     * Upsert storage unit.
     *
     * Characteristics:
     * - @param item - The parameter for item
     * - @returns Nothing (void)
     *
     */
    private upsertStorageUnit(item: InventoryItem): void {
    const existing = this._storageUnits.get(item.id);
    this._storageUnits.set(item.id, {
      id: item.id,
      custom_name: item.custom_name,
      item_count: item.casket_contained_item_count ?? 0,
      items: existing?.items ?? [],
      isLoaded: existing?.isLoaded ?? false,
      isLoading: existing?.isLoading ?? false,
    });
  }

  // ---- Emit ----

  private _emitTimer: ReturnType<typeof setTimeout> | null = null;

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
   * Throttled emit: coalesces rapid-fire updates into a single event.
   * Uses 500ms window for incremental updates (item add/remove/change)
   * to avoid serializing thousands of items too frequently.
   */
  private emitUpdate(): void {
    if (this._emitTimer) return; // already scheduled
    this._emitTimer = setTimeout(() => {
      this._emitTimer = null;
      this.emit('inventory-updated', this.inventoryData);
    }, 500);
  }

  /** Emit immediately (used when state transitions matter, e.g. 'loaded') */
  private emitUpdateNow(): void {
    if (this._emitTimer) {
      clearTimeout(this._emitTimer);
      this._emitTimer = null;
    }
    this.emit('inventory-updated', this.inventoryData);
  }

  // ---- Reset ----

  /**
     * Reset.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    reset(): void {
    this._items.clear();
    this._storageUnits.clear();
    this._state = 'idle';
    this._error = undefined;
    this._casketContentsCallbacks.clear();
    this.invalidateCache();
    if (this._emitTimer) {
      clearTimeout(this._emitTimer);
      this._emitTimer = null;
    }
    this.emitUpdateNow();
  }

  /**
     * Destroy.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    destroy(): void {
    this.detachFromGC();
    this.reset();
    this.removeAllListeners();
  }
}
