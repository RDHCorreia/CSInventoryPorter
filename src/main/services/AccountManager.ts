// ============================================================
// CSInventoryPorter — AccountManager
// Orchestrates SteamService + AccountStore for multi-account
// ============================================================

import { SteamService } from './SteamService';
import { AccountStore } from './AccountStore';
import { InventoryService } from './InventoryService';
import { ItemDataService } from './ItemDataService';
import { PricingService } from './PricingService';
import { SkinportService } from './SkinportService';
import { MarketService, calculateFees, calculateFromBuyerPrice } from './MarketService';
import { TradeService } from './TradeService';
import { InvestmentService } from './InvestmentService';
import { ExchangeRateService } from './ExchangeRateService';
import { TradeupService } from './TradeupService';
import { ArmoryService } from './ArmoryService';
import { EventEmitter } from 'events';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import {
  type LoginDetails,
  type SavedAccount,
  type ConnectionStatus,
  type AccountInfo,
  type SteamGuardRequest,
  type QRLoginStatus,
  type InventoryData,
  type InventoryItem,
  type CasketOperation,
  type BulkOperationProgress,
  type PricingProgress,
  type PortfolioData,
  type AccountSnapshot,
  type AccountSnapshotSummary,
  type MultiAccountSummary,
  type FullLoadProgress,
  type MarketListing,
  type ListItemRequest,
  type MarketFeeBreakdown,
  type MarketProgress,
  type SteamFriend,
  type TradeItem,
  type TradeOffer,
  type SendTradeOfferRequest,
  type TradeProgress,
  type InvestmentEntry,
  type TradeupResult,
  type TradeupPrediction,
  type TradeupProgress,
  type ArmoryData,
  type ArmoryRedeemResult,
  type ArmoryProgress,
  type PriceServerConfig,
} from '../../shared/types';
import {
  SETTINGS_FILE,
  DEFAULT_CURRENCY,
  type CurrencyCode,
} from '../../shared/constants';


export class AccountManager extends EventEmitter {
  private steamService: SteamService;
  private accountStore: AccountStore;
  private inventoryService: InventoryService;
  private itemDataService: ItemDataService;
  private pricingService: PricingService;
  private skinportService: SkinportService;
  private marketService: MarketService;
  private tradeService: TradeService;
  private investmentService: InvestmentService;
  private exchangeRateService: ExchangeRateService;
  private tradeupService: TradeupService;
  private armoryService: ArmoryService;
  private snapshotDir: string;
  private settingsPath: string;
  private backgroundPricingPromise: Promise<void> | null = null;
  private fullLoadSessionId = 0;
  /** Pending refresh token waiting for a steamID (token arrives before account-info) */
  private _pendingRefreshToken: string | null = null;

  constructor() {
    super();
    this.steamService = new SteamService();
    this.accountStore = new AccountStore();
    this.inventoryService = new InventoryService();
    this.itemDataService = new ItemDataService(app.getPath('userData'));
    this.pricingService = new PricingService(app.getPath('userData'));
    this.skinportService = new SkinportService(app.getPath('userData'));
    this.marketService = new MarketService(this.steamService);

    // Kick off Skinport price fetch immediately in the background (non-blocking).
    // Once done, push the prices into PricingService so they're available for display.
    this.skinportService.fetchAll()
      .then(() => {
        this.pricingService.setSkinportPrices(this.skinportService.getAllPrices());
      })
      .catch((err) =>
        console.warn('[AccountManager] Skinport background fetch failed:', err.message),
      );
    this.tradeService = new TradeService(this.steamService);
    this.investmentService = new InvestmentService(app.getPath('userData'));
    this.exchangeRateService = new ExchangeRateService(app.getPath('userData'));
    this.tradeupService = new TradeupService(this.steamService);
    this.armoryService = new ArmoryService(this.steamService);
    this.snapshotDir = path.join(app.getPath('userData'), 'account-snapshots');
    this.settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);

    // Load persisted settings (currency, etc.)
    this.loadSettings();

    // Wire ItemDataService into InventoryService
    this.inventoryService.setItemDataService(this.itemDataService);

