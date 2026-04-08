// ============================================================
// CSInventoryPorter — Shared TypeScript types
// ============================================================

// ---- Price Server ----

export interface PriceServerConfig {
  enabled: boolean;
  url: string;       // e.g. http://localhost:3456 or https://my-server.com
  apiKey?: string;   // Optional API key for authentication
}

// ---- Auth / Accounts ----

export type LoginMethod = 'credentials' | 'refreshToken' | 'browserToken' | 'qrCode';

// ---- QR Code login ----

export type QRLoginState = 'generating' | 'ready' | 'scanned' | 'confirmed' | 'expired' | 'error';

export interface QRLoginStatus {
  state: QRLoginState;
  challengeUrl?: string;
  error?: string;
}

export interface LoginCredentials {
  accountName: string;
  password: string;
  twoFactorCode?: string;
  sharedSecret?: string; // For auto-generating TOTP codes
}

export interface LoginRefreshToken {
  refreshToken: string;
}

export interface LoginBrowserToken {
  /** One-time token obtained from steamcommunity.com/chat/clientjstoken */
  webLogonToken: string;
  steamID: string;
}

export type LoginDetails = LoginCredentials | LoginRefreshToken | LoginBrowserToken;

export interface SavedAccount {
  accountName: string;
  steamID: string;
  personaName: string;
  avatarHash?: string;
  refreshToken?: string; // Encrypted at rest
  lastLogin?: number;    // Unix timestamp
}

export interface AccountInfo {
  steamID: string;
  accountName: string;
  personaName: string;
  avatarHash?: string;
  country?: string;
  walletBalance?: number;
  walletCurrency?: number;
  vacBans?: number;
  isLimited?: boolean;
}

// ---- Steam Guard ----

export interface SteamGuardRequest {
  domain: string | null; // null = app code, string = email domain
  lastCodeWrong: boolean;
}

// ---- Connection state ----

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'waitingSteamGuard'
  | 'loggedIn'
  | 'gcConnecting'
  | 'gcConnected'
  | 'error';

export interface ConnectionStatus {
  state: ConnectionState;
  accountName?: string;
  personaName?: string;
  steamID?: string;
  error?: string;
}

// ---- Inventory items ----

export interface StickerInfo {
  slot: number;
  sticker_id: number;
  name?: string;
  image_url?: string;
  wear: number | null;
  scale: number | null;
  rotation: number | null;
  tint_id: number;
  offset_x: number | null;
  offset_y: number | null;
}

export interface CharmInfo {
  charm_id: number;
  name?: string;
  image_url?: string;
}

export interface InventoryItem {
  id: string;
  defindex: number;
  origin?: number;
  position: number;
  custom_name?: string;
  paint_index?: number;
  music_id?: number;
  graffiti_tint_id?: number;
  sticker_item_id?: number;
  paint_seed?: number;
  paint_wear?: number;
  kill_eater_value?: number;
  kill_eater_score_type?: number;
  quest_id?: number;
  tradable_after?: Date;
  stickers?: StickerInfo[];
  charms?: CharmInfo[];
  casket_id?: string;
  casket_contained_item_count?: number;
  image_path?: string;
  image_url?: string;
  market_name?: string;
  rarity_color?: string;
  rarity?: number;
  collection_id?: string;
  collection_name?: string;
  min_float?: number;
  max_float?: number;
  quality_name?: string;
  quality?: number;
  weapon_type?: string;
  is_storage_unit?: boolean;
  marketable?: boolean;
}

export interface StorageUnit {
  id: string;
  custom_name?: string;
  item_count: number;
  items: InventoryItem[];
  isLoaded: boolean;
  isLoading: boolean;
}

// ---- Inventory state (sent to renderer) ----

export type InventoryLoadState = 'idle' | 'loading' | 'loaded' | 'error';

export interface InventoryData {
  state: InventoryLoadState;
  items: InventoryItem[];
  storageUnits: StorageUnit[];
  totalItems: number;
  error?: string;
}

// ---- Casket operations (Phase 3) ----

export interface CasketOperation {
  type: 'add' | 'remove';
  casketId: string;
  itemId: string;
}

