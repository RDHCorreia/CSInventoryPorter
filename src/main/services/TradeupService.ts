// ============================================================
// CSInventoryPorter — TradeupService
// Handles CS2 Trade-Up Contracts via the Game Coordinator
// Phase 8
// ============================================================

import { EventEmitter } from 'events';
import { SteamService } from './SteamService';
import type {
  InventoryItem,
  TradeupPrediction,
  TradeupPredictionOutcome,
  TradeupProgress,
  TradeupResult,
} from '../../shared/types';
import type { ItemDataService } from './ItemDataService';

/**
 * CS2 Trade-Up Contract rules:
 * - Requires exactly 10 items of the same rarity
 * - All items must be the same quality (StatTrak or Normal — no mixing)
 * - Result is 1 item of the next higher rarity
 * - Items with rarity 1 (Consumer) and 2 (Industrial) can trade up
 *   to get next-tier items, up to Covert (6). Covert cannot be traded up.
 * - The GC craft() method with recipe=0 handles Trade-Up Contracts
 */

const TRADEUP_RECIPE_ID = 0;
const TRADEUP_ITEM_COUNT = 10;

export class TradeupService extends EventEmitter {
  private steamService: SteamService;
  private _pendingCraft: {
    resolve: (result: TradeupResult) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  } | null = null;
  private _craftListenerAttached = false;

  constructor(steamService: SteamService) {
    super();
    this.steamService = steamService;
  }

  // ---- Attach craft response listener ----