    this.setupAutoSave();
    this.setupInventoryBridge();
  }

  // ---- Getters ----

  get steam(): SteamService {
    return this.steamService;
  }

  get store(): AccountStore {
    return this.accountStore;
  }

  get inventory(): InventoryService {
    return this.inventoryService;
  }

  get investments(): InvestmentService {
    return this.investmentService;
  }

  get exchangeRates(): ExchangeRateService {
    return this.exchangeRateService;
  }

  // ---- Auto-save refresh tokens & account info ----

  /**
     * Setup auto save.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private setupAutoSave(): void {
    // When we receive a new refresh token, save it (always — even for refresh-token logins).
    // If steamID is not yet available (fires before loggedOn), store as pending and
    // apply it when account-info arrives with the real steamID.
    this.steamService.on('refresh-token', (accountName: string, steamID: string, token: string) => {
      if (!token) {
        // Safety: ignore if token is somehow undefined (e.g. wrong arg count)
        console.warn('[AccountManager] refresh-token fired with no token, ignoring');
        return;
      }

      if (steamID) {
        // steamID already available — save immediately
        this._pendingRefreshToken = null;
        const existing = this.accountStore.getAccount(steamID);
        if (existing) {
          this.accountStore.updateRefreshToken(steamID, token);
        } else {
          this.accountStore.saveAccount({
            accountName: accountName || 'Unknown',
            steamID,
            personaName: accountName || 'Unknown', // Will be updated when accountInfo arrives
            refreshToken: token,
          });
        }
      } else {
        // steamID not yet available — hold the token until account-info arrives
        console.log('[AccountManager] Holding refresh token (steamID not yet available)');
        this._pendingRefreshToken = token;
      }
    });

    // When account info arrives, update the stored account details.
    // If the account doesn't exist yet (e.g. first login before refresh-token fires),
    // create it now so it always appears in the saved accounts list.
    // Also applies any pending refresh token that arrived before the steamID was known.
    this.steamService.on('account-info', (info: AccountInfo) => {
      if (info.steamID) {
        const existing = this.accountStore.getAccount(info.steamID);

        // Determine the best refresh token: pending > existing saved
        const refreshToken = this._pendingRefreshToken || existing?.refreshToken;
        this._pendingRefreshToken = null;

        this.accountStore.saveAccount({
          accountName: info.accountName || existing?.accountName || '',
          steamID: info.steamID,
          personaName: info.personaName || existing?.personaName || info.accountName || '',
          avatarHash: info.avatarHash || existing?.avatarHash,
          refreshToken,
        });
      }
    });

    // When wallet event fires on first login and no settings file exists,
    // use the wallet's native currency as the default.  After that the user
    // can switch freely via the UI — we don't auto-override their choice.
    this.steamService.on('wallet', (_hasWallet: boolean, _currency: number, _balance: number) => {
      // Initialize currency only once when settings do not exist yet.
      const hasPersistedSettings = fs.existsSync(this.settingsPath);
      if (!hasPersistedSettings) {
        console.log('[AccountManager] No settings file — defaulting currency to EUR');
        this.pricingService.setCurrency(DEFAULT_CURRENCY);
        this.saveSettings();
        this.emit('currency-changed', DEFAULT_CURRENCY);
      }
    });
  }

  // ---- Auto-connect inventory to GC ----

  /**
     * Setup inventory bridge.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private setupInventoryBridge(): void {
    // When GC connects, attach the inventory service and start loading IMMEDIATELY.
    // ItemDataService initialization runs IN PARALLEL — inventory data arrives from
    // the GC while item names/images are being fetched.  Once ItemData is ready we
    // re-resolve names on the already-loaded items, giving the user instant inventory
    // visibility without waiting for the remote API.
    this.steamService.on('gc-connected', async () => {
      console.log('[AccountManager] GC connected — starting inventory load + item data in parallel');

      // 1. Attach + start inventory load immediately (no waiting)
      this.inventoryService.attachToGC(this.steamService.csgoClient);
      this.inventoryService.loadInventory();

      // 2. Initialize item data concurrently
      try {
        await this.itemDataService.initialize();
        console.log('[AccountManager] ItemDataService ready — re-resolving inventory names');
        // Re-process already-loaded items so they get proper names/images
        this.inventoryService.reResolveItemData();
      } catch (err: any) {
        console.warn('[AccountManager] ItemDataService init failed:', err.message);
      }

      // 3. Enrich tradability from Steam Web API once inventory is loaded.
      //    Steam's endpoint returns authoritative tradable/marketable booleans that
      //    correctly handle all origin, flag, and cooldown combinations.
      const enrichOnLoad = (data: InventoryData) => {
        if (data.state !== 'loaded') return;
        this.inventoryService.off('inventory-updated', enrichOnLoad);
        const steamId = this.steamService.steamClient.steamID?.getSteamID64();
        const cookieHeader = this.steamService.cookieHeader;
        if (!steamId || !cookieHeader) return;
        this.inventoryService.enrichTradabilityFromWebAPI(steamId, cookieHeader)
          .catch((err: any) => console.warn('[AccountManager] Tradability enrichment failed:', err.message));
      };
      this.inventoryService.on('inventory-updated', enrichOnLoad);
    });

    // When GC disconnects, detach
    this.steamService.on('gc-disconnected', () => {
      console.log('[AccountManager] GC disconnected — detaching inventory service');
      this.inventoryService.detachFromGC();
    });

    // When we log out, reset inventory
    this.steamService.on('status-changed', (status: ConnectionStatus) => {
      if (status.state === 'disconnected' || status.state === 'error') {
        this.fullLoadSessionId++;
        this.backgroundPricingPromise = null;
        this.pricingService.cancelFetch();
        this.inventoryService.reset();
        this.armoryService.reset();
      }
    });
  }

  /** Login with arbitrary details (credentials, refresh token, or browser token) */
  async login(details: LoginDetails): Promise<void> {
    // Save current account snapshot before switching
    this.saveCurrentSnapshot();
    this.fullLoadSessionId++;
    this.backgroundPricingPromise = null;
    this.inventoryService.reset();
    this.armoryService.reset();
    return this.steamService.login(details);
  }

  /** Login using a saved account's refresh token */
  async loginWithSavedAccount(steamID: string): Promise<void> {
    const account = this.accountStore.getAccount(steamID);
    if (!account) {
      throw new Error(`No saved account found for ${steamID}`);
    }
    if (!account.refreshToken) {
      throw new Error(`No refresh token saved for ${account.accountName}`);
    }

    return this.login({ refreshToken: account.refreshToken });
  }

  /** Submit a Steam Guard code (when prompted) */
  submitSteamGuardCode(code: string): void {
    this.steamService.submitSteamGuardCode(code);
  }

  /** Start QR code login flow */
  async startQRLogin(): Promise<QRLoginStatus> {
    return this.steamService.startQRLogin();
  }

  /** Cancel an in-progress QR login */
  cancelQRLogin(): void {
    this.steamService.cancelQRLogin();
  }

  /** Logout the current session */
  logout(): void {
    this.saveCurrentSnapshot();
    this.fullLoadSessionId++;
    this.backgroundPricingPromise = null;
    this.pricingService.cancelFetch();
    this.steamService.logout();
  }

  // ---- Account management ----

  /**
     * List accounts.
     *
     * Characteristics:
     * - @returns import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").SavedAccount[]
     *
     */
    listAccounts(): SavedAccount[] {
    return this.accountStore.listAccounts();
  }

  /**
     * Remove account.
     *
     * Characteristics:
     * - @param steamID - The parameter for steamID
     * - @returns boolean
     *
     */
    removeAccount(steamID: string): boolean {
    return this.accountStore.removeAccount(steamID);
  }

  // ---- Event forwarding helpers ----

  /**
     * On status changed.
     *
     * Characteristics:
     * - @param handler - The parameter for handler
     * - @returns Nothing (void)
     *
     */
    onStatusChanged(handler: (status: ConnectionStatus) => void): void {
    this.steamService.on('status-changed', handler);
  }

  /**
     * On steam guard.
     *
     * Characteristics:
     * - @param handler - The parameter for handler
     * - @returns Nothing (void)
     *
     */
    onSteamGuard(handler: (request: SteamGuardRequest) => void): void {
    this.steamService.on('steam-guard', handler);
  }

  /**
     * On error.
     *
     * Characteristics:
     * - @param handler - The parameter for handler
     * - @returns Nothing (void)
     *
     */
    onError(handler: (error: Error) => void): void {
    this.steamService.on('error', handler);
  }

  /**
     * On g c connected.
     *
     * Characteristics:
     * - @param handler - The parameter for handler
     * - @returns Nothing (void)
     *
     */
    onGCConnected(handler: () => void): void {
    this.steamService.on('gc-connected', handler);
  }

  /**
     * On q r update.
     *
     * Characteristics:
     * - @param handler - The parameter for handler
     * - @returns Nothing (void)
     *
     */
    onQRUpdate(handler: (status: QRLoginStatus) => void): void {
    this.steamService.on('qr-update', handler);
  }

  // ---- Inventory event forwarding ----

  /**
     * On inventory updated.
     *
     * Characteristics:
     * - @param handler - The parameter for handler
     * - @returns Nothing (void)
     *
     */
    onInventoryUpdated(handler: (data: InventoryData) => void): void {
    this.inventoryService.on('inventory-updated', handler);
  }

  /**
     * On casket contents loaded.
     *
     * Characteristics:
     * - @param handler - The parameter for handler
     * - @returns Nothing (void)
     *
     */
    onCasketContentsLoaded(handler: (casketId: string, items: InventoryItem[]) => void): void {
    this.inventoryService.on('casket-contents-loaded', handler);
  }

  /** Reload the full inventory from GC */
  reloadInventory(): void {
    if (this.steamService.isGCConnected) {
      this.inventoryService.loadInventory();
    }
  }

  /** Get current inventory data snapshot */
  getInventoryData(): InventoryData {
    return this.inventoryService.inventoryData;
  }

  /** Load the contents of a specific storage unit */
  async loadCasketContents(casketId: string): Promise<InventoryItem[]> {
    return this.inventoryService.loadCasketContents(casketId);
  }

  // ---- Casket operations (Phase 3) ----

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
    return this.inventoryService.executeBulkOperation(operations, delayMs, itemCount);
  }

  /**
     * Cancel bulk operation.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    cancelBulkOperation(): void {
    this.inventoryService.cancelBulkOperation();
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
    return this.inventoryService.renameCasket(casketId, name);
  }

  /**
     * On casket operation progress.
     *
     * Characteristics:
     * - @param handler - The parameter for handler
     * - @returns Nothing (void)
     *
     */
    onCasketOperationProgress(handler: (progress: BulkOperationProgress) => void): void {
    this.inventoryService.on('casket-operation-progress', handler);
  }

  // ---- Pricing (Phase 4) ----

  /**
     * Fetches all prices.
     *
     * Characteristics:
     * - @returns Promise<void>
     *
     */
    async fetchAllPrices(): Promise<void> {
    // Auto-load all unloaded storage unit contents before pricing
    // so that items inside caskets are included in the price fetch.
    const data = this.inventoryService.inventoryData;
    const unloaded = data.storageUnits.filter((u) => !u.isLoaded && !u.isLoading && u.item_count > 0);
    if (unloaded.length > 0 && this.steamService.isGCConnected) {
      const totalUnloaded = unloaded.length;
      console.log(`[AccountManager] Auto-loading ${totalUnloaded} storage units before price fetch...`);

      // Emit progress so the UI shows what's happening
      this.pricingService.emit('pricing-progress', {
        current: 0,
        total: totalUnloaded,
        state: 'loading',
        currentItem: `Loading storage units (0/${totalUnloaded})...`,
      });

      let loaded = 0;
      for (const unit of unloaded) {
        try {
          const unitName = unit.custom_name || `Storage Unit #${unit.id}`;
          this.pricingService.emit('pricing-progress', {
            current: loaded,
            total: totalUnloaded,
            state: 'loading',
            currentItem: `Loading ${unitName}...`,
          });
          await this.inventoryService.loadCasketContents(unit.id);
          loaded++;
          // Small delay between casket loads to avoid GC throttling
          await new Promise((r) => setTimeout(r, 500));
        } catch (err: any) {
          loaded++;
          console.warn(`[AccountManager] Failed to load casket ${unit.id}:`, err.message);
        }
      }
    }

    // Ensure latest Skinport prices are merged before fetching Steam prices
    if (this.skinportService.itemCount > 0) {
      this.pricingService.setSkinportPrices(this.skinportService.getAllPrices());
    }

    // Re-read inventory data after loading all casket contents
    const freshData = this.inventoryService.inventoryData;
    await this.pricingService.fetchAllPrices(freshData.items, freshData.storageUnits);

    // Auto-save snapshot after successful price fetch
    this.saveCurrentSnapshot();
  }

  /**
     * Cancel price fetch.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    cancelPriceFetch(): void {
    this.pricingService.cancelFetch();
  }

  /**
     * Gets portfolio data.
     *
     * Characteristics:
     * - @returns import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").PortfolioData
     *
     */
    getPortfolioData(): PortfolioData {
    const data = this.inventoryService.inventoryData;
    const itemPrices = this.pricingService.getAllCachedPrices();
    const totalValue = this.pricingService.computeTotalValue(data.items, data.storageUnits);
    const portfolioHistory = this.pricingService.computePortfolioHistory(data.items, data.storageUnits);

    return {
      totalValue,
      itemPrices,
      portfolioHistory,
      state: this.pricingService.isFetching ? 'loading' : 'loaded',
      progress: { current: 0, total: 0, state: 'idle' },
    };
  }

  /** Get market hash name for an item (used by renderer for price lookups) */
  getMarketHashName(item: InventoryItem): string | null {
    return this.pricingService.getMarketHashName(item);
  }

  /**
     * On pricing progress.
     *
     * Characteristics:
     * - @param handler - The parameter for handler
     * - @returns Nothing (void)
     *
     */
    onPricingProgress(handler: (progress: PricingProgress) => void): void {
    this.pricingService.on('pricing-progress', handler);
  }

  // ---- Market Listings (Phase 6 — Market Management) ----

  /** Fetch active market listings */
  async fetchMarketListings(): Promise<MarketListing[]> {
    return this.marketService.fetchMyListings();
  }

  /** List a single item for sale */
  async listItemForSale(assetId: string, priceInCents: number): Promise<{ success: boolean; listingId?: string; error?: string; requiresConfirmation?: boolean }> {
    return this.marketService.listItem(assetId, priceInCents);
  }

  /** List multiple items for sale */
  async listMultipleItems(requests: ListItemRequest[]): Promise<{ succeeded: number; failed: number; errors: string[] }> {
    return this.marketService.listMultipleItems(requests);
  }

  /** Remove a listing from the market */
  async delistItem(listingId: string): Promise<{ success: boolean; error?: string }> {
    return this.marketService.delistItem(listingId);
  }

  /** Remove all active listings */
  async delistAll(): Promise<{ succeeded: number; failed: number }> {
    return this.marketService.delistAll();
  }

  /** Cancel an in-progress market operation */
  cancelMarketOperation(): void {
    this.marketService.cancel();
  }

  /** Get cached market listings */
  getMarketListings(): MarketListing[] {
    return this.marketService.listings;
  }

  /** Calculate market fees for a given seller price */
  calculateMarketFees(youReceiveCents: number): MarketFeeBreakdown {
    return calculateFees(youReceiveCents);
  }

  /** Calculate market fees given a buyer price */
  calculateFromBuyerPrice(buyerPaysCents: number): MarketFeeBreakdown {
    return calculateFromBuyerPrice(buyerPaysCents);
  }

  /**
     * On market progress.
     *
     * Characteristics:
     * - @param handler - The parameter for handler
     * - @returns Nothing (void)
     *
     */
    onMarketProgress(handler: (progress: MarketProgress) => void): void {
    this.marketService.on('market-progress', handler);
  }

  /**
     * On market listings updated.
     *
     * Characteristics:
     * - @param handler - The parameter for handler
     * - @returns Nothing (void)
     *
     */
    onMarketListingsUpdated(handler: (listings: MarketListing[]) => void): void {
    this.marketService.on('listings-updated', handler);
  }

  // ---- Trading (Friend Trade Offers) ----

  /** Get the current user's friends list */
  async getFriends(): Promise<SteamFriend[]> {
    return this.tradeService.getFriends();
  }

  /** Get a friend's CS2 inventory */
  async getFriendInventory(steamID: string): Promise<TradeItem[]> {
    return this.tradeService.getFriendInventory(steamID);
  }

  /** Get our own tradable asset IDs via Steam API */
  async getMyTradableAssetIds(): Promise<string[]> {
    return this.tradeService.getMyTradableAssetIds();
  }

  /** Send a trade offer to a friend */
  async sendTradeOffer(request: SendTradeOfferRequest): Promise<{ success: boolean; offerId?: string; status?: string; error?: string }> {
    return this.tradeService.sendTradeOffer(request);
  }

  /** Get active trade offers */
  async getTradeOffers(): Promise<{ sent: TradeOffer[]; received: TradeOffer[] }> {
    return this.tradeService.getOffers();
  }

  /** Accept an incoming trade offer */
  async acceptTradeOffer(offerId: string): Promise<{ success: boolean; error?: string }> {
    return this.tradeService.acceptOffer(offerId);
  }

  /** Decline an incoming trade offer */
  async declineTradeOffer(offerId: string): Promise<{ success: boolean; error?: string }> {
    return this.tradeService.declineOffer(offerId);
  }

  /** Cancel a sent trade offer */
  async cancelTradeOffer(offerId: string): Promise<{ success: boolean; error?: string }> {
    return this.tradeService.cancelOffer(offerId);
  }

  /**
     * On trade progress.
     *
     * Characteristics:
     * - @param handler - The parameter for handler
     * - @returns Nothing (void)
     *
     */
    onTradeProgress(handler: (progress: TradeProgress) => void): void {
    this.tradeService.on('trade-progress', handler);
  }

  /**
     * On new trade offer.
     *
     * Characteristics:
     * - @param handler - The parameter for handler
     * - @returns Nothing (void)
     *
     */
    onNewTradeOffer(handler: (offer: TradeOffer) => void): void {
    this.tradeService.on('new-offer', handler);
  }

  /**
     * On trade offer changed.
     *
     * Characteristics:
     * - @param handler - The parameter for handler
     * - @returns Nothing (void)
     *
     */
    onTradeOfferChanged(handler: (offer: TradeOffer) => void): void {
    this.tradeService.on('offer-changed', handler);
  }

  // ---- Trade-Up Contract (Phase 8) ----

  /** Execute a trade-up contract with 10 items */
  async executeTradeup(itemIds: string[]): Promise<TradeupResult> {
    return this.tradeupService.executeTradeup(itemIds);
  }

  /**
     * Predict tradeup.
     *
     * Characteristics:
     * - @param items - The parameter for items
     * - @returns import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").TradeupPrediction
     *
     */
    predictTradeup(items: InventoryItem[]): TradeupPrediction | null {
    return this.tradeupService.predictTradeup(items, this.itemDataService);
  }

  /**
     * On tradeup progress.
     *
     * Characteristics:
     * - @param handler - The parameter for handler
     * - @returns Nothing (void)
     *
     */
    onTradeupProgress(handler: (progress: TradeupProgress) => void): void {
    this.tradeupService.on('tradeup-progress', handler);
  }

  // ---- Settings / Currency (Phase 6) ----

  /**
     * Gets currency.
     *
     * Characteristics:
     * - @returns import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/constants").CurrencyCode
     *
     */
    getCurrency(): CurrencyCode {
    return this.pricingService.currency;
  }

  /**
     * Sets currency.
     *
     * Characteristics:
     * - @param code - The parameter for code
     * - @returns Nothing (void)
     *
     */
    setCurrency(code: CurrencyCode): void {
    this.pricingService.setCurrency(code);
    this.saveSettings();
    this.emit('currency-changed', this.pricingService.currency);
  }

  /**
     * Loads settings.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private loadSettings(): void {
    try {
      if (!fs.existsSync(this.settingsPath)) return;
      const raw = fs.readFileSync(this.settingsPath, 'utf-8');
      const settings = JSON.parse(raw);
      const rawCurrency = settings?.currency;
      const currency: CurrencyCode = rawCurrency === 'USD' || rawCurrency === 'EUR'
        ? rawCurrency
        : DEFAULT_CURRENCY;

      this.pricingService.setCurrency(currency);
      // Restore price server config
      if (settings.priceServer && typeof settings.priceServer === 'object') {
        this.pricingService.setPriceServer(settings.priceServer);
      }
      this.saveSettings();
    } catch (err: any) {
      console.warn('[AccountManager] Failed to load settings:', err.message);
    }
  }

  /**
     * Save settings.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private saveSettings(): void {
    try {
      const settings: any = { currency: this.pricingService.currency };
      const ps = this.pricingService.priceServer;
      if (ps) settings.priceServer = ps;
      fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (err: any) {
      console.warn('[AccountManager] Failed to save settings:', err.message);
    }
  }

  // ---- Price Server settings ----

  /**
     * Gets price server config.
     *
     * Characteristics:
     * - @returns import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").PriceServerConfig
     *
     */
    getPriceServerConfig(): PriceServerConfig | null {
    return this.pricingService.priceServer;
  }

  /**
     * Sets price server config.
     *
     * Characteristics:
     * - @param config - The parameter for config
     * - @returns Nothing (void)
     *
     */
    setPriceServerConfig(config: PriceServerConfig | null): void {
    this.pricingService.setPriceServer(config);
    this.saveSettings();
  }

  /**
     * Test price server.
     *
     * Characteristics:
     * - @param config - The parameter for config
     * - @returns Promise<{ success: boolean; totalPrices?: number; latencyMs?: number; error?: string; }>
     *
     */
    async testPriceServer(config: PriceServerConfig): Promise<{ success: boolean; totalPrices?: number; latencyMs?: number; error?: string }> {
    return this.pricingService.testPriceServer(config);
  }

  // ---- Full-load after login (Phase 6) ----

  /**
     * On full load progress.
     *
     * Characteristics:
     * - @param handler - The parameter for handler
     * - @returns Nothing (void)
     *
     */
    onFullLoadProgress(handler: (progress: FullLoadProgress) => void): void {
    this.on('full-load-progress', handler);
  }

  /**
   * Run the complete post-login loading sequence:
   * 1. Wait for inventory to finish loading (already triggered by GC connect)
   * 2. Load all storage unit contents
   * 3. Mark app ready and continue price fetching in background
   * Emits 'full-load-progress' events throughout.
   */
  async fullLoad(): Promise<void> {
    const sessionId = ++this.fullLoadSessionId;

    // Phase 1: Wait for inventory to load (already started by setupInventoryBridge)
    this.emitFullLoad('inventory', 'Loading inventory from Game Coordinator...');

    await this.waitForInventoryLoaded();

    if (sessionId !== this.fullLoadSessionId) return;

    const invData = this.inventoryService.inventoryData;
    if (invData.state === 'error') {
      this.emitFullLoad('ready', 'Inventory load failed — continuing with limited data');
      this.emitFullLoad('done', 'Inventory load failed — continuing without items');
      return;
    }

    // Phase 2: Load all unloaded storage unit contents
    const unloaded = invData.storageUnits.filter((u) => !u.isLoaded && !u.isLoading && u.item_count > 0);
    if (unloaded.length > 0 && this.steamService.isGCConnected) {
      const total = unloaded.length;
      let loaded = 0;
      for (const unit of unloaded) {
        const unitName = unit.custom_name || `Storage Unit #${unit.id}`;
        this.emitFullLoad('caskets', `Loading ${unitName}...`, loaded, total);
        try {
          await this.inventoryService.loadCasketContents(unit.id);
          loaded++;
          await new Promise((r) => setTimeout(r, 500));
        } catch (err: any) {
          loaded++;
          console.warn(`[AccountManager] fullLoad: casket ${unit.id} failed:`, err.message);
        }

        if (sessionId !== this.fullLoadSessionId) return;
      }
    }

    // Core data is ready; allow entering the app while pricing continues in background.
    this.emitFullLoad('ready', 'Inventory ready — prices will continue loading in background');

    this.startBackgroundPriceLoad(sessionId);
  }

  /** Wait for the inventory service to reach 'loaded' or 'error' state */
  private waitForInventoryLoaded(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        const state = this.inventoryService.inventoryData.state;
        if (state === 'loaded' || state === 'error') {
          resolve();
        } else if (!this.steamService.isGCConnected && state === 'idle') {
          resolve();
        } else {
          setTimeout(check, 250);
        }
      };
      check();
    });
  }

  /**
     * Start background price load.
     *
     * Characteristics:
     * - @param sessionId - The parameter for sessionId
     * - @returns Nothing (void)
     *
     */
    private startBackgroundPriceLoad(sessionId: number): void {
    if (this.backgroundPricingPromise || this.pricingService.isFetching) {
      this.emitFullLoad('done', 'Inventory loaded. Prices are still updating in background.');
      return;
    }

    this.backgroundPricingPromise = (async () => {
      this.emitFullLoad('prices', 'Fetching prices from Steam Market in background...');
      try {
        const freshData = this.inventoryService.inventoryData;
        await this.pricingService.fetchAllPrices(freshData.items, freshData.storageUnits);
        if (sessionId === this.fullLoadSessionId) {
          this.saveCurrentSnapshot();
          this.emitFullLoad('done', 'All data loaded.');
        }
      } catch (err: any) {
        if (sessionId === this.fullLoadSessionId) {
          console.warn('[AccountManager] fullLoad: background price fetch failed:', err.message);
          this.emitFullLoad('done', 'Inventory loaded. Price refresh finished with errors.');
        }
      } finally {
        this.backgroundPricingPromise = null;
      }
    })();
  }

  /**
     * Emit full load.
     *
     * Characteristics:
     * - @param phase - The parameter for phase
     * - @param message - The parameter for message
     * - @param current - The parameter for current
     * - @param total - The parameter for total
     * - @returns Nothing (void)
     *
     */
    private emitFullLoad(phase: FullLoadProgress['phase'], message: string, current?: number, total?: number): void {
    const progress: FullLoadProgress = { phase, message, current, total };
    this.emit('full-load-progress', progress);
  }

  // ---- Multi-account (Phase 5) ----

  /** Save the current account's inventory snapshot to disk */
  saveCurrentSnapshot(): void {
    const steamID = this.steamService.steamClient.steamID?.getSteamID64();
    if (!steamID) return;

    const invData = this.inventoryService.inventoryData;
    if (invData.state !== 'loaded') return;

    const allItems = [...invData.items];
    for (const unit of invData.storageUnits) {
      if (unit.items?.length) allItems.push(...unit.items);
    }

    const itemQuantities: Record<string, number> = {};
    for (const item of allItems) {
      const marketHashName = this.pricingService.getMarketHashName(item);
      const fallbackName = item.market_name || item.custom_name || `Item #${item.defindex}`;
      const name = marketHashName || fallbackName;
      itemQuantities[name] = (itemQuantities[name] ?? 0) + 1;
    }

    const info = this.steamService.accountInfo;
    const snapshot: AccountSnapshot = {
      steamID,
      accountName: info?.accountName ?? '',
      personaName: info?.personaName ?? '',
      avatarHash: info?.avatarHash,
      totalValue: this.pricingService.computeTotalValueFromMap(itemQuantities),
      totalItems: allItems.length,
      lastUpdated: Date.now(),
      itemQuantities,
    };

    try {
      if (!fs.existsSync(this.snapshotDir)) {
        fs.mkdirSync(this.snapshotDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(this.snapshotDir, `${steamID}.json`),
        JSON.stringify(snapshot),
        'utf-8',
      );
    } catch (err: any) {
      console.warn('[AccountManager] Failed to save snapshot:', err.message);
    }
  }

  /** Load a snapshot from disk */
  private loadSnapshot(steamID: string): AccountSnapshot | null {
    try {
      const filePath = path.join(this.snapshotDir, `${steamID}.json`);
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AccountSnapshot;
    } catch (err: any) {
      console.warn(`[AccountManager] Failed to load snapshot for ${steamID}:`, err.message);
      return null;
    }
  }

  /** Load all saved snapshots */
  private getAllSnapshots(): Map<string, AccountSnapshot> {
    const snapshots = new Map<string, AccountSnapshot>();
    try {
      if (!fs.existsSync(this.snapshotDir)) return snapshots;
      for (const file of fs.readdirSync(this.snapshotDir)) {
        if (!file.endsWith('.json')) continue;
        const steamID = file.replace('.json', '');
        const snapshot = this.loadSnapshot(steamID);
        if (snapshot) snapshots.set(steamID, snapshot);
      }
    } catch (err: any) {
      console.warn('[AccountManager] Failed to read snapshots:', err.message);
    }
    return snapshots;
  }

  /** Switch to a different saved account */
  async switchAccount(steamID: string): Promise<void> {
    // Logout current session silently
    this.steamService.logout();

    // Give Steam a substantial tick to fully tear down internal sockets
    await new Promise((r) => setTimeout(r, 600));

    // Delegate fully to standard login flow (which handles snapshots & resets)
    await this.loginWithSavedAccount(steamID);
  }

  /** Get combined portfolio data for all saved accounts */
  getCombinedPortfolioData(): MultiAccountSummary {
    const savedAccounts = this.accountStore.listAccounts();
    const activeId = this.steamService.steamClient.steamID?.getSteamID64() ?? null;
    const allSnapshots = this.getAllSnapshots();

    const summaries: AccountSnapshotSummary[] = [];
    const combinedQuantities: Record<string, number> = {};
    let combinedValue = 0;

    for (const account of savedAccounts) {
      const isActive = account.steamID === activeId;

      if (isActive && this.inventoryService.inventoryData.state === 'loaded') {
        // Use live data for the active account
        const invData = this.inventoryService.inventoryData;
        const allItems = [...invData.items];
        for (const unit of invData.storageUnits) {
          if (unit.items?.length) allItems.push(...unit.items);
        }

        const liveQuantities: Record<string, number> = {};
        for (const item of allItems) {
          const name = this.pricingService.getMarketHashName(item);
          if (name) {
            liveQuantities[name] = (liveQuantities[name] ?? 0) + 1;
            combinedQuantities[name] = (combinedQuantities[name] ?? 0) + 1;
          }
        }

        const value = this.pricingService.computeTotalValueFromMap(liveQuantities);
        combinedValue += value;

        summaries.push({
          steamID: account.steamID,
          accountName: account.accountName,
          personaName: account.personaName,
          avatarHash: account.avatarHash,
          totalValue: value,
          totalItems: invData.totalItems,
          lastUpdated: Date.now(),
          hasRefreshToken: !!account.refreshToken,
          isActive: true,
        });
      } else if (isActive) {
        // Active account but inventory not fully loaded yet — use snapshot if available, show as active
        const snapshot = allSnapshots.get(account.steamID);
        if (snapshot) {
          const freshValue = this.pricingService.computeTotalValueFromMap(snapshot.itemQuantities);
          combinedValue += freshValue;
          for (const [name, qty] of Object.entries(snapshot.itemQuantities)) {
            combinedQuantities[name] = (combinedQuantities[name] ?? 0) + qty;
          }
          summaries.push({
            steamID: account.steamID,
            accountName: account.personaName ?? account.accountName,
            personaName: account.personaName,
            avatarHash: account.avatarHash,
            totalValue: freshValue,
            totalItems: snapshot.totalItems,
            lastUpdated: snapshot.lastUpdated,
            hasRefreshToken: !!account.refreshToken,
            isActive: true,
          });
        } else {
          summaries.push({
            steamID: account.steamID,
            accountName: account.accountName,
            personaName: account.personaName,
            avatarHash: account.avatarHash,
            totalValue: 0,
            totalItems: 0,
            lastUpdated: account.lastLogin ?? 0,
            hasRefreshToken: !!account.refreshToken,
            isActive: true,
          });
        }
      } else {
        // Use cached snapshot for inactive accounts
        const snapshot = allSnapshots.get(account.steamID);

        if (snapshot) {
          // Recompute value using fresh prices from global cache
          const freshValue = this.pricingService.computeTotalValueFromMap(snapshot.itemQuantities);
          combinedValue += freshValue;
          for (const [name, qty] of Object.entries(snapshot.itemQuantities)) {
            combinedQuantities[name] = (combinedQuantities[name] ?? 0) + qty;
          }

          summaries.push({
            steamID: account.steamID,
            accountName: snapshot.accountName,
            personaName: snapshot.personaName,
            avatarHash: snapshot.avatarHash,
            totalValue: freshValue,
            totalItems: snapshot.totalItems,
            lastUpdated: snapshot.lastUpdated,
            hasRefreshToken: !!account.refreshToken,
            isActive: false,
          });
        } else {
          // No snapshot, just show basic account info
          summaries.push({
            steamID: account.steamID,
            accountName: account.accountName,
            personaName: account.personaName,
            avatarHash: account.avatarHash,
            totalValue: 0,
            totalItems: 0,
            lastUpdated: account.lastLogin ?? 0,
            hasRefreshToken: !!account.refreshToken,
            isActive: false,
          });
        }
      }
    }

    const combinedHistory = this.pricingService.computePortfolioHistoryFromMap(combinedQuantities);

    return {
      accounts: summaries,
      combinedValue: Math.round(combinedValue * 100) / 100,
      combinedHistory,
      activeAccountId: activeId,
    };
  }

  // ---- Armory Redemption (Phase 9) ----

  /**
     * Gets armory data.
     *
     * Characteristics:
     * - @returns import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").ArmoryData
     *
     */
    getArmoryData(): ArmoryData {
    return this.armoryService.getArmoryData();
  }

  /**
     * Redeem armory item.
     *
     * Characteristics:
     * - @param armoryId - The parameter for armoryId
     * - @param count - The parameter for count
     * - @returns Promise<import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").ArmoryRedeemResult>
     *
     */
    async redeemArmoryItem(armoryId: number, count?: number): Promise<ArmoryRedeemResult> {
    return this.armoryService.redeemItem(armoryId, count);
  }

  /**
     * On armory progress.
     *
     * Characteristics:
     * - @param handler - The parameter for handler
     * - @returns Nothing (void)
     *
     */
    onArmoryProgress(handler: (progress: ArmoryProgress) => void): void {
    this.armoryService.on('armory-progress', handler);
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
    this.saveCurrentSnapshot();
    this.tradeupService.destroy();
    this.tradeService.destroy();
    this.inventoryService.destroy();
    this.steamService.destroy();
  }
}
