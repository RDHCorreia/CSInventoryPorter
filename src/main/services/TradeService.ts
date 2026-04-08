// ============================================================
// CSInventoryPorter — TradeService
// Manages trade offers with friends via steam-tradeoffer-manager
// ============================================================

import { EventEmitter } from 'events';
import { SteamService } from './SteamService';
import type {
  SteamFriend,
  TradeItem,
  TradeOffer,
  TradeOfferState,
  SendTradeOfferRequest,
  TradeProgress,
} from '../../shared/types';
import { CS2_APP_ID } from '../../shared/constants';

// steam-tradeoffer-manager is a CommonJS module
const TradeOfferManager = require('steam-tradeoffer-manager');
const SteamUser = require('steam-user');

// ETradeOfferState mapping
const STATE_MAP: Record<number, TradeOfferState> = {
  1: 'Invalid',
  2: 'Active',
  3: 'Accepted',
  4: 'Countered',
  5: 'Expired',
  6: 'Canceled',
  7: 'Declined',
  8: 'InvalidItems',
  9: 'NeedsConfirmation',
  10: 'CanceledBySecondFactor',
  11: 'InEscrow',
};

// EFriendRelationship.Friend = 3
const FRIEND_RELATIONSHIP = 3;

export class TradeService extends EventEmitter {
  private steamService: SteamService;
  private manager: any; // TradeOfferManager instance
  private _ready = false;
  private _friendsLoaded = false;

  constructor(steamService: SteamService) {
    super();
    this.steamService = steamService;

    // Create trade offer manager
    this.manager = new TradeOfferManager({
      steam: steamService.steamClient,
      language: 'en',
      pollInterval: 15_000,       // Poll every 15s for offer changes
      savePollData: false,        // We don't persist poll data
    });

    this.setupEventHandlers();
  }

  // ---- Getters ----

  get isReady(): boolean {
    return this._ready;
  }

  // ---- Initialization ----

  /**
     * Setup event handlers.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private setupEventHandlers(): void {
    const client = this.steamService.steamClient;

    // When web session is available → pass cookies to trade manager
    client.on('webSession', (_sessionID: string, cookies: string[]) => {
      this.manager.setCookies(cookies, (err: Error | null) => {
        if (err) {
          console.error('[TradeService] Failed to set cookies:', err.message);
          return;
        }
        this._ready = true;
        console.log('[TradeService] Trade manager ready');
      });
    });

    // Friends list loaded → we can enumerate friends
    client.on('friendsList', () => {
      this._friendsLoaded = true;
    });

    // ---- Trade offer events ----

    this.manager.on('newOffer', (offer: any) => {
      console.log(`[TradeService] New incoming offer #${offer.id} from ${offer.partner.getSteamID64()}`);
      this.resolveOfferPersona(offer).then((resolved) => {
        this.emit('new-offer', resolved);
      });
    });

    this.manager.on('sentOfferChanged', (offer: any, oldState: number) => {
      console.log(`[TradeService] Sent offer #${offer.id} changed: ${STATE_MAP[oldState]} → ${STATE_MAP[offer.state]}`);
      this.resolveOfferPersona(offer).then((resolved) => {
        this.emit('offer-changed', resolved);
      });
    });

    this.manager.on('receivedOfferChanged', (offer: any, oldState: number) => {
      console.log(`[TradeService] Received offer #${offer.id} changed: ${STATE_MAP[oldState]} → ${STATE_MAP[offer.state]}`);
      this.resolveOfferPersona(offer).then((resolved) => {
        this.emit('offer-changed', resolved);
      });
    });

    this.manager.on('pollFailure', (err: Error) => {
      console.error('[TradeService] Poll failure:', err.message);
    });
  }

  // ---- Friends ----

  /** Get the current user's friends list with persona details */
  async getFriends(): Promise<SteamFriend[]> {
    const client = this.steamService.steamClient;
    const myFriends = client.myFriends || {};

    // Filter to actual friends only (relationship === 3)
    const friendIDs = Object.keys(myFriends).filter(
      (id) => myFriends[id] === FRIEND_RELATIONSHIP,
    );

    if (friendIDs.length === 0) return [];

    // Fetch persona data
    try {
      const result = await client.getPersonas(friendIDs);
      const personas = result.personas || result;

      const friends: SteamFriend[] = [];
      for (const steamID of friendIDs) {
        const persona = personas[steamID];
        if (!persona) continue;

        friends.push({
          steamID,
          personaName: persona.player_name || steamID,
          avatarUrl: persona.avatar_url_full || persona.avatar_url_medium || persona.avatar_url_icon || '',
          personaState: persona.persona_state ?? 0,
          gameName: persona.game_name || undefined,
          gameAppId: persona.game_played_app_id || undefined,
        });
      }

      // Sort: online first, then alphabetically
      friends.sort((a, b) => {
        const aOnline = a.personaState > 0 ? 1 : 0;
        const bOnline = b.personaState > 0 ? 1 : 0;
        if (aOnline !== bOnline) return bOnline - aOnline;
        return a.personaName.localeCompare(b.personaName);
      });

      return friends;
    } catch (err: any) {
      console.error('[TradeService] Failed to get persona data:', err.message);
      // Return basic friend list without persona info
      return friendIDs.map((id) => ({
        steamID: id,
        personaName: id,
        avatarUrl: '',
        personaState: 0,
      }));
    }
  }