export interface BulkOperationProgress {
  queueId: string;
  total: number;
  completed: number;
  failed: number;
  currentItem?: string;
  state: 'idle' | 'running' | 'completed' | 'cancelled' | 'error';
  error?: string;
}


export interface PriceSnapshot {
  time: number;   // Unix timestamp in ms
  value: number;  // Price in selected currency
  volume: number; // Sales volume
}

export interface SkinportPriceData {
  minPrice: number | null;
  maxPrice: number | null;
  meanPrice: number | null;
  medianPrice: number | null;
  quantity: number;
  currency: string;
  lastFetched: number; // Unix timestamp ms
}

export interface ItemPriceData {
  marketHashName: string;
  currentPrice: number;
  priceHistory: PriceSnapshot[];
  lastFetched: number; // Unix timestamp ms
  skinport?: SkinportPriceData;
}

export type PricingLoadState = 'idle' | 'loading' | 'loaded' | 'error';

export interface PricingProgress {
  current: number;
  total: number;
  currentItem?: string;
  state: PricingLoadState;
  error?: string;
}

export interface PortfolioSnapshot {
  time: number;  // Unix timestamp in ms
  value: number; // Total portfolio value in EUR
}

export interface PortfolioData {
  totalValue: number;
  itemPrices: Record<string, ItemPriceData>; // marketHashName → price data
  portfolioHistory: PortfolioSnapshot[];
  state: PricingLoadState;
  progress: PricingProgress;
  error?: string;
}

export interface AccountSnapshot {
  steamID: string;
  accountName: string;
  personaName: string;
  avatarHash?: string;
  totalValue: number;
  totalItems: number;
  lastUpdated: number;
  itemQuantities: Record<string, number>;
}

export interface AccountSnapshotSummary {
  steamID: string;
  accountName: string;
  personaName: string;
  avatarHash?: string;
  totalValue: number;
  totalItems: number;
  lastUpdated: number;
  hasRefreshToken: boolean;
  isActive: boolean;
}

export interface MultiAccountSummary {
  accounts: AccountSnapshotSummary[];
  combinedValue: number;
  combinedHistory: PortfolioSnapshot[];
  activeAccountId: string | null;
}

export interface MarketListing {
  listingId: string;
  assetId: string;
  marketHashName: string;
  image_url?: string;
  buyerPays: number;   // Price the buyer sees (in cents)
  youReceive: number;  // Price you get after fees (in cents)
  status: 'active' | 'pending' | 'sold';
  listedAt: number;    // Unix timestamp ms
  tradeHoldExpires?: number; // Unix timestamp ms when 7-day hold ends
}

export interface ListItemRequest {
  assetId: string;
  /** Price in cents that the seller wants to receive (before adding fees) */
  priceInCents: number;
}

export interface MarketFeeBreakdown {
  /** What the buyer pays (cents) */
  buyerPays: number;
  /** Valve's cut (5% min $0.01) */
  steamFee: number;
  /** CS2 game fee (10% min $0.01) */
  gameFee: number;
  /** What the seller receives (cents) */
  youReceive: number;
}

export type MarketActionState = 'idle' | 'listing' | 'delisting' | 'loading' | 'error';

export interface MarketProgress {
  state: MarketActionState;
  message?: string;
  current?: number;
  total?: number;
}


export interface SteamFriend {
  steamID: string;
  personaName: string;
  avatarUrl: string;
  personaState: number;  // 0=Offline, 1=Online, 2=Busy, 3=Away, etc.
  gameName?: string;     // Currently playing
  gameAppId?: number;
}

export interface TradeItem {
  assetid: string;
  appid: number;
  contextid: string;
  name: string;
  market_hash_name: string;
  icon_url: string;
  tradable: boolean;
  /** Rarity/quality color hex */
  color?: string;
  /** Tags from Steam (type, weapon, exterior, quality, rarity) */
  tags?: Array<{ category: string; name: string; color?: string }>;
}

