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
  /** Raw GC origin value used for default-item marketability guards */
  origin?: number;
  position: number;
  custom_name?: string;
  paint_index?: number;
  /** Music kit id from attribute 166 (used by defindex 1314 re-resolution) */
  music_id?: number;
  /** Graffiti tint id from attribute 233 (used by defindex 1348/1349 re-resolution) */
  graffiti_tint_id?: number;
  /** Sticker kit id for sticker/patch inventory items (defindex 1209/4609) */
  sticker_item_id?: number;
  paint_seed?: number;
  paint_wear?: number;
  kill_eater_value?: number;
  kill_eater_score_type?: number;
  quest_id?: number;
  tradable_after?: Date;
  stickers?: StickerInfo[];
  charms?: CharmInfo[];
  casket_id?: string;               // If this item is inside a storage unit
  casket_contained_item_count?: number; // Only for storage units
  /** Image path for Steam CDN (append to STEAM_CDN_IMAGE_BASE) */
  image_path?: string;
  /** Full resolved image URL */
  image_url?: string;
  /** Human-readable market name */
  market_name?: string;
  /** Item rarity color hex (e.g. "#4b69ff" for Mil-Spec) */
  rarity_color?: string;
  /** Numeric rarity level (1=Consumer, 2=Industrial, 3=Mil-Spec, 4=Restricted, 5=Classified, 6=Covert) */
  rarity?: number;
  /** Collection id used for trade-up outcome pool (if known) */
  collection_id?: string;
  /** Collection display name used for trade-up outcome pool (if known) */
  collection_name?: string;
  /** Item-specific min float boundary used for trade-up float normalization */
  min_float?: number;
  /** Item-specific max float boundary used for trade-up float normalization */
  max_float?: number;
  /** Item quality/type name (e.g. "Classified", "StatTrak") */
  quality_name?: string;
  /** Numeric quality (0=Normal, 9=StatTrak, 12=Souvenir) */
  quality?: number;
  /** Weapon type (e.g. "Rifle", "Pistol", "Knife") */
  weapon_type?: string;
  /** Is this a storage unit? */
  is_storage_unit?: boolean;
  /** Is this item marketable on the Steam Community Market? */
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

// ---- Pricing (Phase 4) ----

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

// ---- Multi-account (Phase 5) ----

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

// ---- Market Listings (Phase 6 — Market Management) ----

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

// ---- In-Game Store (Phase 6 — Store Purchases) ----


// ---- Trading (Phase 7 — Friend Trading) ----

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
  /** Optional trade token (for non-friends) */
  tradeToken?: string;
  message?: string;
  myAssetIds: string[];     // assetid strings from our inventory
  theirAssetIds: string[];  // assetid strings from their inventory
}

export type TradeActionState = 'idle' | 'loading' | 'sending' | 'error';

export interface TradeProgress {
  state: TradeActionState;
  message?: string;
}

// ---- Investments (Portfolio Tracker) ----

export interface InvestmentEntry {
  id: string;                // Unique entry ID (uuid)
  marketHashName: string;    // Steam market hash name
  displayName: string;       // Human-readable item name
  imageUrl?: string;         // Item image URL
  rarityColor?: string;      // Rarity color hex
  quantity: number;          // Number of items purchased
  purchasePrice: number;     // Price per item at purchase (in the currency specified below)
  purchaseDate: string;      // ISO date string (YYYY-MM-DD)
  currency?: 'USD' | 'EUR';  // New writes are EUR; missing/legacy entries are interpreted as USD
  notes?: string;            // Optional user notes
  createdAt: number;         // Unix timestamp ms when entry was created
}

export interface InvestmentSummary {
  entry: InvestmentEntry;
  currentPrice: number;      // Current market price per item (in EUR)
  totalCost: number;         // quantity * purchasePrice (converted to EUR when needed)
  currentValue: number;      // quantity * currentPrice
  profit: number;            // currentValue - totalCost
  profitPercent: number;     // (profit / totalCost) * 100
  /** Original purchase price before any conversion (always in entry.currency) */
  originalTotalCost: number;
  /** Whether the totalCost was converted from a different currency */
  wasConverted: boolean;
}