  /**
     * Ensure craft listener.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private ensureCraftListener(): void {
    if (this._craftListenerAttached) return;
    const csgo = this.steamService.csgoClient;

    csgo.on('craftingComplete', (recipeId: number, itemIds: string[]) => {
      console.log(`[TradeupService] craftingComplete: recipe=${recipeId}, items=[${itemIds.join(', ')}]`);

      if (this._pendingCraft) {
        clearTimeout(this._pendingCraft.timeout);
        const pending = this._pendingCraft;
        this._pendingCraft = null;

        if (itemIds && itemIds.length > 0) {
          this.emitProgress('completed', `Trade-up complete! Received ${itemIds.length} item(s).`);
          pending.resolve({ success: true, receivedItemIds: itemIds });
        } else {
          this.emitProgress('error', 'Trade-up returned no items');
          pending.resolve({ success: false, error: 'Trade-up returned no items' });
        }
      }
    });

    this._craftListenerAttached = true;
  }

  // ---- Trade-Up Contract execution ----

  /**
   * Execute a Trade-Up Contract.
   * @param itemIds Array of exactly 10 item IDs to trade up
   * @returns Result with the received item IDs
   */
  async executeTradeup(itemIds: string[]): Promise<TradeupResult> {
    if (itemIds.length !== TRADEUP_ITEM_COUNT) {
      return { success: false, error: `Trade-Up requires exactly ${TRADEUP_ITEM_COUNT} items, got ${itemIds.length}` };
    }

    if (!this.steamService.isGCConnected) {
      return { success: false, error: 'Not connected to Game Coordinator' };
    }

    if (this._pendingCraft) {
      return { success: false, error: 'A trade-up is already in progress' };
    }

    this.ensureCraftListener();

    const csgo = this.steamService.csgoClient;

    this.emitProgress('crafting', 'Sending trade-up request to Game Coordinator...');

    return new Promise<TradeupResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingCraft = null;
        this.emitProgress('error', 'Trade-up timed out after 30 seconds');
        resolve({ success: false, error: 'Trade-up timed out waiting for GC response' });
      }, 30000);

      this._pendingCraft = { resolve, reject, timeout };

      // Send craft request to GC
      // The craft() method expects item IDs as numbers (uint64)
      // and recipe ID (0 = Trade-Up Contract)
      try {
        (csgo as any).craft(itemIds.map(id => id), TRADEUP_RECIPE_ID);
        console.log(`[TradeupService] Sent craft request with ${itemIds.length} items, recipe=${TRADEUP_RECIPE_ID}`);
      } catch (err: any) {
        clearTimeout(timeout);
        this._pendingCraft = null;
        this.emitProgress('error', `Failed to send craft request: ${err.message}`);
        resolve({ success: false, error: err.message });
      }
    });
  }

  /**
   * Predict trade-up outcomes using collection tickets and normalized float math.
   * Returns null when the selected set is not a valid 10-item contract.
   */
  predictTradeup(items: InventoryItem[], itemDataService: ItemDataService): TradeupPrediction | null {
    return TradeupService.predictTradeup(items, itemDataService);
  }

  /**
     * Predict tradeup.
     *
     * Characteristics:
     * - @param items - The parameter for items
     * - @param itemDataService - The parameter for itemDataService
     * - @returns import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").TradeupPrediction
     *
     */
    static predictTradeup(items: InventoryItem[], itemDataService: ItemDataService): TradeupPrediction | null {
    if (items.length !== TRADEUP_ITEM_COUNT) return null;

    const validationError = TradeupService.validateTradeupItems(items);
    if (validationError) return null;

    const inputRarity = items[0].rarity ?? 0;
    const outputRarity = inputRarity + 1;
    const isStatTrak = (items[0].quality ?? 0) === 9;

    const collectionTickets = new Map<string, { count: number; name?: string }>();
    let unknownCollectionInputs = 0;
    let unknownFloatInputs = 0;
    let inputFloatSum = 0;
    let normalizedSum = 0;

    for (const item of items) {
      const collectionId = item.collection_id;
      if (!collectionId) {
        unknownCollectionInputs++;
      } else {
        const prev = collectionTickets.get(collectionId);
        if (prev) {
          prev.count += 1;
          if (!prev.name && item.collection_name) prev.name = item.collection_name;
        } else {
          collectionTickets.set(collectionId, { count: 1, name: item.collection_name });
        }
      }

      const itemFloat = typeof item.paint_wear === 'number' ? item.paint_wear : 0;
      if (typeof item.paint_wear !== 'number') unknownFloatInputs++;

      const minFloat = typeof item.min_float === 'number' ? item.min_float : 0;
      const maxFloat = typeof item.max_float === 'number' ? item.max_float : 1;
      if (typeof item.min_float !== 'number' || typeof item.max_float !== 'number') unknownFloatInputs++;

      inputFloatSum += itemFloat;
      normalizedSum += TradeupService.normalizeWear(itemFloat, minFloat, maxFloat);
    }

    const averageInputFloat = inputFloatSum / TRADEUP_ITEM_COUNT;
    const averageNormalizedFloat = normalizedSum / TRADEUP_ITEM_COUNT;

    const skins = itemDataService.getTradeupSkins();
    const outcomeAccumulator = new Map<string, TradeupPredictionOutcome>();
    let unresolvedChance = 0;

    for (const [collectionId, ticketInfo] of collectionTickets.entries()) {
      const collectionChance = ticketInfo.count / TRADEUP_ITEM_COUNT;
      const collectionOutcomes = skins
        .filter((s) =>
          s.collectionId === collectionId
          && s.rarity === outputRarity
          && s.stattrak === isStatTrak
          && !s.souvenir,
        )
        .filter((s, idx, arr) => arr.findIndex((x) => x.defindex === s.defindex && x.paintIndex === s.paintIndex) === idx);

      if (collectionOutcomes.length === 0) {
        unresolvedChance += collectionChance;
        continue;
      }

      const perSkinChance = collectionChance / collectionOutcomes.length;

      for (const skin of collectionOutcomes) {
        const predictedFloat = skin.minFloat + averageNormalizedFloat * (skin.maxFloat - skin.minFloat);
        const key = `${skin.defindex}:${skin.paintIndex}`;

        const existing = outcomeAccumulator.get(key);
        if (existing) {
          existing.chance += perSkinChance;
          continue;
        }

        outcomeAccumulator.set(key, {
          defindex: skin.defindex,
          paintIndex: skin.paintIndex,
          name: skin.name,
          imageUrl: skin.image,
          collectionId,
          collectionName: skin.collectionName || ticketInfo.name,
          chance: perSkinChance,
          minFloat: skin.minFloat,
          maxFloat: skin.maxFloat,
          predictedFloat,
        });
      }
    }

    if (unknownCollectionInputs > 0) {
      unresolvedChance += unknownCollectionInputs / TRADEUP_ITEM_COUNT;
    }

    if (unresolvedChance > 0) {
      outcomeAccumulator.set('unknown:missing', {
        defindex: 0,
        paintIndex: 0,
        name: 'Unknown Outcome (Missing Data)',
        collectionId: 'unknown',
        collectionName: 'Unknown Collection',
        chance: unresolvedChance,
        minFloat: 0,
        maxFloat: 1,
        predictedFloat: averageInputFloat,
      });
    }

    const outcomes = [...outcomeAccumulator.values()];
    const totalChance = outcomes.reduce((sum, o) => sum + o.chance, 0);
    if (totalChance > 0) {
      for (const outcome of outcomes) {
        outcome.chance /= totalChance;
      }
    }

    outcomes.sort((a, b) => {
      if (a.defindex === 0 && b.defindex !== 0) return 1;
      if (b.defindex === 0 && a.defindex !== 0) return -1;
      if (b.chance !== a.chance) return b.chance - a.chance;
      return a.name.localeCompare(b.name);
    });

    return {
      outputRarity,
      averageInputFloat,
      averageNormalizedFloat,
      outcomes,
      unknownCollectionInputs,
      unknownFloatInputs,
    };
  }

  // ---- Validation helpers ----

  /**
   * Validate that a set of items can be used in a trade-up.
   * Returns null if valid, or an error message if invalid.
   */
  static validateTradeupItems(items: Array<{ rarity?: number; quality?: number; weapon_type?: string }>): string | null {
    if (items.length !== TRADEUP_ITEM_COUNT) {
      return `Need exactly ${TRADEUP_ITEM_COUNT} items, have ${items.length}`;
    }

    // All items must have a rarity
    const rarities = items.map(i => i.rarity).filter(r => r !== undefined) as number[];
    if (rarities.length !== TRADEUP_ITEM_COUNT) {
      return 'Some items have unknown rarity';
    }

    // All items must be the same rarity
    const uniqueRarities = new Set(rarities);
    if (uniqueRarities.size > 1) {
      return 'All items must be the same rarity';
    }

    const rarity = rarities[0];

    // Cannot trade up Covert (6) or Contraband (7) items
    if (rarity >= 6) {
      return 'Cannot trade up Covert or Contraband items';
    }

    // Cannot trade up Stock (0) items
    if (rarity <= 0) {
      return 'Cannot trade up base/stock items';
    }

    // All items must be the same quality type (StatTrak vs Normal)
    // StatTrak = quality 9, Souvenir = quality 12
    const qualities = items.map(i => i.quality ?? 0);
    const hasStatTrak = qualities.some(q => q === 9);
    const hasNormal = qualities.some(q => q !== 9 && q !== 12);
    const hasSouvenir = qualities.some(q => q === 12);

    if (hasStatTrak && hasNormal) {
      return 'Cannot mix StatTrak™ and Normal items';
    }
    if (hasStatTrak && hasSouvenir) {
      return 'Cannot mix StatTrak™ and Souvenir items';
    }
    if (hasSouvenir && hasNormal) {
      return 'Cannot mix Souvenir and Normal items';
    }

    // Items should be weapon skins (not tools, agents, etc.)
    for (const item of items) {
      const wt = item.weapon_type;
      if (wt === 'Tool' || wt === 'Collectible' || wt === 'Music Kit' ||
          wt === 'Graffiti' || wt === 'Sticker' || wt === 'Container' ||
          wt === 'Pass' || wt === 'Charm' || wt === 'Patch' || wt === 'Equipment') {
        return `${wt} items cannot be used in trade-ups`;
      }
    }

    return null; // Valid
  }

  /**
     * Normalize wear.
     *
     * Characteristics:
     * - @param value - The parameter for value
     * - @param minFloat - The parameter for minFloat
     * - @param maxFloat - The parameter for maxFloat
     * - @returns number
     *
     */
    private static normalizeWear(value: number, minFloat: number, maxFloat: number): number {
    const range = maxFloat - minFloat;
    const safeRange = range > 0.000001 ? range : 0.000001;
    const normalized = (value - minFloat) / safeRange;
    return Math.max(0, Math.min(1, normalized));
  }

  // ---- Progress helpers ----

  /**
     * Emit progress.
     *
     * Characteristics:
     * - @param state - The parameter for state
     * - @param message - The parameter for message
     * - @returns Nothing (void)
     *
     */
    private emitProgress(state: TradeupProgress['state'], message?: string): void {
    const progress: TradeupProgress = { state, message };
    this.emit('tradeup-progress', progress);
  }

  // ---- Cleanup ----

  /**
     * Destroy.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    destroy(): void {
    if (this._pendingCraft) {
      clearTimeout(this._pendingCraft.timeout);
      this._pendingCraft = null;
    }
    this.removeAllListeners();
  }
}