export type TradeOfferState =
  | 'Invalid'
  | 'Active'
  | 'Accepted'
  | 'Countered'
  | 'Expired'
  | 'Canceled'
  | 'Declined'
  | 'InvalidItems'
  | 'NeedsConfirmation'
  | 'CanceledBySecondFactor'
  | 'InEscrow';

export interface TradeOffer {
  id: string;
  partnerId: string;
  partnerName?: string;
  partnerAvatar?: string;
  message: string;
  state: TradeOfferState;
  isOurOffer: boolean;
  itemsToGive: TradeItem[];
  itemsToReceive: TradeItem[];
  createdAt?: number;   // Unix ms
  updatedAt?: number;
  expiresAt?: number;
}

export interface SendTradeOfferRequest {
  partnerSteamID: string;
  tradeToken?: string;
  message?: string;
  myAssetIds: string[];
  theirAssetIds: string[];
}

export type TradeActionState = 'idle' | 'loading' | 'sending' | 'error';

export interface TradeProgress {
  state: TradeActionState;
  message?: string;
}

export interface InvestmentEntry {
  id: string;
  marketHashName: string;
  displayName: string;
  imageUrl?: string;
  rarityColor?: string;
  quantity: number;
  purchasePrice: number;
  purchaseDate: string;
  currency?: 'USD' | 'EUR';
  notes?: string;
  createdAt: number;
}

export interface InvestmentSummary {
  entry: InvestmentEntry;
  currentPrice: number;
  totalCost: number;
  currentValue: number;
  profit: number;
  profitPercent: number;
  originalTotalCost: number;
  wasConverted: boolean;
}

export interface InvestmentPortfolio {
  entries: InvestmentEntry[];
  totalInvested: number;
  totalCurrentValue: number;
  totalProfit: number;
  totalProfitPercent: number;
}

export interface ExchangeRates {
  base: string;
  rates: Record<string, number>;
  lastFetched: number;
}

export interface TradeupResult {
  success: boolean;
  receivedItemIds?: string[];
  error?: string;
}

export interface TradeupProgress {
  state: 'idle' | 'crafting' | 'completed' | 'error';
  message?: string;
}

export interface TradeupPredictionOutcome {
  defindex: number;
  paintIndex: number;
  name: string;
  imageUrl?: string;
  collectionId: string;
  collectionName?: string;
  chance: number; // 0..1
  minFloat: number;
  maxFloat: number;
  predictedFloat: number;
}

export interface TradeupPrediction {
  outputRarity: number;
  averageInputFloat: number;
  averageNormalizedFloat: number;
  outcomes: TradeupPredictionOutcome[];
  unknownCollectionInputs: number;
  unknownFloatInputs: number;
}

export interface ArmoryItem {
  itemId: string;
  name: string;
  cost: number;
  imageUrl?: string;
  category?: string;
}

export interface ArmoryData {
  stars: number;
  generationTime: number;
  items: ArmoryItem[];
}

export interface ArmoryRedeemResult {
  success: boolean;
  error?: string;
}

export interface ArmoryProgress {
  state: 'idle' | 'redeeming' | 'completed' | 'error';
  message?: string;
  currentStars?: number;
}

export type FullLoadPhase = 'inventory' | 'caskets' | 'ready' | 'prices' | 'done';

export interface FullLoadProgress {
  phase: FullLoadPhase;
  message: string;
  current?: number;
  total?: number;
}

// ---- IPC Channel names ----