  // ---- Friend Inventory ----

  /** Load a friend's CS2 inventory for trade selection */
  async getFriendInventory(steamID: string): Promise<TradeItem[]> {
    if (!this._ready) {
      throw new Error('Trade manager not ready — web session cookies not yet available');
    }

    return new Promise((resolve, reject) => {
      this.manager.getUserInventoryContents(
        steamID,
        CS2_APP_ID,
        2, // contextid
        true, // tradableOnly
        (err: Error | null, inventory: any[]) => {
          if (err) {
            console.error(`[TradeService] Failed to load inventory for ${steamID}:`, err.message);
            return reject(err);
          }

          const items: TradeItem[] = (inventory || []).map((item: any) => this.econItemToTradeItem(item));
          resolve(items);
        },
      );
    });
  }

  // ---- Own Tradable Items ----

  /** Fetch asset IDs of OUR tradable CS2 items via the Steam API */
  async getMyTradableAssetIds(): Promise<string[]> {
    if (!this._ready) {
      throw new Error('Trade manager not ready — web session cookies not yet available');
    }

    return new Promise((resolve, reject) => {
      this.manager.getInventoryContents(
        CS2_APP_ID,
        2, // contextid
        true, // tradableOnly
        (err: Error | null, inventory: any[]) => {
          if (err) {
            console.error('[TradeService] Failed to load own tradable inventory:', err.message);
            return reject(err);
          }
          const ids = (inventory || []).map((item: any) => String(item.assetid || item.id || ''));
          resolve(ids);
        },
      );
    });
  }

  // ---- Trade Offers ----

  /** Send a trade offer to a friend */
  async sendTradeOffer(request: SendTradeOfferRequest): Promise<{ success: boolean; offerId?: string; status?: string; error?: string }> {
    if (!this._ready) {
      return { success: false, error: 'Trade manager not ready' };
    }

    this.emitProgress({ state: 'sending', message: 'Creating trade offer...' });

    try {
      const offer = this.manager.createOffer(request.partnerSteamID);

      if (request.tradeToken) {
        offer.setToken(request.tradeToken);
      }

      if (request.message) {
        offer.setMessage(request.message.slice(0, 128));
      }

      // Add our items
      for (const assetId of request.myAssetIds) {
        offer.addMyItem({ appid: CS2_APP_ID, contextid: '2', assetid: assetId });
      }

      // Add their items
      for (const assetId of request.theirAssetIds) {
        offer.addTheirItem({ appid: CS2_APP_ID, contextid: '2', assetid: assetId });
      }

      // Send the offer
      return new Promise((resolve) => {
        offer.send((err: Error | null, status: string) => {
          if (err) {
            console.error('[TradeService] Failed to send offer:', err.message);
            this.emitProgress({ state: 'error', message: err.message });
            resolve({ success: false, error: err.message });
            return;
          }

          console.log(`[TradeService] Offer #${offer.id} sent, status: ${status}`);
          this.emitProgress({ state: 'idle', message: `Offer sent (${status})` });
          resolve({ success: true, offerId: offer.id, status });
        });
      });
    } catch (err: any) {
      this.emitProgress({ state: 'error', message: err.message });
      return { success: false, error: err.message };
    }
  }

  /** Get all active trade offers (sent + received) */
  async getOffers(): Promise<{ sent: TradeOffer[]; received: TradeOffer[] }> {
    if (!this._ready) {
      return { sent: [], received: [] };
    }

    this.emitProgress({ state: 'loading', message: 'Loading trade offers...' });

    return new Promise((resolve) => {
      this.manager.getOffers(
        TradeOfferManager.EOfferFilter.ActiveOnly,
        async (err: Error | null, sent: any[], received: any[]) => {
          if (err) {
            console.error('[TradeService] Failed to get offers:', err.message);
            this.emitProgress({ state: 'error', message: err.message });
            resolve({ sent: [], received: [] });
            return;
          }

          const sentResolved = await Promise.all((sent || []).map((o: any) => this.resolveOfferPersona(o)));
          const receivedResolved = await Promise.all((received || []).map((o: any) => this.resolveOfferPersona(o)));

          this.emitProgress({ state: 'idle' });
          resolve({ sent: sentResolved, received: receivedResolved });
        },
      );
    });
  }

