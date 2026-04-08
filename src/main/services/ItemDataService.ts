// ============================================================
// CSInventoryPorter — ItemDataService
// Fetches and caches CS2 item database (names, images, rarity)
// from community API, with static-data fallback for offline use.
// Also loads bundled inventory data from cs2-inventory-resolver
// for comprehensive item name/image resolution (graffiti, stickers,
// keychains, music kits, collectibles, etc.)
// ============================================================

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import os from 'os';
import {
  WEAPON_DEFS,
  RARITY_INFO,
  buildClassToDefindex,
} from '../../shared/cs2-item-data';

/**
 * Resolved info for a specific item (defindex + paintIndex combination)
 */
export interface ResolvedItemInfo {
  name: string;        // Full name e.g. "AK-47 | Redline"
  skinName?: string;   // Just the skin part e.g. "Redline"
  weaponName?: string; // Just the weapon part e.g. "AK-47"
  image?: string;      // Full image URL
  rarityColor?: string;// Rarity hex color
  rarityName?: string; // Rarity tier name
  weaponType?: string; // e.g. "Rifle", "Pistol"
  rarity?: number;     // Numeric rarity (1..6) when known
  collectionId?: string;
  collectionName?: string;
  minFloat?: number;
  maxFloat?: number;
}

export interface TradeupSkinInfo {
  defindex: number;
  paintIndex: number;
  name: string;
  image?: string;
  rarity?: number;
  collectionId: string;
  collectionName?: string;
  minFloat: number;
  maxFloat: number;
  stattrak: boolean;
  souvenir: boolean;
}

/** Shape of a single entry in inventory.json lookup tables */
interface PackageItemEntry { name: string; image: string }

/** Shape of the bundled inventory.json from cs2-inventory-resolver */
interface PackageInventoryData {
  skins:        Record<string, Record<string, PackageItemEntry>>;
  crates:       Record<string, PackageItemEntry>;
  collectibles: Record<string, PackageItemEntry>;
  stickers:     Record<string, PackageItemEntry>;
  graffiti:     Record<string, PackageItemEntry>;
  music_kits:   Record<string, PackageItemEntry>;
  keychains:    Record<string, PackageItemEntry>;
  highlights:   Record<string, PackageItemEntry>;
}

interface CachedData {
  version: number;
  fetchedAt: number;
  skins: Array<{
    defindex: number;
    paintIndex: number;
    name: string;
    skinName?: string;
    weaponName?: string;
    image?: string;
    rarityColor?: string;
    rarityName?: string;
    weaponType?: string;
    rarity?: number;
    collectionId?: string;
    collectionName?: string;
    minFloat?: number;
    maxFloat?: number;
  }>;
  items: Array<{
    defindex: number;
    name: string;
    image?: string;
    type?: string;
    rarityColor?: string;
  }>;
  stickers?: Array<{
    stickerId: number;
    name: string;
    image?: string;
  }>;
  charms?: Array<{
    charmId: number;
    name: string;
    image?: string;
  }>;
  tradeupSkins?: TradeupSkinInfo[];
}

const CACHE_VERSION = 13;
const CACHE_FILE = 'item-database.json';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FETCH_TIMEOUT_MS = 30_000;

// Community-maintained CS2 item database (raw GitHub URLs — the .io domain redirects)
const API_BASE = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en';

// Manifest containing direct CDN image URLs keyed by game image paths.
const IMAGE_MANIFEST_URL = 'https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/refs/heads/main/static/images.json';

export class ItemDataService extends EventEmitter {
  private skinMap = new Map<string, ResolvedItemInfo>();  // "defindex:paintIndex" → info
  private itemMap = new Map<number, ResolvedItemInfo>();   // defindex → info (for non-skin items)
  private tradeupSkins: TradeupSkinInfo[] = [];
  private stickerMap = new Map<number, { name: string; image?: string }>(); // sticker_id → name+image
  private charmMap = new Map<number, { name: string; image?: string }>(); // charm_id → name+image
  private imageManifest = new Map<string, string>(); // "econ/..." path -> direct CDN URL
  private toolManifestKeys: string[] = []; // pre-indexed manifest keys under econ/tools/
  private imageManifestLoaded = false;
  private classToDefindex: Map<string, number>;
  private cacheDir: string;
  private _initialized = false;
  /** Bundled data from cs2-inventory-resolver for comprehensive item resolution */
  private packageData: PackageInventoryData | null = null;

  constructor(userDataPath: string) {
    super();
    this.cacheDir = userDataPath;
    this.classToDefindex = buildClassToDefindex();
  }

  get initialized(): boolean {
    return this._initialized;
  }

  /**
     * Gets tradeup skins.
     *
     * Characteristics:
     * - @returns import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/main/services/ItemDataService").TradeupSkinInfo[]
     *
     */
    getTradeupSkins(): TradeupSkinInfo[] {
    return this.tradeupSkins;
  }

  // ---- Initialization ----

  /**
     * Initialize.
     *
     * Characteristics:
     * - @returns Promise<void>
     *
     */
    async initialize(): Promise<void> {
    if (this._initialized) return;

    // 0. Load bundled inventory.json from cs2-inventory-resolver package (sync, fast)
    this.loadPackageData();

    // 1. Try loading from disk cache first (fast)
    const loaded = this.loadFromCache();
    if (loaded) {
      console.log(`[ItemDataService] Loaded ${this.skinMap.size} skins from cache`);
      this._initialized = true;

      // Also populate stickerMap from the bundled sticker data if cache had none
      if (this.stickerMap.size === 0) {
        this.populateStickersFromPackage();
      }
      if (this.charmMap.size === 0) {
        this.populateCharmsFromPackage();
      }
      this.enrichFromLocalBackupFallback();
      await this.populateStaticWeapons();

      // Background refresh if cache is stale
      const cacheFile = path.join(this.cacheDir, CACHE_FILE);
      try {
        const stat = fs.statSync(cacheFile);
        if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
          console.log('[ItemDataService] Cache is stale, refreshing in background...');
          this.fetchAndCache().catch((err) =>
            console.warn('[ItemDataService] Background refresh failed:', err.message),
          );
        }
      } catch { /* ignore */ }
      return;
    }

    // 2. No cache — fetch from API (blocks until done or timeout)
    console.log('[ItemDataService] No cache found, fetching from community API...');
    try {
      await this.fetchAndCache();
      console.log(
        `[ItemDataService] Fetched: ${this.skinMap.size} skins, ${this.itemMap.size} items`,
      );
    } catch (err: any) {
      console.warn('[ItemDataService] API fetch failed, using static data only:', err.message);
    }

    // 3. Always populate static weapon entries as final fallback
    await this.populateStaticWeapons();

    // 4. Populate stickerMap from bundled data if not loaded from API/cache
    if (this.stickerMap.size === 0) {
      this.populateStickersFromPackage();
    }
    if (this.charmMap.size === 0) {
      this.populateCharmsFromPackage();
    }
    this.enrichFromLocalBackupFallback();

