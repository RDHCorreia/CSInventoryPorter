
import { EventEmitter } from 'events';
import type { SteamService } from './SteamService';
import type { ArmoryData, ArmoryRedeemResult } from '../../shared/types';
import { ARMORY_ITEMS } from '../../shared/armory-items';

const APP_ID = 730;
const MSG_GC_CLIENT_WELCOME = 4004;
const MSG_GC_REDEEM = 9209;
const MSG_ESO_CREATE = 21;
const PURCHASE_TIMEOUT_MS = 30_000;

// ---- Protobuf helpers (ported from cs2-stars) ----

/**
 * Read varint.
 *
 * Characteristics:
 * - @param buf - The parameter for buf
 * - @param offset - The parameter for offset
 * - @returns { value: number; bytesRead: number; }
 *
 */
function readVarint(buf: Buffer, offset: number): { value: number; bytesRead: number } | null {
  let result = 0;
  let shift = 0;
  let bytesRead = 0;
  while (true) {
    if (offset + bytesRead >= buf.length) return null;
    const b = buf[offset + bytesRead];
    result |= (b & 0x7f) << shift;
    shift += 7;
    bytesRead++;
    if ((b & 0x80) === 0) break;
  }
  return { value: result, bytesRead };
}

/**
 * Skip by wire type.
 *
 * Characteristics:
 * - @param buf - The parameter for buf
 * - @param offset - The parameter for offset
 * - @param wireType - The parameter for wireType
 * - @returns number
 *
 */
function skipByWireType(buf: Buffer, offset: number, wireType: number): number | null {
  if (wireType === 0) {
    const v = readVarint(buf, offset);
    return v ? offset + v.bytesRead : null;
  }
  if (wireType === 2) {
    const len = readVarint(buf, offset);
    if (!len) return null;
    return offset + len.bytesRead + len.value;
  }
  if (wireType === 5) return offset + 4;
  if (wireType === 1) return offset + 8;
  return null;
}

/**
 * Encode varint.
 *
 * Characteristics:
 * - @param n - The parameter for n
 * - @returns Buffer<ArrayBufferLike>
 *
 */
function encodeVarint(n: number): Buffer {
  const out: number[] = [];
  let x = n >>> 0;
  while (x >= 0x80) {
    out.push((x & 0x7f) | 0x80);
    x >>>= 7;
  }
  out.push(x);
  return Buffer.from(out);
}

// ---- Star extraction (recursive search, ported from cs2-stars/SteamClient.js) ----

/**
 * Parse type6 object data for stars.
 *
 * Characteristics:
 * - @param data - The parameter for data
 * - @returns number
 *
 */
function parseType6ObjectDataForStars(data: Buffer): number | null {
  let offset = 0;
  while (offset < data.length) {
    const tagData = readVarint(data, offset);
    if (!tagData) break;
    offset += tagData.bytesRead;
    const fieldNumber = tagData.value >> 3;
    const wireType = tagData.value & 0x07;
    if (wireType === 0) {
      const v = readVarint(data, offset);
      if (!v) break;
      offset += v.bytesRead;
      if (fieldNumber === 2) {
        const n = v.value;
        if (Number.isFinite(n) && n >= 0 && n <= 100_000) return n;
      }
    } else {
      const next = skipByWireType(data, offset, wireType);
      if (next == null) break;
      offset = next;
    }
  }
  return null;
}

/**
 * Find stars in cache.
 *
 * Characteristics:
 * - @param buf - The parameter for buf
 * - @returns number
 *
 */
function findStarsInCache(buf: Buffer): number | null {
  let offset = 0;
  let foundTypeId: number | null = null;
  let objectData: Buffer | null = null;

  while (offset < buf.length) {
    const tagData = readVarint(buf, offset);
    if (!tagData) break;
    offset += tagData.bytesRead;
    const fieldNumber = tagData.value >> 3;
    const wireType = tagData.value & 0x07;

    if (wireType === 0) {
      const v = readVarint(buf, offset);
      if (!v) break;
      offset += v.bytesRead;
      if (fieldNumber === 1) foundTypeId = v.value;
    } else if (wireType === 2) {
      const len = readVarint(buf, offset);
      if (!len) break;
      offset += len.bytesRead;
      const fieldData = buf.subarray(offset, offset + len.value);
      offset += len.value;
      if (fieldNumber === 2 || fieldNumber === 3) objectData = fieldData;
      const inner = findStarsInCache(fieldData);
      if (inner !== null) return inner;
    } else {
      const next = skipByWireType(buf, offset, wireType);
      if (next == null) break;
      offset = next;
    }
  }

  if (foundTypeId === 6 && objectData) {
    const stars = parseType6ObjectDataForStars(objectData);
    if (stars !== null) return stars;
  }
  return null;
}