  /** Accept an incoming trade offer */
  async acceptOffer(offerId: string): Promise<{ success: boolean; error?: string }> {
    if (!this._ready) return { success: false, error: 'Trade manager not ready' };

    this.emitProgress({ state: 'loading', message: 'Accepting offer...' });

    return new Promise((resolve) => {
      this.manager.getOffer(offerId, (err: Error | null, offer: any) => {
        if (err) {
          this.emitProgress({ state: 'error', message: err.message });
          resolve({ success: false, error: err.message });
          return;
        }

        offer.accept(false, (acceptErr: Error | null, status: string) => {
          if (acceptErr) {
            console.error(`[TradeService] Failed to accept offer #${offerId}:`, acceptErr.message);
            this.emitProgress({ state: 'error', message: acceptErr.message });
            resolve({ success: false, error: acceptErr.message });
            return;
          }

          console.log(`[TradeService] Accepted offer #${offerId}, status: ${status}`);
          this.emitProgress({ state: 'idle', message: `Offer accepted (${status})` });
          resolve({ success: true });
        });
      });
    });
  }

  /** Decline an incoming trade offer */
  async declineOffer(offerId: string): Promise<{ success: boolean; error?: string }> {
    if (!this._ready) return { success: false, error: 'Trade manager not ready' };

    return new Promise((resolve) => {
      this.manager.getOffer(offerId, (err: Error | null, offer: any) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }

        offer.decline((declineErr: Error | null) => {
          if (declineErr) {
            resolve({ success: false, error: declineErr.message });
            return;
          }
          console.log(`[TradeService] Declined offer #${offerId}`);
          resolve({ success: true });
        });
      });
    });
  }

  /** Cancel a sent trade offer */
  async cancelOffer(offerId: string): Promise<{ success: boolean; error?: string }> {
    if (!this._ready) return { success: false, error: 'Trade manager not ready' };

    return new Promise((resolve) => {
      this.manager.getOffer(offerId, (err: Error | null, offer: any) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }

        offer.cancel((cancelErr: Error | null) => {
          if (cancelErr) {
            resolve({ success: false, error: cancelErr.message });
            return;
          }
          console.log(`[TradeService] Cancelled offer #${offerId}`);
          resolve({ success: true });
        });
      });
    });
  }

  // ---- Helpers ----

  /** Convert a steam-tradeoffer-manager EconItem to our TradeItem */
  private econItemToTradeItem(item: any): TradeItem {
    return {
      assetid: item.assetid || item.id || '',
      appid: item.appid || CS2_APP_ID,
      contextid: String(item.contextid || '2'),
      name: item.name || item.market_name || 'Unknown Item',
      market_hash_name: item.market_hash_name || item.name || '',
      icon_url: item.icon_url
        ? `https://community.akamai.steamstatic.com/economy/image/${item.icon_url}`
        : '',
      tradable: item.tradable !== false,
      color: item.name_color || undefined,
      tags: (item.tags || []).map((t: any) => ({
        category: t.category || '',
        name: t.localized_tag_name || t.name || '',
        color: t.color || undefined,
      })),
    };
  }

  /** Convert a raw trade offer to our TradeOffer type, resolving partner persona */
  private async resolveOfferPersona(offer: any): Promise<TradeOffer> {
    const partnerID = offer.partner.getSteamID64();
    let partnerName: string | undefined;
    let partnerAvatar: string | undefined;

    try {
      const client = this.steamService.steamClient;
      // Check cached users first
      const cached = client.users?.[partnerID];
      if (cached) {
        partnerName = cached.player_name;
        partnerAvatar = cached.avatar_url_full || cached.avatar_url_medium || '';
      } else {
        const result = await client.getPersonas([partnerID]);
        const persona = (result.personas || result)?.[partnerID];
        if (persona) {
          partnerName = persona.player_name;
          partnerAvatar = persona.avatar_url_full || persona.avatar_url_medium || '';
        }
      }
    } catch {
      // Ignore — name is optional
    }

    return {
      id: offer.id || '',
      partnerId: partnerID,
      partnerName,
      partnerAvatar,
      message: offer.message || '',
      state: STATE_MAP[offer.state] || 'Invalid',
      isOurOffer: !!offer.isOurOffer,
      itemsToGive: (offer.itemsToGive || []).map((i: any) => this.econItemToTradeItem(i)),
      itemsToReceive: (offer.itemsToReceive || []).map((i: any) => this.econItemToTradeItem(i)),
      createdAt: offer.created ? new Date(offer.created).getTime() : undefined,
      updatedAt: offer.updated ? new Date(offer.updated).getTime() : undefined,
      expiresAt: offer.expires ? new Date(offer.expires).getTime() : undefined,
    };
  }

  /**
     * Emit progress.
     *
     * Characteristics:
     * - @param progress - The parameter for progress
     * - @returns Nothing (void)
     *
     */
    private emitProgress(progress: TradeProgress): void {
    this.emit('trade-progress', progress);
  }

  /** Clean up */
  destroy(): void {
    if (this.manager) {
      this.manager.shutdown();
    }
    this.removeAllListeners();
  }
}