export const IPC = {
  // Auth
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_STEAM_GUARD: 'auth:steam-guard',
  AUTH_SUBMIT_STEAM_GUARD: 'auth:submit-steam-guard',
  AUTH_STATUS: 'auth:status',
  AUTH_STATUS_CHANGED: 'auth:status-changed',
  AUTH_QR_START: 'auth:qr-start',
  AUTH_QR_CANCEL: 'auth:qr-cancel',
  AUTH_QR_UPDATE: 'auth:qr-update',

  // Accounts
  ACCOUNTS_LIST: 'accounts:list',
  ACCOUNTS_SAVE: 'accounts:save',
  ACCOUNTS_REMOVE: 'accounts:remove',
  ACCOUNTS_GET: 'accounts:get',

  // Inventory 
  INVENTORY_LOAD: 'inventory:load',
  INVENTORY_UPDATED: 'inventory:updated',
  INVENTORY_GET: 'inventory:get',

  // Casket / Storage Units
  CASKET_CONTENTS: 'casket:contents',
  CASKET_CONTENTS_LOADED: 'casket:contents-loaded',
  CASKET_ADD: 'casket:add',
  CASKET_REMOVE: 'casket:remove',
  CASKET_RENAME: 'casket:rename',
  CASKET_OPERATION_PROGRESS: 'casket:operation-progress',

  // Pricing 
  PRICING_FETCH: 'pricing:fetch',
  PRICING_CANCEL: 'pricing:cancel',
  PRICING_PROGRESS: 'pricing:progress',
  PRICING_GET: 'pricing:get',

  // Multi-account 
  ACCOUNTS_SWITCH: 'accounts:switch',
  ACCOUNTS_MULTI_SUMMARY: 'accounts:multi-summary',
  ACCOUNTS_SAVE_SNAPSHOT: 'accounts:save-snapshot',

  // Settings / Currency 
  SETTINGS_GET_CURRENCY: 'settings:get-currency',
  SETTINGS_SET_CURRENCY: 'settings:set-currency',
  SETTINGS_CURRENCY_CHANGED: 'settings:currency-changed',

  // Full-load 
  FULL_LOAD: 'full-load',
  FULL_LOAD_PROGRESS: 'full-load:progress',

  // Market Listings 
  MARKET_LIST_ITEM: 'market:list-item',
  MARKET_LIST_MULTIPLE: 'market:list-multiple',
  MARKET_DELIST: 'market:delist',
  MARKET_DELIST_ALL: 'market:delist-all',
  MARKET_GET_LISTINGS: 'market:get-listings',
  MARKET_PROGRESS: 'market:progress',
  MARKET_LISTINGS_UPDATED: 'market:listings-updated',

  // In-Game Store 
  STORE_GET_ITEMS: 'store:get-items',
  STORE_PURCHASE: 'store:purchase',
  STORE_GET_WALLET: 'store:get-wallet',
  STORE_PROGRESS: 'store:progress',
  STORE_WALLET_UPDATED: 'store:wallet-updated',

  // Trading 
  TRADE_GET_MY_TRADABLE_IDS: 'trade:get-my-tradable-ids',
  TRADE_GET_FRIENDS: 'trade:get-friends',
  TRADE_GET_FRIEND_INVENTORY: 'trade:get-friend-inventory',
  TRADE_SEND_OFFER: 'trade:send-offer',
  TRADE_GET_OFFERS: 'trade:get-offers',
  TRADE_ACCEPT: 'trade:accept',
  TRADE_DECLINE: 'trade:decline',
  TRADE_CANCEL: 'trade:cancel',
  TRADE_PROGRESS: 'trade:progress',
  TRADE_NEW_OFFER: 'trade:new-offer',
  TRADE_OFFER_CHANGED: 'trade:offer-changed',

  // Investments (Portfolio Tracker)
  INVESTMENTS_GET: 'investments:get',
  INVESTMENTS_ADD: 'investments:add',
  INVESTMENTS_UPDATE: 'investments:update',
  INVESTMENTS_REMOVE: 'investments:remove',
  INVESTMENTS_CLEAR: 'investments:clear',

  // Exchange Rates
  EXCHANGE_RATES_GET: 'exchange-rates:get',
  EXCHANGE_RATES_CONVERT: 'exchange-rates:convert',

  // Trade-Up Contract 
  TRADEUP_EXECUTE: 'tradeup:execute',
  TRADEUP_PREDICT: 'tradeup:predict',
  TRADEUP_PROGRESS: 'tradeup:progress',

  // Armory Redemption 
  ARMORY_GET_DATA: 'armory:get-data',
  ARMORY_REDEEM: 'armory:redeem',
  ARMORY_PROGRESS: 'armory:progress',

  // Price Server 
  PRICE_SERVER_GET: 'priceserver:get',
  PRICE_SERVER_SET: 'priceserver:set',
  PRICE_SERVER_TEST: 'priceserver:test',
} as const;