/**
 * Parse stars from welcome.
 *
 * Characteristics:
 * - @param payload - The parameter for payload
 * - @returns number
 *
 */
function parseStarsFromWelcome(payload: Buffer): number | null {
  let offset = 0;
  while (offset < payload.length) {
    const tagData = readVarint(payload, offset);
    if (!tagData) break;
    offset += tagData.bytesRead;
    const wireType = tagData.value & 0x07;
    if (wireType === 2) {
      const len = readVarint(payload, offset);
      if (!len) break;
      offset += len.bytesRead;
      const fieldData = payload.subarray(offset, offset + len.value);
      offset += len.value;
      const stars = findStarsInCache(fieldData);
      if (stars !== null) return stars;
    } else {
      const next = skipByWireType(payload, offset, wireType);
      if (next == null) break;
      offset = next;
    }
  }
  return null;
}

// ---- Encode redeem body (ported from cs2-stars/ArmoryManager.js) ----

/**
 * Encode redeem body.
 *
 * Characteristics:
 * - @param armoryId - The parameter for armoryId
 * - @param currentStars - The parameter for currentStars
 * - @param itemPrice - The parameter for itemPrice
 * - @returns Buffer<ArrayBufferLike>
 *
 */
function encodeRedeemBody(armoryId: number, currentStars: number, itemPrice: number): Buffer {
  const values = [11, armoryId, currentStars, itemPrice];
  const chunks: Buffer[] = [];
  for (let i = 0; i < values.length; i++) {
    const tag = ((i + 1) << 3) | 0; // field (i+1), wire type 0
    chunks.push(encodeVarint(tag));
    chunks.push(encodeVarint(values[i]));
  }
  return Buffer.concat(chunks);
}

// ---- Parse MSG_ESO_CREATE response to confirm success ----

/**
 * Parse c s o econ item.
 *
 * Characteristics:
 * - @param buf - The parameter for buf
 * - @returns { defIndex: number; }
 *
 */
function parseCSOEconItem(buf: Buffer): { defIndex: number } | null {
  let offset = 0;
  let defIndex: number | null = null;
  while (offset < buf.length) {
    const tagData = readVarint(buf, offset);
    if (!tagData) break;
    offset += tagData.bytesRead;
    const fieldNumber = tagData.value >> 3;
    const wireType = tagData.value & 0x07;
    if (wireType === 0) {
      const v = readVarint(buf, offset);
      if (!v) break;
      offset += v.bytesRead;
      if (fieldNumber === 4) defIndex = v.value;
    } else {
      const next = skipByWireType(buf, offset, wireType);
      if (next == null) break;
      offset = next;
    }
  }
  return defIndex ? { defIndex } : null;
}

/**
 * Find c s o econ item deep.
 *
 * Characteristics:
 * - @param buf - The parameter for buf
 * - @returns { defIndex: number; }
 *
 */
function findCSOEconItemDeep(buf: Buffer): { defIndex: number } | null {
  const direct = parseCSOEconItem(buf);
  if (direct) return direct;
  let offset = 0;
  while (offset < buf.length) {
    const tagData = readVarint(buf, offset);
    if (!tagData) break;
    offset += tagData.bytesRead;
    const wireType = tagData.value & 0x07;
    if (wireType === 2) {
      const len = readVarint(buf, offset);
      if (!len) break;
      offset += len.bytesRead;
      const sub = buf.subarray(offset, offset + len.value);
      offset += len.value;
      if (sub.length > 0) {
        const found = findCSOEconItemDeep(sub);
        if (found) return found;
      }
    } else {
      const next = skipByWireType(buf, offset, wireType);
      if (next == null) break;
      offset = next;
    }
  }
  return null;
}

// ---- ArmoryService ----

export class ArmoryService extends EventEmitter {
  private steamService: SteamService;
  private stars = 0;

  constructor(steamService: SteamService) {
    super();
    this.steamService = steamService;
    this.attachGCListener();
  }

  /**
     * Reset.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    reset(): void {
    this.stars = 0;
  }

  /**
     * Gets armory data.
     *
     * Characteristics:
     * - @returns import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").ArmoryData
     *
     */
    getArmoryData(): ArmoryData {
    return {
      stars: this.stars,
      generationTime: Date.now(),
      items: ARMORY_ITEMS.map((def) => ({
        itemId: String(def.armoryId),
        name: def.name,
        cost: def.price,
        imageUrl: def.imageUrl,
        category: def.category,
      })),
    };
  }