    this._initialized = true;
  }

  // ---- Public lookups ----

  /**
   * Get resolved info for an item by defindex + optional paintIndex
   */
  getItemInfo(defindex: number, paintIndex?: number): ResolvedItemInfo | undefined {
    if (paintIndex !== undefined && paintIndex > 0) {
      const key = `${defindex}:${paintIndex}`;
      const skinInfo = this.skinMap.get(key);
      // Debug music kit lookups
      if (defindex === 1314) {
        console.log(`[ItemDataService] Music kit lookup: key="${key}" found=${!!skinInfo} skinMapSize=${this.skinMap.size}`);
        if (!skinInfo) {
          // Log nearby keys to help debug
          const musicKeys = [...this.skinMap.keys()].filter(k => k.startsWith('1314:')).slice(0, 5);
          console.log(`[ItemDataService] Available music kit keys (first 5):`, musicKeys);
        }
      }
      if (skinInfo) return skinInfo;
    }
    return this.itemMap.get(defindex);
  }

  /**
   * Resolve a human-readable item name
   */
  resolveItemName(
    defindex: number,
    paintIndex?: number,
    killEaterScoreType?: number,
    quality?: number,
  ): string {
    const info = this.getItemInfo(defindex, paintIndex);

    let name: string;
    if (info) {
      name = info.name;
    } else {
      // Static fallback
      const weaponDef = WEAPON_DEFS[defindex];
      name = weaponDef?.name ?? `Item #${defindex}`;
    }

    // Add StatTrak™ prefix
    if (killEaterScoreType !== undefined) {
      if (!name.startsWith('StatTrak')) {
        name = `StatTrak™ ${name}`;
      }
    }
    // Add Souvenir prefix
    else if (quality === 12) {
      if (!name.startsWith('Souvenir')) {
        name = `Souvenir ${name}`;
      }
    }

    return name;
  }

  /**
   * Get the image URL for an item
   */
  getImageUrl(defindex: number, paintIndex?: number): string | undefined {
    const info = this.getItemInfo(defindex, paintIndex);
    return info?.image;
  }

  /**
   * Get rarity color for an item
   */
  getRarityColor(defindex: number, paintIndex?: number, rawRarity?: number): string | undefined {
    const info = this.getItemInfo(defindex, paintIndex);
    if (info?.rarityColor) return info.rarityColor;
    if (rawRarity !== undefined) return RARITY_INFO[rawRarity]?.color;
    return undefined;
  }

  /**
   * Get weapon type string
   */
  getWeaponType(defindex: number, paintIndex?: number): string | undefined {
    const info = this.getItemInfo(defindex, paintIndex);
    if (info?.weaponType) return info.weaponType;
    return WEAPON_DEFS[defindex]?.type;
  }

  /**
   * Look up a sticker by its numeric sticker_id.
   */
  getStickerInfo(stickerId: number): { name: string; image?: string } | undefined {
    return this.stickerMap.get(stickerId);
  }

  /**
   * Look up an attached charm by numeric charm_id.
   */
  getCharmInfo(charmId: number): { name: string; image?: string } | undefined {
    return this.charmMap.get(charmId);
  }

  /**
   * Comprehensive item resolution using the bundled cs2-inventory-resolver data.
   * Takes the raw GC item object and resolves name, image, and category by checking:
   *   1. Skins (def_index + paint_index)
   *   2. Music kits (attribute 166)
   *   3. Highlights / souvenir charms (attribute 314)
   *   4. Keychains (attribute 299)
   *   5. Graffiti (stickers[0].sticker_id + attribute 233 tint)
  *   6. Tools (def_index)
  *   7. Crates / cases / keys (def_index)
  *   8. Collectibles (def_index)
  *   9. Stickers / patches (stickers[0].sticker_id)
   */
  resolveItemFromRaw(raw: any): { name: string; image?: string; category: string } | null {
    if (!this.packageData) return null;

    const data = this.packageData;
    const defIdx = String(raw.def_index ?? raw.defindex ?? 0);
    const paintIndexRaw = raw.paint_index ?? raw.paintkit ?? raw.paintKit;
    const attrs = raw.attribute ?? raw.attributes ?? [];

    // Helper to read uint32 from attribute value_bytes
    const toBuffer = (valueBytes: any): Buffer | null => {
      try {
        if (!valueBytes) return null;
        if (Buffer.isBuffer(valueBytes)) return valueBytes;
        if (valueBytes instanceof Uint8Array) return Buffer.from(valueBytes);
        if (Array.isArray(valueBytes)) return Buffer.from(valueBytes);
        if (typeof valueBytes === 'string') return Buffer.from(valueBytes, 'base64');
        if (Array.isArray(valueBytes.data)) return Buffer.from(valueBytes.data);
        return null;
      } catch {
        return null;
      }
    };

    const getAttrUint32 = (attrDefIndex: number): number | undefined => {
      if (!Array.isArray(attrs)) return undefined;
      const attrib = attrs.find((a: any) => Number(a.def_index) === attrDefIndex);
      if (!attrib) return undefined;

      if (typeof attrib.value_int === 'number') return attrib.value_int;
      if (typeof attrib.value === 'number') return Math.round(attrib.value);

      const buf = toBuffer(attrib.value_bytes);
      if (!buf || buf.length < 4) return undefined;
      try {
        return buf.readUInt32LE(0);
      } catch { return undefined; }
    };

    const paintIndex = Number(paintIndexRaw ?? getAttrUint32(6) ?? 0);
    const defNum = parseInt(defIdx, 10);

    const musicIndex = getAttrUint32(166);
    const graffitiTint = getAttrUint32(233);
    const highlightIndex = getAttrUint32(314);
    const keychainIndex = getAttrUint32(299);
    const staticType = WEAPON_DEFS[defNum]?.type;
    const isToolLike = staticType === 'Tool';

    // 1. Skins: def_index + paint_index
    if (paintIndex > 0) {
      const weapon = data.skins[defIdx];
      if (weapon) {
        const skin = weapon[String(paintIndex)];
        if (skin) return { name: skin.name, image: skin.image, category: 'skin' };
      }
    }

    // 2. Music kits: music_index (attribute 166)
    if (musicIndex && musicIndex > 0) {
      const kit = data.music_kits[String(musicIndex)];
      if (kit) return { name: kit.name, image: kit.image, category: 'music_kit' };
    }

    // 3. Highlights (souvenir charms): highlight_index (attribute 314)
    if (highlightIndex && highlightIndex > 0) {
      const highlight = data.highlights[String(highlightIndex)];
      if (highlight) return { name: highlight.name, image: highlight.image, category: 'highlight' };
    }

    // 4. Keychains (charms): keychain_index (attribute 299)
    if (!isToolLike && keychainIndex && keychainIndex > 0) {
      const keychain = data.keychains[String(keychainIndex)];
      if (keychain) return { name: keychain.name, image: keychain.image, category: 'keychain' };
    }

    // 5.5 Tools: resolve from centralized itemMap so tool handling stays in one place
    if (isToolLike) {
      const toolInfo = this.itemMap.get(defNum);
      if (toolInfo) {
        return { name: toolInfo.name, image: toolInfo.image, category: 'tool' };
      }
    }

    // 6. Graffiti: sticker_id from raw.stickers[0] OR paintIndex + graffiti_tint (attr 233)
    //    Only for defindex 1348 (sealed graffiti) or 1349 (graffiti)
    const rawStickers = raw.stickers ?? [];
    if (defNum === 1348 || defNum === 1349) {
      const stickerIdFromArray = rawStickers.length > 0
        ? Number(rawStickers[0]?.sticker_id ?? rawStickers[0]?.stickerId ?? 0)
        : 0;
      const candidateGraffitiIds = [
        stickerIdFromArray > 0 ? stickerIdFromArray : undefined,
        paintIndex > 0 ? paintIndex : undefined,
      ].filter((id): id is number => typeof id === 'number' && id > 0);

      for (const stickerId of candidateGraffitiIds) {
        if (graffitiTint !== undefined) {
          const tintedKey = `${stickerId}_${graffitiTint}`;
          const tinted = data.graffiti[tintedKey];
          if (tinted) return { name: tinted.name, image: tinted.image, category: 'graffiti' };
        }

        // Some entries are keyed with explicit _0 for default tint.
        const defaultTint = data.graffiti[`${stickerId}_0`];
        if (defaultTint) return { name: defaultTint.name, image: defaultTint.image, category: 'graffiti' };

        const mono = data.graffiti[String(stickerId)];
        if (mono) return { name: mono.name, image: mono.image, category: 'graffiti' };
      }
    }

    // 7. Crates / cases / keys
    const crate = data.crates[defIdx];
    if (crate) return { name: crate.name, image: crate.image, category: 'crate' };

    // 8. Collectibles (coins, pins, etc.)
    const collectible = data.collectibles[defIdx];
    if (collectible) return { name: collectible.name, image: collectible.image, category: 'collectible' };

    // 9. Stickers/patches as items: only for actual sticker (1209) and patch (4609) defindexes.
    //    Do NOT match step 8 for weapons/tools that happen to have stickers applied —
    //    this prevents a stickered USP-S or StatTrak Swap Tool from being resolved as a sticker.
    //    For sticker ITEMS, the sticker kit ID is stored either in raw.stickers[0].sticker_id
    //    OR in paintIndex (attribute 6) — the game reuses the paint kit slot for sticker kit IDs.
    if (defNum === 1209 || defNum === 4609) {
      const stickerIdFromArray = rawStickers.length > 0
        ? (rawStickers[0]?.sticker_id ?? rawStickers[0]?.stickerId)
        : undefined;
      // For sticker items, paintIndex (attr 6) is usually authoritative.
      const candidateIds = [
        paintIndex > 0 ? paintIndex : undefined,
        typeof stickerIdFromArray === 'number' && stickerIdFromArray > 0 ? stickerIdFromArray : undefined,
      ].filter((id): id is number => typeof id === 'number' && id > 0);

      const isPatch = defNum === 4609;
      const category = isPatch ? 'patch' : 'sticker';

      for (const stickerId of candidateIds) {
        // Primary: bundled inventory data
        const sticker = data.stickers[String(stickerId)];
        if (sticker) return { name: sticker.name, image: sticker.image, category };

        // Fallback: API-fetched stickerMap (covers items not in bundled data)
        const stickerInfo = this.stickerMap.get(stickerId);
        if (stickerInfo) {
          const prefix = isPatch ? 'Patch | ' : 'Sticker | ';
          const fullName = stickerInfo.name.startsWith(prefix)
            ? stickerInfo.name
            : `${prefix}${stickerInfo.name}`;
          return { name: fullName, image: stickerInfo.image, category };
        }
      }
    }

    return null;
  }

  /**
   * Read a uint32 attribute value from a raw GC item's attribute array.
   * Used for phantom item filtering (attribute 277), graffiti tint (233), etc.
   */
  static getAttributeUint32(raw: any, attrDefIndex: number): number | undefined {
    const attrs = raw?.attribute ?? raw?.attributes ?? [];
    if (!Array.isArray(attrs)) return undefined;
    const attrib = attrs.find((a: any) => Number(a.def_index) === attrDefIndex);

    if (!attrib) return undefined;
    if (typeof attrib.value_int === 'number') return attrib.value_int;
    if (typeof attrib.value === 'number') return Math.round(attrib.value);

    const toBuffer = (valueBytes: any): Buffer | null => {
      try {
        if (!valueBytes) return null;
        if (Buffer.isBuffer(valueBytes)) return valueBytes;
        if (valueBytes instanceof Uint8Array) return Buffer.from(valueBytes);
        if (Array.isArray(valueBytes)) return Buffer.from(valueBytes);
        if (typeof valueBytes === 'string') return Buffer.from(valueBytes, 'base64');
        if (Array.isArray(valueBytes.data)) return Buffer.from(valueBytes.data);
        return null;
      } catch {
        return null;
      }
    };

    const buf = toBuffer(attrib.value_bytes);
    if (!buf || buf.length < 4) return undefined;
    try {
      return buf.readUInt32LE(0);
    } catch { return undefined; }
  }

  // ---- Cache management ----

  /**
     * Loads from cache.
     *
     * Characteristics:
     * - @returns boolean
     *
     */
    private loadFromCache(): boolean {
    const cacheFile = path.join(this.cacheDir, CACHE_FILE);
    try {
      if (!fs.existsSync(cacheFile)) return false;

      const raw = fs.readFileSync(cacheFile, 'utf-8');
      const data: CachedData = JSON.parse(raw);

      if (data.version !== CACHE_VERSION) return false;

      // Load skins
      for (const skin of data.skins) {
        this.skinMap.set(`${skin.defindex}:${skin.paintIndex}`, {
          name: skin.name,
          skinName: skin.skinName,
          weaponName: skin.weaponName,
          image: skin.image,
          rarityColor: skin.rarityColor,
          rarityName: skin.rarityName,
          weaponType: skin.weaponType,
          rarity: skin.rarity,
          collectionId: skin.collectionId,
          collectionName: skin.collectionName,
          minFloat: skin.minFloat,
          maxFloat: skin.maxFloat,
        });
      }

      if (Array.isArray(data.tradeupSkins)) {
        this.tradeupSkins = data.tradeupSkins;
      }

      // Load non-skin items
      for (const item of data.items) {
        this.itemMap.set(item.defindex, {
          name: item.name,
          image: item.image,
          weaponType: item.type,
          rarityColor: item.rarityColor,
        });
      }

      // Load stickers
      if (data.stickers) {
        for (const s of data.stickers) {
          this.stickerMap.set(s.stickerId, { name: s.name, image: s.image });
        }
        console.log(`[ItemDataService] Loaded ${this.stickerMap.size} stickers from cache`);
      }

      if (data.charms) {
        for (const c of data.charms) {
          this.charmMap.set(c.charmId, { name: c.name, image: c.image });
        }
        console.log(`[ItemDataService] Loaded ${this.charmMap.size} charms from cache`);
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
     * Save to cache.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private saveToCache(): void {
    const cacheFile = path.join(this.cacheDir, CACHE_FILE);
    try {
      const data: CachedData = {
        version: CACHE_VERSION,
        fetchedAt: Date.now(),
        skins: [],
        items: [],
        stickers: [],
      };

      for (const [key, info] of this.skinMap.entries()) {
        const [defStr, paintStr] = key.split(':');
        data.skins.push({
          defindex: parseInt(defStr, 10),
          paintIndex: parseInt(paintStr, 10),
          name: info.name,
          skinName: info.skinName,
          weaponName: info.weaponName,
          image: info.image,
          rarityColor: info.rarityColor,
          rarityName: info.rarityName,
          weaponType: info.weaponType,
          rarity: info.rarity,
          collectionId: info.collectionId,
          collectionName: info.collectionName,
          minFloat: info.minFloat,
          maxFloat: info.maxFloat,
        });
      }

      data.tradeupSkins = this.tradeupSkins;

      for (const [defindex, info] of this.itemMap.entries()) {
        data.items.push({
          defindex,
          name: info.name,
          image: info.image,
          type: info.weaponType,
          rarityColor: info.rarityColor,
        });
      }

      for (const [stickerId, info] of this.stickerMap.entries()) {
        data.stickers!.push({
          stickerId,
          name: info.name,
          image: info.image,
        });
      }

      data.charms = [];
      for (const [charmId, info] of this.charmMap.entries()) {
        data.charms.push({
          charmId,
          name: info.name,
          image: info.image,
        });
      }

      fs.writeFileSync(cacheFile, JSON.stringify(data), 'utf-8');
      console.log(`[ItemDataService] Cache saved: ${data.skins.length} skins, ${data.items.length} items, ${data.stickers!.length} stickers`);
    } catch (err: any) {
      console.warn('[ItemDataService] Failed to save cache:', err.message);
    }
  }

  // ---- API fetching ----

  /**
     * Fetches and cache.
     *
     * Characteristics:
     * - @returns Promise<void>
     *
     */
    private async fetchAndCache(): Promise<void> {
    console.log('[ItemDataService] Fetching from:', API_BASE);

    // Only fetch endpoints whose API IDs correspond to real game defindexes.
    // Stickers use internal sticker IDs that collide with weapon defindexes
    // (e.g. sticker-7 would overwrite AK-47 at defindex 7) — so they are
    // processed into a SEPARATE stickerMap keyed by sticker_id, not into itemMap.
    // Music kits are stored in skinMap under key "1314:kitNumber".
    //
    // Collectibles (medals, coins, badges, pins) are SAFE — their defindexes
    // start at 874+ and don't collide with weapons (1-64, 500-526, 5027-5033).
    const results = await Promise.allSettled([
      this.fetchJSON(`${API_BASE}/skins.json`),
      this.fetchJSON(`${API_BASE}/collections.json`),
      this.fetchJSON(`${API_BASE}/crates.json`),
      this.fetchJSON(`${API_BASE}/tools.json`),
      this.fetchJSON(`${API_BASE}/agents.json`),
      this.fetchJSON(`${API_BASE}/collectibles.json`),
      this.fetchJSON(`${API_BASE}/music_kits.json`),
      this.fetchJSON(`${API_BASE}/stickers.json`),
      this.fetchJSON(`${API_BASE}/keychains.json`),
      this.fetchJSON(`${API_BASE}/base_weapons.json`),
    ]);

    const [skins, collections, crates, tools, agents, collectibles, musicKits, stickers, keychains, baseWeapons] = results;

    // Load manifest once so both static fallback and generic processors can use
    // direct CDN images (weapons + tools).
    await this.loadImageManifest();

    let skinCount = 0;
    let itemCount = 0;

    if (skins.status === 'fulfilled' && Array.isArray(skins.value)) {
      this.tradeupSkins = [];
      skinCount = this.processSkins(skins.value);
      console.log(`[ItemDataService] Processed ${skinCount} weapon skins`);
    } else {
      console.warn('[ItemDataService] Failed to fetch skins:',
        skins.status === 'rejected' ? skins.reason?.message : 'not an array');
    }

    if (collections.status === 'fulfilled' && Array.isArray(collections.value)) {
      itemCount += this.processCollections(collections.value);
    }

    if (crates.status === 'fulfilled' && Array.isArray(crates.value)) {
      itemCount += this.processGenericById(crates.value, 'Case');
    }
    if (tools.status === 'fulfilled' && Array.isArray(tools.value)) {
      itemCount += this.processGenericById(tools.value, 'Tool');
    }
    if (agents.status === 'fulfilled' && Array.isArray(agents.value)) {
      itemCount += this.processGenericById(agents.value, 'Agent');
    }
    if (collectibles.status === 'fulfilled' && Array.isArray(collectibles.value)) {
      itemCount += this.processCollectibles(collectibles.value);
    }
    if (musicKits.status === 'fulfilled' && Array.isArray(musicKits.value)) {
      const mkCount = this.processMusicKits(musicKits.value);
      console.log(`[ItemDataService] Processed ${mkCount} music kits`);
    }
    if (stickers.status === 'fulfilled' && Array.isArray(stickers.value)) {
      const stickerCount = this.processStickers(stickers.value);
      console.log(`[ItemDataService] Processed ${stickerCount} stickers`);
    } else {
      console.warn('[ItemDataService] Failed to fetch stickers:',
        stickers.status === 'rejected' ? (stickers as PromiseRejectedResult).reason?.message : 'not an array');
      // Fallback: populate stickers from bundled data
      this.populateStickersFromPackage();
    }

    if (keychains.status === 'fulfilled' && Array.isArray(keychains.value)) {
      const keychainCount = this.processKeychains(keychains.value);
      console.log(`[ItemDataService] Processed ${keychainCount} keychains from API`);
    } else {
      console.warn('[ItemDataService] Failed to fetch keychains:',
        keychains.status === 'rejected' ? (keychains as PromiseRejectedResult).reason?.message : 'not an array');
    }

    // Always supplement with bundled charm data — populateCharmsFromPackage has an
    // internal has() guard so it only adds entries the API didn't already cover.
    this.populateCharmsFromPackage();

    if (baseWeapons.status === 'fulfilled' && Array.isArray(baseWeapons.value)) {
      const bwCount = this.processBaseWeapons(baseWeapons.value);
      console.log(`[ItemDataService] Processed ${bwCount} base weapons`);
    }

    // Final fallback: best-effort parse from skinledger game files for unresolved defindexes.
    await this.enrichFromSkinledgerFallback();

    console.log(`[ItemDataService] Processed ${itemCount} generic items (crates + agents + collectibles)`);

    // Populate static weapons as fallback
    await this.populateStaticWeapons();

    this.saveToCache();
  }

  // ---- Processors ----

  /**
   * Process skins.json (grouped by skin, NOT by wear/stattrak variant).
   * Each entry has: weapon.weapon_id (defindex), paint_index, name, image.
   * Using grouped format avoids getting wear suffixes like "(Factory New)" in names.
   */
  private processSkins(skins: any[]): number {
    let count = 0;
    const seenTradeupKeys = new Set<string>();

    const getRarityLevel = (rarity: any): number | undefined => {
      const id = String(rarity?.id ?? '').toLowerCase();
      const name = String(rarity?.name ?? '').toLowerCase();
      const token = `${id} ${name}`;

      if (token.includes('consumer')) return 1;
      if (token.includes('industrial')) return 2;
      if (token.includes('mil-spec') || token.includes('milspec')) return 3;
      if (token.includes('restricted')) return 4;
      if (token.includes('classified') || token.includes('legendary')) return 5;
      if (token.includes('covert') || token.includes('ancient')) return 6;
      return undefined;
    };

    for (const skin of skins) {
      try {
        const paintIndex = parseInt(skin.paint_index, 10);
        if (isNaN(paintIndex) || paintIndex <= 0) continue;

        // Get defindex: prefer weapon.weapon_id (numeric), fallback to className lookup
        let defindex: number | undefined = skin.weapon?.weapon_id;
        if (!defindex && skin.weapon?.id) {
          defindex = this.classToDefindex.get(skin.weapon.id);
        }
        if (!defindex || defindex <= 0) continue;

        const rarity = getRarityLevel(skin.rarity);
        const minFloat = typeof skin.min_float === 'number' ? skin.min_float : 0;
        const maxFloat = typeof skin.max_float === 'number' ? skin.max_float : 1;
        const collection = Array.isArray(skin.collections) && skin.collections.length > 0
          ? skin.collections[0]
          : undefined;
        const collectionId = collection?.id ? String(collection.id) : undefined;
        const collectionName = collection?.name ? String(collection.name) : undefined;

        const key = `${defindex}:${paintIndex}`;
        this.skinMap.set(key, {
          name: skin.name || `${skin.weapon?.name ?? 'Unknown'} | ${skin.pattern?.name ?? 'Unknown'}`,
          skinName: skin.pattern?.name,
          weaponName: skin.weapon?.name,
          image: skin.image,
          rarityColor: skin.rarity?.color,
          rarityName: skin.rarity?.name,
          weaponType: skin.category?.name ?? WEAPON_DEFS[defindex]?.type,
          rarity,
          collectionId,
          collectionName,
          minFloat,
          maxFloat,
        });

        if (Array.isArray(skin.collections) && skin.collections.length > 0 && rarity !== undefined) {
          for (const c of skin.collections) {
            const cId = c?.id ? String(c.id) : '';
            if (!cId) continue;

            const entryKey = `${defindex}:${paintIndex}:${skin.stattrak ? 1 : 0}:${cId}`;
            if (seenTradeupKeys.has(entryKey)) continue;
            seenTradeupKeys.add(entryKey);

            this.tradeupSkins.push({
              defindex,
              paintIndex,
              name: skin.name || `${skin.weapon?.name ?? 'Unknown'} | ${skin.pattern?.name ?? 'Unknown'}`,
              image: skin.image,
              rarity,
              collectionId: cId,
              collectionName: c?.name ? String(c.name) : undefined,
              minFloat,
              maxFloat,
              stattrak: !!skin.stattrak,
              souvenir: !!skin.souvenir,
            });
          }
        }

        count++;
      } catch {
        // Skip malformed
      }
    }
    return count;
  }

  /**
   * Process collections.json as an additional source of defindex-level item names/images.
   * This is best-effort and only fills gaps not already covered by stronger sources.
   */
  private processCollections(collections: any[]): number {
    let count = 0;

    const ingest = (entry: any) => {
      const hasExplicitDefindex = entry?.def_index !== undefined || entry?.defindex !== undefined;
      if (!hasExplicitDefindex) return;

      const defindex = this.extractDefindexFromAny(entry);
      if (!defindex || this.itemMap.has(defindex)) return;

      const name = this.extractReadableName(entry);
      if (!name) return;
      // Do not map skin-style names (weapon | skin) onto defindex-level fallback entries.
      if (name.includes('|')) return;

      this.itemMap.set(defindex, {
        name,
        image: entry?.image,
        weaponType: entry?.type || entry?.category?.name,
        rarityColor: entry?.rarity?.color,
      });
      count++;
    };

    for (const collection of collections) {
      ingest(collection);
      if (Array.isArray(collection?.items)) {
        for (const item of collection.items) ingest(item);
      }
      if (Array.isArray(collection?.contains)) {
        for (const item of collection.contains) ingest(item);
      }
    }

    if (count > 0) {
      console.log(`[ItemDataService] Processed ${count} collection-derived fallback items`);
    }

    return count;
  }

  /**
   * Process collectibles.json — medals, coins, badges, pins.
   * Uses the explicit `def_index` field for accuracy (they have real game defindexes).
   */
  private processCollectibles(items: any[]): number {
    let count = 0;
    for (const item of items) {
      try {
        const defindex = parseInt(item.def_index, 10);
        if (!defindex || defindex <= 0) continue;

        if (!this.itemMap.has(defindex)) {
          this.itemMap.set(defindex, {
            name: item.name || `Collectible #${defindex}`,
            image: item.image,
            weaponType: item.type || 'Collectible',
            rarityColor: item.rarity?.color,
          });
          count++;
        }
      } catch {
        // Skip malformed
      }
    }
    return count;
  }

  /**
   * Process music_kits.json — store in skinMap keyed as 1314:kitNumber.
   * This lets getItemInfo(1314, musicKitId) resolve specific kit names/images.
   * Only process non-StatTrak entries (StatTrak prefix is added separately by quality).
   */
  private processMusicKits(items: any[]): number {
    let count = 0;
    // Log first 3 items to understand the data structure
    console.log(`[ItemDataService] processMusicKits: ${items.length} items, sample:`,
      JSON.stringify(items.slice(0, 3).map(i => ({
        id: i.id, name: i.name, def_index: i.def_index, index: i.index,
      }))));

    for (const item of items) {
      try {
        // Skip StatTrak variants (id ends with "_st")
        if (typeof item.id === 'string' && item.id.endsWith('_st')) continue;

        // Try def_index first, then index, then parse from id
        let kitNumber = parseInt(item.def_index, 10) || parseInt(item.index, 10) || 0;
        if (!kitNumber || kitNumber <= 0) {
          // Try extracting number from id like "music_kit-01"
          const match = String(item.id || '').match(/(\d+)/);
          if (match) kitNumber = parseInt(match[1], 10);
        }
        if (!kitNumber || kitNumber <= 0) continue;

        const key = `1314:${kitNumber}`;
        if (!this.skinMap.has(key)) {
          this.skinMap.set(key, {
            name: item.name || `Music Kit #${kitNumber}`,
            image: item.image,
            weaponType: 'Music Kit',
            rarityColor: item.rarity?.color,
            rarityName: item.rarity?.name,
          });
          count++;
        }
      } catch {
        // Skip malformed
      }
    }
    console.log(`[ItemDataService] processMusicKits: stored ${count} kits in skinMap`);
    return count;
  }

  /**
   * Process stickers.json — populate stickerMap keyed by sticker_id (the in-game ID).
   * The ByMykel API stickers have: id ("sticker-75"), name, image, sticker_id (optional).
   * We extract the numeric ID from sticker_id field if present, otherwise from the id string.
   */
  private processStickers(items: any[]): number {
    let count = 0;
    // Log first item to verify data structure
    if (items.length > 0) {
      const s = items[0];
      console.log(`[ItemDataService] stickers.json sample: id=${s.id} def_index=${s.def_index} name=${s.name}`);
    }
    for (const item of items) {
      try {
        // Try def_index (the actual sticker kit ID in the ByMykel API),
        // then sticker_id, then extract from id string
        let stickerId = parseInt(item.def_index, 10) || 0;
        if (!stickerId) {
          stickerId = typeof item.sticker_id === 'number' ? item.sticker_id : 0;
        }
        if (!stickerId && item.id) {
          const match = String(item.id).match(/-(\d+)$/);
          if (match) stickerId = parseInt(match[1], 10);
        }
        if (!stickerId || stickerId <= 0) continue;

        // Strip "Sticker | " prefix for cleaner display
        let name = item.name || `Sticker #${stickerId}`;
        if (name.startsWith('Sticker | ')) {
          name = name.substring('Sticker | '.length);
        }

        if (!this.stickerMap.has(stickerId)) {
          this.stickerMap.set(stickerId, {
            name,
            image: item.image,
          });
          count++;
        }
      } catch {
        // Skip malformed
      }
    }
    return count;
  }

  /**
   * Process keychains.json — populate charmMap keyed by def_index (the keychain ID).
   * def_index corresponds to attribute 299 (keychain_index) on raw GC items.
   */
  private processKeychains(items: any[]): number {
    let count = 0;
    for (const item of items) {
      try {
        let charmId = parseInt(item.def_index, 10) || 0;
        if (!charmId && item.id) {
          const match = String(item.id).match(/-(\d+)$/);
          if (match) charmId = parseInt(match[1], 10);
        }
        if (!charmId || charmId <= 0) continue;

        if (!this.charmMap.has(charmId)) {
          this.charmMap.set(charmId, {
            name: item.name || `Charm #${charmId}`,
            image: item.image,
          });
          count++;
        }
      } catch {
        // Skip malformed
      }
    }
    return count;
  }

  /**
   * Process base_weapons.json — provides images for default (unskinned) weapons.
   * Uses def_index or weapon.weapon_id to identify items.
   * Only fills image gaps; does not overwrite names already in itemMap.
   */
  private processBaseWeapons(items: any[]): number {
    let count = 0;
    for (const item of items) {
      try {
        const defindex = parseInt(item.def_index ?? item.weapon?.weapon_id, 10);
        if (!defindex || defindex <= 0) continue;

        const existing = this.itemMap.get(defindex);
        if (existing && existing.image) continue; // already have an image

        const image = item.image;
        if (!image) continue;

        if (existing) {
          existing.image = image;
        } else {
          this.itemMap.set(defindex, {
            name: item.name || item.weapon?.name || `Weapon #${defindex}`,
            image,
            weaponType: item.category?.name || WEAPON_DEFS[defindex]?.type,
            rarityColor: item.rarity?.color,
          });
        }
        count++;
      } catch {
        // Skip malformed
      }
    }
    return count;
  }

  /**
   * Generic processor for all non-skin items: crates, agents, stickers, etc.
   * Extracts numeric defindex from the id field (e.g. "crate-4904" → 4904).
   */
  private processGenericById(items: any[], type: string): number {
    let count = 0;
    for (const item of items) {
      try {
        const defindex = this.extractDefindexFromAny(item);
        if (!defindex) continue;

        const manifestImage = this.resolveManifestImageForGenericItem(defindex, type, item);
        const resolvedImage = manifestImage || item.image;

        const existing = this.itemMap.get(defindex);
        if (!existing) {
          this.itemMap.set(defindex, {
            name: item.name || item.market_hash_name || `${type} #${defindex}`,
            image: resolvedImage,
            weaponType: type,
            rarityColor: item.rarity?.color,
          });
          count++;
        } else if (!existing.image && resolvedImage) {
          existing.image = resolvedImage;
        }
      } catch {
        // Skip
      }
    }
    return count;
  }

  /**
     * Resolve manifest image for generic item.
     *
     * Characteristics:
     * - @param defindex - The parameter for defindex
     * - @param type - The parameter for type
     * - @param item - The parameter for item
     * - @returns string
     *
     */
    private resolveManifestImageForGenericItem(defindex: number, type: string, item: any): string | undefined {
    const staticDef = WEAPON_DEFS[defindex];
    const byStaticClass = this.resolveStaticImageFromManifest(staticDef?.className, staticDef?.type || type);
    if (byStaticClass) return byStaticClass;

    if (type === 'Tool') {
      // 1) Class-like fields from API payload, if present.
      const classLike = [
        item?.className,
        item?.class_name,
        item?.item_class,
      ].filter((v) => typeof v === 'string') as string[];

      for (const cls of classLike) {
        const byClass = this.resolveStaticImageFromManifest(cls, 'Tool');
        if (byClass) return byClass;
      }

      // 2) If API image URL already encodes econ/tools/<slug>, map directly.
      const fromImageUrl = this.extractToolManifestKeyFromUrl(item?.image);
      if (fromImageUrl) {
        const byUrlKey = this.imageManifest.get(fromImageUrl);
        if (byUrlKey) return byUrlKey;
      }

      // 3) Generic name-based best match over all econ/tools/* keys.
      const byName = this.findToolManifestImageByName(item?.name || item?.market_hash_name);
      if (byName) return byName;

      // 4) Last fallback for unresolved key-like tools.
      return this.imageManifest.get('econ/tools/coupon_key');
    }

    return undefined;
  }

  /**
     * Extract tool manifest key from url.
     *
     * Characteristics:
     * - @param rawUrl - The parameter for rawUrl
     * - @returns string
     *
     */
    private extractToolManifestKeyFromUrl(rawUrl: any): string | undefined {
    if (typeof rawUrl !== 'string' || rawUrl.length === 0) return undefined;

    const toolPathMatch = rawUrl.match(/econ\/tools\/([a-z0-9_]+)/i);
    if (!toolPathMatch) return undefined;

    return `econ/tools/${toolPathMatch[1].toLowerCase()}`;
  }

  /**
     * Normalize lookup text.
     *
     * Characteristics:
     * - @param value - The parameter for value
     * - @returns string
     *
     */
    private normalizeLookupText(value: any): string {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /**
     * Expand tool tokens.
     *
     * Characteristics:
     * - @param tokens - The parameter for tokens
     * - @returns Set<string>
     *
     */
    private expandToolTokens(tokens: Set<string>): Set<string> {
    const expanded = new Set<string>(tokens);
    const addBoth = (a: string, b: string) => {
      if (expanded.has(a)) expanded.add(b);
      if (expanded.has(b)) expanded.add(a);
    };

    addBoth('charm', 'keychain');
    addBoth('detach', 'remove');
    addBoth('detachment', 'remove');
    addBoth('detachments', 'remove');
    addBoth('removal', 'remove');

    return expanded;
  }

  /**
     * Find tool manifest image by name.
     *
     * Characteristics:
     * - @param rawName - The parameter for rawName
     * - @returns string
     *
     */
    private findToolManifestImageByName(rawName: any): string | undefined {
    const normalizedName = this.normalizeLookupText(rawName);
    if (!normalizedName) return undefined;

    const nameTokens = this.expandToolTokens(new Set(normalizedName.split(' ').filter(Boolean)));
    if (nameTokens.size === 0) return undefined;

    let bestKey: string | undefined;
    let bestScore = 0;

    for (const key of this.toolManifestKeys) {
      const slug = key.substring('econ/tools/'.length);
      const keyTokens = this.expandToolTokens(new Set(slug.split('_').filter(Boolean)));
      let score = 0;
      for (const t of nameTokens) {
        if (keyTokens.has(t)) score++;
      }

      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }

    if (bestKey && bestScore > 0) {
      return this.imageManifest.get(bestKey);
    }
    return undefined;
  }

  /**
   * Best-effort fallback parser for skinledger items_game + localization files.
   * Only fills unresolved defindexes.
   */
  private async enrichFromSkinledgerFallback(): Promise<void> {
    const ITEMS_GAME_URL = 'https://files.skinledger.com/counterstrike/items_game.txt';
    const CSGO_ENGLISH_URL = 'https://files.skinledger.com/counterstrike/csgo_english.txt';

    try {
      const [itemsGameRes, englishRes] = await Promise.allSettled([
        this.fetchText(ITEMS_GAME_URL),
        this.fetchText(CSGO_ENGLISH_URL),
      ]);

      if (itemsGameRes.status !== 'fulfilled') return;

      const localization = englishRes.status === 'fulfilled'
        ? this.parseVdfLocalization(englishRes.value)
        : new Map<string, string>();

      const fallbackMap = this.parseItemsGameDefindexes(itemsGameRes.value, localization);
      let inserted = 0;

      for (const [defindex, resolvedName] of fallbackMap.entries()) {
        if (this.itemMap.has(defindex)) continue;
        this.itemMap.set(defindex, {
          name: resolvedName,
          weaponType: WEAPON_DEFS[defindex]?.type,
        });
        inserted++;
      }

      if (inserted > 0) {
        console.log(`[ItemDataService] Skinledger fallback filled ${inserted} unresolved defindexes`);
      }
    } catch (err: any) {
      console.warn('[ItemDataService] Skinledger fallback failed:', err.message);
    }
  }

  // ---- Helpers ----

  /**
   * Load the bundled inventory.json from cs2-inventory-resolver package.
   * This provides comprehensive name/image data for all CS2 item types.
   */
  private loadPackageData(): void {
    try {
      try {
        const req = createRequire(__filename);
        const direct = req('cs2-inventory-resolver/data/inventory.json') as PackageInventoryData;
        if (direct && direct.skins) {
          this.packageData = direct;
          console.log('[ItemDataService] Loaded bundled inventory.json via direct package import');
          return;
        }
      } catch {
        // Continue with file path probing.
      }

      // Resolve the package's root directory via its main entry point,
      // then navigate to data/inventory.json
      const possiblePaths: string[] = [];

      try {
        const req = createRequire(__filename);
        // require.resolve gives us dist/index.js — go up to package root
        const mainEntry = req.resolve('cs2-inventory-resolver');
        const pkgRoot = path.resolve(path.dirname(mainEntry), '..');
        possiblePaths.push(path.join(pkgRoot, 'data', 'inventory.json'));
      } catch {
        // createRequire might fail in some bundled environments
      }

      // Fallback paths for different environments
      possiblePaths.push(
        path.join(__dirname, '..', '..', '..', 'node_modules', 'cs2-inventory-resolver', 'data', 'inventory.json'),
        path.join(__dirname, '..', 'node_modules', 'cs2-inventory-resolver', 'data', 'inventory.json'),
        path.join(__dirname, '..', '..', 'node_modules', 'cs2-inventory-resolver', 'data', 'inventory.json'),
      );

      for (const p of possiblePaths) {
        try {
          if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf-8');
            this.packageData = JSON.parse(raw) as PackageInventoryData;
            console.log('[ItemDataService] Loaded bundled inventory.json from cs2-inventory-resolver');
            return;
          }
        } catch { /* try next path */ }
      }

      console.warn('[ItemDataService] Could not find cs2-inventory-resolver inventory.json');
    } catch (err: any) {
      console.warn('[ItemDataService] Failed to load bundled inventory data:', err.message);
    }
  }

  /**
   * Populate stickerMap from the bundled inventory.json stickers section.
   * The keys are sticker_ids (matching in-game sticker_id values).
   */
  private populateStickersFromPackage(): void {
    if (!this.packageData?.stickers) return;

    let count = 0;
    for (const [idStr, entry] of Object.entries(this.packageData.stickers)) {
      const stickerId = parseInt(idStr, 10);
      if (!stickerId || stickerId <= 0) continue;

      if (!this.stickerMap.has(stickerId)) {
        // Strip "Sticker | " prefix for cleaner display
        let name = entry.name;
        if (name.startsWith('Sticker | ')) name = name.substring('Sticker | '.length);
        this.stickerMap.set(stickerId, { name, image: entry.image });
        count++;
      }
    }
    console.log(`[ItemDataService] Populated ${count} stickers from bundled data (total: ${this.stickerMap.size})`);
  }

  /**
   * Populate charmMap from bundled inventory keychains table.
   */
  private populateCharmsFromPackage(): void {
    if (!this.packageData?.keychains) return;

    let count = 0;
    for (const [idStr, entry] of Object.entries(this.packageData.keychains)) {
      const charmId = parseInt(idStr, 10);
      if (!charmId || charmId <= 0) continue;

      if (!this.charmMap.has(charmId)) {
        this.charmMap.set(charmId, {
          name: entry.name,
          image: entry.image,
        });
        count++;
      }
    }

    if (count > 0) {
      console.log(`[ItemDataService] Populated ${count} charms from bundled data (total: ${this.charmMap.size})`);
    }
  }

  /**
   * Load the ByMykel image manifest keyed by image path (econ/...)
   */
  private async loadImageManifest(): Promise<void> {
    if (this.imageManifestLoaded) return;
    this.imageManifestLoaded = true;

    try {
      const manifest = await this.fetchJSON(IMAGE_MANIFEST_URL);
      if (!manifest || typeof manifest !== 'object') return;

      let count = 0;
      for (const [key, url] of Object.entries(manifest)) {
        if (typeof key !== 'string' || typeof url !== 'string') continue;
        this.imageManifest.set(key, url);
        if (key.startsWith('econ/tools/')) {
          this.toolManifestKeys.push(key);
        }
        count++;
      }

      if (count > 0) {
        console.log(`[ItemDataService] Loaded ${count} image manifest entries`);
      }
    } catch (err: any) {
      console.warn('[ItemDataService] Failed to load image manifest:', err.message);
    }
  }

  /**
     * Resolve static image from manifest.
     *
     * Characteristics:
     * - @param className - The parameter for className
     * - @param type - The parameter for type
     * - @returns string
     *
     */
    private resolveStaticImageFromManifest(className?: string, type?: string): string | undefined {
    if (!className) return undefined;

    const candidates: string[] = [];

    if (className.startsWith('weapon_')) {
      candidates.push(`econ/weapons/base_weapons/${className}`);
    }

    candidates.push(`econ/tools/${className}`);

    // Alias mismatches between local class names and manifest paths.
    const toolAliases: Record<string, string[]> = {
      stattrak_swap: ['econ/tools/stattrak_swap_tool'],
      keychain_remove_tool: ['econ/tools/keychain_remove_tool'],
      casket: ['econ/tools/casket'],
      key: ['econ/tools/coupon_key'],
    };
    const aliasPaths = toolAliases[className];
    if (aliasPaths) candidates.push(...aliasPaths);

    if (type === 'Tool') {
      // Last-resort defaults for known tool classes.
      if (className === 'stattrak_swap') candidates.push('econ/tools/stattrak_swap_tool');
      if (className === 'casket') candidates.push('econ/tools/casket');
    }

    for (const key of candidates) {
      const resolved = this.imageManifest.get(key);
      if (resolved) return resolved;
    }

    return undefined;
  }

  /**
   * Populate itemMap with static weapon defs for items we don't get from the API
   * (vanilla weapons used as inventory items)
   */
  private async populateStaticWeapons(): Promise<void> {
    await this.loadImageManifest();

    for (const [defStr, def] of Object.entries(WEAPON_DEFS)) {
      const defindex = Number(defStr);
      const image = this.resolveStaticImageFromManifest(def.className, def.type);

      const existing = this.itemMap.get(defindex);
      if (!existing) {
        this.itemMap.set(defindex, { name: def.name, weaponType: def.type, image });
      } else if (!existing.image && image) {
        existing.image = image;
      }
    }
  }

  /**
   * Extract numeric ID from API id strings like "crate-4904", "agent-4613", "sticker-75"
   */
  private extractDefindexFromId(id: any): number | undefined {
    if (!id) return undefined;
    const str = String(id);
    const match = str.match(/-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      return num > 0 ? num : undefined;
    }
    return undefined;
  }

  /**
     * Extract defindex from any.
     *
     * Characteristics:
     * - @param entry - The parameter for entry
     * - @returns number
     *
     */
    private extractDefindexFromAny(entry: any): number | undefined {
    const candidate = entry?.def_index ?? entry?.defindex;
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;

    const idStr = String(entry?.id ?? '');
    if (/^(crate|agent|collectible|key|tool)-\d+$/i.test(idStr)) {
      return this.extractDefindexFromId(idStr);
    }
    return undefined;
  }

  /**
     * Extract readable name.
     *
     * Characteristics:
     * - @param entry - The parameter for entry
     * - @returns string
     *
     */
    private extractReadableName(entry: any): string | undefined {
    const candidate =
      entry?.name ||
      entry?.market_hash_name ||
      entry?.item_name ||
      entry?.weapon?.name;

    if (typeof candidate !== 'string' || candidate.trim().length === 0) return undefined;
    return candidate.trim();
  }

  /**
     * Parse vdf localization.
     *
     * Characteristics:
     * - @param raw - The parameter for raw
     * - @returns Map<string, string>
     *
     */
    private parseVdfLocalization(raw: string): Map<string, string> {
    const map = new Map<string, string>();
    const pairRegex = /"([^"\\]+)"\s+"([^"\\]*)"/g;
    let match: RegExpExecArray | null;
    while ((match = pairRegex.exec(raw)) !== null) {
      const key = match[1].trim().toLowerCase();
      const value = match[2].trim();
      if (!key || !value) continue;
      map.set(key, value);
    }
    return map;
  }

  /**
     * Parse items game defindexes.
     *
     * Characteristics:
     * - @param raw - The parameter for raw
     * - @param localization - The parameter for localization
     * - @returns Map<number, string>
     *
     */
    private parseItemsGameDefindexes(raw: string, localization: Map<string, string>): Map<number, string> {
    const map = new Map<number, string>();
    const itemBlockRegex = /"(\d+)"\s*\{([\s\S]*?)\n\s*\}/g;
    let match: RegExpExecArray | null;

    while ((match = itemBlockRegex.exec(raw)) !== null) {
      const defindex = Number(match[1]);
      if (!Number.isFinite(defindex) || defindex <= 0) continue;

      const block = match[2];
      const itemNameMatch = block.match(/"item_name"\s+"([^"]+)"/i);
      const nameMatch = block.match(/"name"\s+"([^"]+)"/i);
      const itemClassMatch = block.match(/"item_class"\s+"([^"]+)"/i);

      if (!itemNameMatch && !nameMatch && !itemClassMatch) continue;

      const token = (itemNameMatch?.[1] || nameMatch?.[1] || '').trim();
      let resolvedName = token;

      if (token.startsWith('#')) {
        const key = token.slice(1).trim().toLowerCase();
        resolvedName = localization.get(key) || token;
      }

      if (!resolvedName || resolvedName.startsWith('#')) {
        const className = itemClassMatch?.[1] || '';
        resolvedName = className
          ? className.replace(/^weapon_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
          : '';
      }

      if (!resolvedName) continue;

      map.set(defindex, resolvedName);
    }

    return map;
  }

  /**
     * Fetches j s o n.
     *
     * Characteristics:
     * - @param url - The parameter for url
     * - @returns Promise<any>
     *
     */
    private async fetchJSON(url: string): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'CSInventoryPorter/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
     * Fetches text.
     *
     * Characteristics:
     * - @param url - The parameter for url
     * - @returns Promise<string>
     *
     */
    private async fetchText(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'text/plain,*/*',
          'User-Agent': 'CSInventoryPorter/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Optional offline fallback using locally installed Skinledger backup datasets.
   * This is additive-only and never overwrites already-resolved entries.
   */
  private enrichFromLocalBackupFallback(): void {
    const readJson = (filePath: string): any | null => {
      try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch {
        return null;
      }
    };

    const baseCandidates = [
      path.join(process.resourcesPath || '', 'assets', 'backup'),
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'skinledger-desktop-app', 'resources', 'assets', 'backup'),
    ].filter((p) => p && p.length > 0);

    for (const baseDir of baseCandidates) {
      if (!fs.existsSync(baseDir)) continue;

      const charmsRaw = readJson(path.join(baseDir, 'charms.json'));
      if (charmsRaw && typeof charmsRaw === 'object') {
        for (const value of Object.values(charmsRaw as Record<string, any>)) {
          const idMatch = String((value as any)?.id || '').match(/-(\d+)$/);
          const charmId = idMatch ? Number(idMatch[1]) : 0;
          if (!charmId || this.charmMap.has(charmId)) continue;
          const name = String((value as any)?.name || '').trim();
          if (!name) continue;
          this.charmMap.set(charmId, { name, image: (value as any)?.image });
        }
      }

      const stickersRaw = readJson(path.join(baseDir, 'stickers.json'));
      if (stickersRaw && typeof stickersRaw === 'object') {
        for (const value of Object.values(stickersRaw as Record<string, any>)) {
          const idMatch = String((value as any)?.id || '').match(/-(\d+)$/);
          const stickerId = idMatch ? Number(idMatch[1]) : 0;
          if (!stickerId || this.stickerMap.has(stickerId)) continue;
          const name = String((value as any)?.name || '').trim();
          if (!name) continue;
          this.stickerMap.set(stickerId, { name: name.replace(/^Sticker\s*\|\s*/i, ''), image: (value as any)?.image });
        }
      }

      const agentsRaw = readJson(path.join(baseDir, 'agents.json'));
      if (agentsRaw && typeof agentsRaw === 'object') {
        for (const value of Object.values(agentsRaw as Record<string, any>)) {
          const idMatch = String((value as any)?.id || '').match(/-(\d+)$/);
          const defindex = idMatch ? Number(idMatch[1]) : 0;
          if (!defindex || this.itemMap.has(defindex)) continue;
          const name = String((value as any)?.name || '').trim();
          if (!name) continue;
          this.itemMap.set(defindex, {
            name,
            image: (value as any)?.image,
            weaponType: 'Agent',
            rarityColor: (value as any)?.rarity?.color,
          });
        }
      }

      console.log('[ItemDataService] Local backup fallback loaded from:', baseDir);
      break;
    }
  }
}