export interface InvestmentPortfolio {
  entries: InvestmentEntry[];
  totalInvested: number;
  totalCurrentValue: number;
  totalProfit: number;
  totalProfitPercent: number;
}

// ---- Exchange Rates ----

export interface ExchangeRates {
  base: string;             // e.g. 'USD' for legacy USD->EUR conversion support
  rates: Record<string, number>;  // e.g. { EUR: 0.85, ... }
  lastFetched: number;      // Unix timestamp ms
}

// ---- Trade-Up Contract (Phase 8) ----

export interface TradeupResult {
  success: boolean;
  /** IDs of items received from the trade-up */
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

// ---- Armory Redemption (Phase 9) ----

export interface ArmoryItem {
  /** Unique item ID from the personal store SO cache */
  itemId: string;
  /** Name of the item (resolved from item data if possible) */
  name: string;
  /** Cost in stars */
  cost: number;
  /** Optional image URL for the item */
  imageUrl?: string;
  /** Category tag for grouping (e.g. 'limited', 'charms', 'collection', 'case', 'sticker') */
  category?: string;
}

export interface ArmoryData {
  /** Current redeemable star balance */
  stars: number;
  /** Timestamp of when the personal store was generated */
  generationTime: number;
  /** Items available in the personal store */
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

// ---- Full-load phases (Phase 6) ----

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

  // Inventory (Phase 2)
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

  // Pricing (Phase 4)
  PRICING_FETCH: 'pricing:fetch',
  PRICING_CANCEL: 'pricing:cancel',
  PRICING_PROGRESS: 'pricing:progress',
  PRICING_GET: 'pricing:get',

  // Multi-account (Phase 5)
  ACCOUNTS_SWITCH: 'accounts:switch',
  ACCOUNTS_MULTI_SUMMARY: 'accounts:multi-summary',
  ACCOUNTS_SAVE_SNAPSHOT: 'accounts:save-snapshot',

  // Settings / Currency (Phase 6)
  SETTINGS_GET_CURRENCY: 'settings:get-currency',
  SETTINGS_SET_CURRENCY: 'settings:set-currency',
  SETTINGS_CURRENCY_CHANGED: 'settings:currency-changed',

  // Full-load (Phase 6)
  FULL_LOAD: 'full-load',
  FULL_LOAD_PROGRESS: 'full-load:progress',

  // Market Listings (Phase 6 — Market Management)
  MARKET_LIST_ITEM: 'market:list-item',
  MARKET_LIST_MULTIPLE: 'market:list-multiple',
  MARKET_DELIST: 'market:delist',
  MARKET_DELIST_ALL: 'market:delist-all',
  MARKET_GET_LISTINGS: 'market:get-listings',
  MARKET_PROGRESS: 'market:progress',
  MARKET_LISTINGS_UPDATED: 'market:listings-updated',

  // In-Game Store (Phase 6 — Store Purchases)
  STORE_GET_ITEMS: 'store:get-items',
  STORE_PURCHASE: 'store:purchase',
  STORE_GET_WALLET: 'store:get-wallet',
  STORE_PROGRESS: 'store:progress',
  STORE_WALLET_UPDATED: 'store:wallet-updated',

  // Trading (Phase 7 — Friend Trading)
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

  // Trade-Up Contract (Phase 8)
  TRADEUP_EXECUTE: 'tradeup:execute',
  TRADEUP_PREDICT: 'tradeup:predict',
  TRADEUP_PROGRESS: 'tradeup:progress',

  // Armory Redemption (Phase 9)
  ARMORY_GET_DATA: 'armory:get-data',
  ARMORY_REDEEM: 'armory:redeem',
  ARMORY_PROGRESS: 'armory:progress',

  // Price Server (Phase 11)
  PRICE_SERVER_GET: 'priceserver:get',
  PRICE_SERVER_SET: 'priceserver:set',
  PRICE_SERVER_TEST: 'priceserver:test',
} as const;