  /**
     * Redeem item.
     *
     * Characteristics:
     * - @param armoryId - The parameter for armoryId
     * - @param count - The parameter for count
     * - @returns Promise<import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").ArmoryRedeemResult>
     *
     */
    async redeemItem(armoryId: number, count: number = 1): Promise<ArmoryRedeemResult> {
    const def = ARMORY_ITEMS.find((i) => i.armoryId === armoryId);
    if (!def) {
      return { success: false, error: 'Item not found in the catalog.' };
    }
    
    const maxAffordable = Math.max(1, Math.floor(this.stars / def.price));
    const targetCount = Math.min(count, maxAffordable);

    if (this.stars < def.price) {
      return { success: false, error: `Not enough stars. Need ${def.price}, have ${this.stars}.` };
    }

    if (targetCount > 1) {
      this.emit('armory-progress', { state: 'redeeming', message: `Redeeming ${def.name} (1 of ${targetCount})…`, currentStars: this.stars });
    } else {
      this.emit('armory-progress', { state: 'redeeming', message: `Redeeming ${def.name}…`, currentStars: this.stars });
    }

    try {
      for (let i = 1; i <= targetCount; i++) {
        if (this.stars < def.price) {
          throw new Error('Not enough stars to continue.');
        }

        const result = await this.sendRedeemRequest(armoryId, this.stars, def.price);
        if (result.success) {
          this.stars -= def.price;
          
          if (i < targetCount) {
            this.emit('armory-progress', {
              state: 'redeeming',
              message: `Waiting 5 seconds... (${i} of ${targetCount} complete)`,
              currentStars: this.stars
            });
            await new Promise((resolve) => setTimeout(resolve, 5000));
            this.emit('armory-progress', {
              state: 'redeeming',
              message: `Redeeming ${def.name} (${i + 1} of ${targetCount})…`,
              currentStars: this.stars
            });
          } else {
            this.emit('armory-progress', {
              state: 'completed',
              message: `${targetCount > 1 ? `Redeemed ${targetCount}x ` : ''}${def.name} redeemed! Stars remaining: ${this.stars}`,
              currentStars: this.stars
            });
          }
        } else {
          throw new Error(result.error ?? 'Purchase failed');
        }
      }
      return { success: true };
    } catch (err: any) {
      const msg = err.message ?? 'Unknown error';
      this.emit('armory-progress', { state: 'error', message: msg });
      return { success: false, error: msg };
    }
  }

  /**
     * Attach g c listener.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private attachGCListener(): void {
    try {
      const steamClient = this.steamService.steamClient;
      steamClient.on('receivedFromGC', (appid: number, msgType: number, payload: Buffer) => {
        if (appid !== APP_ID) return;
        if (msgType === MSG_GC_CLIENT_WELCOME) {
          this.handleWelcome(payload);
        }
      });
    } catch (err: any) {
      console.warn('[ArmoryService] Could not attach GC listener:', err.message);
    }
  }

  /**
     * Handles welcome.
     *
     * Characteristics:
     * - @param payload - The parameter for payload
     * - @returns Nothing (void)
     *
     */
    private handleWelcome(payload: Buffer): void {
    try {
      const stars = parseStarsFromWelcome(payload);
      if (stars !== null) {
        this.stars = stars;
        console.log(`[ArmoryService] Stars balance: ${stars}`);
      } else {
        console.log('[ArmoryService] Stars not found in welcome payload');
      }
    } catch (err: any) {
      console.warn('[ArmoryService] Failed to parse welcome:', err.message);
    }
  }

  /**
     * Send redeem request.
     *
     * Characteristics:
     * - @param armoryId - The parameter for armoryId
     * - @param currentStars - The parameter for currentStars
     * - @param itemPrice - The parameter for itemPrice
     * - @returns Promise<import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").ArmoryRedeemResult>
     *
     */
    private sendRedeemRequest(armoryId: number, currentStars: number, itemPrice: number): Promise<ArmoryRedeemResult> {
    return new Promise((resolve) => {
      const steamClient = this.steamService.steamClient;
      let settled = false;

      const settle = (result: ArmoryRedeemResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        steamClient.removeListener('receivedFromGC', onMessage);
        resolve(result);
      };

      const timer = setTimeout(() => {
        settle({ success: false, error: 'Purchase timed out — no response from GC.' });
      }, PURCHASE_TIMEOUT_MS);

      const onMessage = (appid: number, msgType: number, payload: Buffer) => {
        if (appid !== APP_ID || msgType !== MSG_ESO_CREATE) return;
        const item = findCSOEconItemDeep(payload);
        if (!item || !item.defIndex) {
          settle({ success: false, error: 'GC responded but could not parse the received item.' });
        } else {
          settle({ success: true });
        }
      };

      steamClient.on('receivedFromGC', onMessage);

      try {
        const body = encodeRedeemBody(armoryId, currentStars, itemPrice);
        (steamClient as any).sendToGC(APP_ID, MSG_GC_REDEEM, {}, body);
      } catch (err: any) {
        settle({ success: false, error: err.message });
      }
    });
  }
}
