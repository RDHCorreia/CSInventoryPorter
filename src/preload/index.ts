// ============================================================
// CSInventoryPorter — Preload script
// Exposes a safe API to the renderer via contextBridge
// ============================================================

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types';
import type { InventoryItem, TradeupPrediction } from '../shared/types';
import type { CurrencyCode } from '../shared/constants';

export interface CSInventoryPorterAPI {
  // Auth
  login: (details: any) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<{ success: boolean }>;
  submitSteamGuardCode: (code: string) => void;
  getStatus: () => Promise<any>;

  // QR Code Login
  startQRLogin: () => Promise<{ success: boolean; challengeUrl?: string; error?: string }>;
  cancelQRLogin: () => void;

  // Accounts
  listAccounts: () => Promise<any[]>;
  loginSavedAccount: (steamID: string) => Promise<{ success: boolean; error?: string }>;
  removeAccount: (steamID: string) => Promise<{ success: boolean }>;

  // Inventory
  getInventory: () => Promise<any>;
  loadInventory: () => Promise<{ success: boolean; error?: string }>;
  loadCasketContents: (casketId: string) => Promise<{ success: boolean; items?: any[]; error?: string }>;

  // Casket operations (Phase 3)
  executeBulkOperation: (operations: any[], delayMs?: number, itemCount?: number) => Promise<{ success: boolean; error?: string }>;
  cancelBulkOperation: () => void;
  renameCasket: (casketId: string, name: string) => Promise<{ success: boolean; error?: string }>;

  // Pricing (Phase 4)
  fetchPrices: () => Promise<{ success: boolean; error?: string }>;
  cancelPriceFetch: () => void;
  getPortfolioData: () => Promise<any>;

  // Multi-account (Phase 5)
  switchAccount: (steamID: string) => Promise<{ success: boolean; error?: string }>;
  getCombinedPortfolio: () => Promise<any>;
  saveSnapshot: () => void;

  // Currency / Settings (Phase 6)
  getCurrency: () => Promise<string>;
  setCurrency: (currency: CurrencyCode) => Promise<{ success: boolean }>;

  // Full-load (Phase 6)
  fullLoad: () => Promise<{ success: boolean; error?: string }>;

  // Market Listings (Phase 6 — Market Management)
  getMarketListings: () => Promise<{ success: boolean; listings: any[]; error?: string }>;
  listItem: (assetId: string, priceInCents: number) => Promise<{ success: boolean; listingId?: string; error?: string; requiresConfirmation?: boolean }>;
  listMultipleItems: (requests: any[]) => Promise<{ success: boolean; succeeded: number; failed: number; errors: string[] }>;
  delistItem: (listingId: string) => Promise<{ success: boolean; error?: string }>;
  delistAll: () => Promise<{ success: boolean; succeeded: number; failed: number }>;

  // Trading (Friend Trade Offers)
  getMyTradableIds: () => Promise<{ success: boolean; ids: string[]; error?: string }>;
  getFriends: () => Promise<{ success: boolean; friends: any[]; error?: string }>;
  getFriendInventory: (steamID: string) => Promise<{ success: boolean; items: any[]; error?: string }>;
  sendTradeOffer: (request: any) => Promise<{ success: boolean; offerId?: string; status?: string; error?: string }>;
  getTradeOffers: () => Promise<{ success: boolean; sent: any[]; received: any[]; error?: string }>;
  acceptTradeOffer: (offerId: string) => Promise<{ success: boolean; error?: string }>;
  declineTradeOffer: (offerId: string) => Promise<{ success: boolean; error?: string }>;
  cancelTradeOffer: (offerId: string) => Promise<{ success: boolean; error?: string }>;

  // Investments (Portfolio Tracker)
  getInvestments: () => Promise<{ success: boolean; entries: any[]; error?: string }>;
  addInvestment: (entry: any) => Promise<{ success: boolean; entry?: any; error?: string }>;
  updateInvestment: (id: string, updates: any) => Promise<{ success: boolean; entry?: any; error?: string }>;
  removeInvestment: (id: string) => Promise<{ success: boolean; error?: string }>;
  clearInvestments: () => Promise<{ success: boolean; error?: string }>;

  // Exchange Rates
  getExchangeRates: () => Promise<{ success: boolean; rates?: any; error?: string }>;
  convertCurrency: (amount: number, from: 'USD', to: 'EUR') => Promise<{ success: boolean; converted: number; error?: string }>;

  // Trade-Up Contract (Phase 8)
  executeTradeup: (itemIds: string[]) => Promise<{ success: boolean; receivedItemIds?: string[]; error?: string }>;
  predictTradeup: (items: InventoryItem[]) => Promise<TradeupPrediction | null>;

  // Armory Redemption (Phase 9)
  getArmoryData: () => Promise<{ success: boolean; data?: any; error?: string }>;
  redeemArmoryItem: (armoryId: number, count?: number) => Promise<{ success: boolean; error?: string }>;

  // Price Server (Phase 11)
  getPriceServerConfig: () => Promise<any>;
  setPriceServerConfig: (config: any) => Promise<{ success: boolean }>;
  testPriceServer: (config: any) => Promise<{ success: boolean; totalPrices?: number; latencyMs?: number; error?: string }>;

  // Window Controls
  windowControls: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  };

  // Event listeners
  onStatusChanged: (callback: (status: any) => void) => () => void;
  onSteamGuard: (callback: (request: any) => void) => () => void;
  onQRUpdate: (callback: (status: any) => void) => () => void;
  onInventoryUpdated: (callback: (data: any) => void) => () => void;
  onCasketContentsLoaded: (callback: (casketId: string, items: any[]) => void) => () => void;
  onOperationProgress: (callback: (progress: any) => void) => () => void;
  onPricingProgress: (callback: (progress: any) => void) => () => void;
  onFullLoadProgress: (callback: (progress: any) => void) => () => void;
  onMarketProgress: (callback: (progress: any) => void) => () => void;
  onMarketListingsUpdated: (callback: (listings: any[]) => void) => () => void;
  onTradeProgress: (callback: (progress: any) => void) => () => void;
  onNewTradeOffer: (callback: (offer: any) => void) => () => void;
  onTradeOfferChanged: (callback: (offer: any) => void) => () => void;
  onCurrencyChanged: (callback: (currency: string) => void) => () => void;
  onTradeupProgress: (callback: (progress: any) => void) => () => void;
  onArmoryProgress: (callback: (progress: any) => void) => () => void;
}

const api: CSInventoryPorterAPI = {
  // ---- Auth ----
  login: (details) => ipcRenderer.invoke(IPC.AUTH_LOGIN, details),
  logout: () => ipcRenderer.invoke(IPC.AUTH_LOGOUT),
  submitSteamGuardCode: (code) => ipcRenderer.send(IPC.AUTH_SUBMIT_STEAM_GUARD, code),
  getStatus: () => ipcRenderer.invoke(IPC.AUTH_STATUS),

  // ---- Accounts ----
  listAccounts: () => ipcRenderer.invoke(IPC.ACCOUNTS_LIST),
  loginSavedAccount: (steamID) => ipcRenderer.invoke(IPC.ACCOUNTS_GET, steamID),
  removeAccount: (steamID) => ipcRenderer.invoke(IPC.ACCOUNTS_REMOVE, steamID),

  // ---- QR Code Login ----
  startQRLogin: () => ipcRenderer.invoke(IPC.AUTH_QR_START),
  cancelQRLogin: () => ipcRenderer.send(IPC.AUTH_QR_CANCEL),

  // ---- Inventory ----
  getInventory: () => ipcRenderer.invoke(IPC.INVENTORY_GET),
  loadInventory: () => ipcRenderer.invoke(IPC.INVENTORY_LOAD),
  loadCasketContents: (casketId) => ipcRenderer.invoke(IPC.CASKET_CONTENTS, casketId),

  // ---- Casket operations (Phase 3) ----
  executeBulkOperation: (operations, delayMs?, itemCount?) => ipcRenderer.invoke(IPC.CASKET_ADD, operations, delayMs, itemCount),
  cancelBulkOperation: () => ipcRenderer.send(IPC.CASKET_REMOVE),
  renameCasket: (casketId, name) => ipcRenderer.invoke(IPC.CASKET_RENAME, casketId, name),

  // ---- Pricing (Phase 4) ----
  fetchPrices: () => ipcRenderer.invoke(IPC.PRICING_FETCH),
  cancelPriceFetch: () => ipcRenderer.send(IPC.PRICING_CANCEL),
  getPortfolioData: () => ipcRenderer.invoke(IPC.PRICING_GET),

  // ---- Multi-account (Phase 5) ----
  switchAccount: (steamID) => ipcRenderer.invoke(IPC.ACCOUNTS_SWITCH, steamID),
  getCombinedPortfolio: () => ipcRenderer.invoke(IPC.ACCOUNTS_MULTI_SUMMARY),
  saveSnapshot: () => ipcRenderer.send(IPC.ACCOUNTS_SAVE_SNAPSHOT),

  // ---- Currency / Settings (Phase 6) ----
  getCurrency: () => ipcRenderer.invoke(IPC.SETTINGS_GET_CURRENCY),
  setCurrency: (currency) => ipcRenderer.invoke(IPC.SETTINGS_SET_CURRENCY, currency),

  // ---- Full-load (Phase 6) ----
  fullLoad: () => ipcRenderer.invoke(IPC.FULL_LOAD),

  // ---- Market Listings (Phase 6 — Market Management) ----
  getMarketListings: () => ipcRenderer.invoke(IPC.MARKET_GET_LISTINGS),
  listItem: (assetId, priceInCents) => ipcRenderer.invoke(IPC.MARKET_LIST_ITEM, assetId, priceInCents),
  listMultipleItems: (requests) => ipcRenderer.invoke(IPC.MARKET_LIST_MULTIPLE, requests),
  delistItem: (listingId) => ipcRenderer.invoke(IPC.MARKET_DELIST, listingId),
  delistAll: () => ipcRenderer.invoke(IPC.MARKET_DELIST_ALL),

  // ---- Trading (Friend Trade Offers) ----
  getMyTradableIds: () => ipcRenderer.invoke(IPC.TRADE_GET_MY_TRADABLE_IDS),
  getFriends: () => ipcRenderer.invoke(IPC.TRADE_GET_FRIENDS),
  getFriendInventory: (steamID) => ipcRenderer.invoke(IPC.TRADE_GET_FRIEND_INVENTORY, steamID),
  sendTradeOffer: (request) => ipcRenderer.invoke(IPC.TRADE_SEND_OFFER, request),
  getTradeOffers: () => ipcRenderer.invoke(IPC.TRADE_GET_OFFERS),
  acceptTradeOffer: (offerId) => ipcRenderer.invoke(IPC.TRADE_ACCEPT, offerId),
  declineTradeOffer: (offerId) => ipcRenderer.invoke(IPC.TRADE_DECLINE, offerId),
  cancelTradeOffer: (offerId) => ipcRenderer.invoke(IPC.TRADE_CANCEL, offerId),

  // ---- Investments (Portfolio Tracker) ----
  getInvestments: () => ipcRenderer.invoke(IPC.INVESTMENTS_GET),
  addInvestment: (entry) => ipcRenderer.invoke(IPC.INVESTMENTS_ADD, entry),
  updateInvestment: (id, updates) => ipcRenderer.invoke(IPC.INVESTMENTS_UPDATE, id, updates),
  removeInvestment: (id) => ipcRenderer.invoke(IPC.INVESTMENTS_REMOVE, id),
  clearInvestments: () => ipcRenderer.invoke(IPC.INVESTMENTS_CLEAR),

  // ---- Exchange Rates ----
  getExchangeRates: () => ipcRenderer.invoke(IPC.EXCHANGE_RATES_GET),
  convertCurrency: (amount, from, to) => ipcRenderer.invoke(IPC.EXCHANGE_RATES_CONVERT, amount, from, to),

  // ---- Trade-Up Contract (Phase 8) ----
  executeTradeup: (itemIds) => ipcRenderer.invoke(IPC.TRADEUP_EXECUTE, itemIds),
  predictTradeup: (items) => ipcRenderer.invoke(IPC.TRADEUP_PREDICT, items),

  // ---- Armory Redemption (Phase 9) ----
  getArmoryData: () => ipcRenderer.invoke(IPC.ARMORY_GET_DATA),
  redeemArmoryItem: (armoryId, count) => ipcRenderer.invoke(IPC.ARMORY_REDEEM, armoryId, count),

  // ---- Price Server (Phase 11) ----
  getPriceServerConfig: () => ipcRenderer.invoke(IPC.PRICE_SERVER_GET),
  setPriceServerConfig: (config) => ipcRenderer.invoke(IPC.PRICE_SERVER_SET, config),
  testPriceServer: (config) => ipcRenderer.invoke(IPC.PRICE_SERVER_TEST, config),

  // ---- Window Controls ----
  windowControls: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },

  // ---- Event listeners (returns unsubscribe function) ----
  onStatusChanged: (callback) => {
    const handler = (_event: any, status: any) => callback(status);
    ipcRenderer.on(IPC.AUTH_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.AUTH_STATUS_CHANGED, handler);
  },

  onSteamGuard: (callback) => {
    const handler = (_event: any, request: any) => callback(request);
    ipcRenderer.on(IPC.AUTH_STEAM_GUARD, handler);
    return () => ipcRenderer.removeListener(IPC.AUTH_STEAM_GUARD, handler);
  },

  onQRUpdate: (callback) => {
    const handler = (_event: any, status: any) => callback(status);
    ipcRenderer.on(IPC.AUTH_QR_UPDATE, handler);
    return () => ipcRenderer.removeListener(IPC.AUTH_QR_UPDATE, handler);
  },

  onInventoryUpdated: (callback) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(IPC.INVENTORY_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPC.INVENTORY_UPDATED, handler);
  },

  onCasketContentsLoaded: (callback) => {
    const handler = (_event: any, casketId: string, items: any[]) => callback(casketId, items);
    ipcRenderer.on(IPC.CASKET_CONTENTS_LOADED, handler);
    return () => ipcRenderer.removeListener(IPC.CASKET_CONTENTS_LOADED, handler);
  },

  onOperationProgress: (callback) => {
    const handler = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on(IPC.CASKET_OPERATION_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.CASKET_OPERATION_PROGRESS, handler);
  },

  onPricingProgress: (callback) => {
    const handler = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on(IPC.PRICING_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.PRICING_PROGRESS, handler);
  },

  onFullLoadProgress: (callback) => {
    const handler = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on(IPC.FULL_LOAD_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.FULL_LOAD_PROGRESS, handler);
  },

  onMarketProgress: (callback) => {
    const handler = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on(IPC.MARKET_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.MARKET_PROGRESS, handler);
  },

  onMarketListingsUpdated: (callback) => {
    const handler = (_event: any, listings: any[]) => callback(listings);
    ipcRenderer.on(IPC.MARKET_LISTINGS_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPC.MARKET_LISTINGS_UPDATED, handler);
  },

  onTradeProgress: (callback) => {
    const handler = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on(IPC.TRADE_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.TRADE_PROGRESS, handler);
  },

  onNewTradeOffer: (callback) => {
    const handler = (_event: any, offer: any) => callback(offer);
    ipcRenderer.on(IPC.TRADE_NEW_OFFER, handler);
    return () => ipcRenderer.removeListener(IPC.TRADE_NEW_OFFER, handler);
  },

  onTradeOfferChanged: (callback) => {
    const handler = (_event: any, offer: any) => callback(offer);
    ipcRenderer.on(IPC.TRADE_OFFER_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.TRADE_OFFER_CHANGED, handler);
  },

  onCurrencyChanged: (callback) => {
    const handler = (_event: any, currency: string) => callback(currency);
    ipcRenderer.on(IPC.SETTINGS_CURRENCY_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.SETTINGS_CURRENCY_CHANGED, handler);
  },

  onTradeupProgress: (callback) => {
    const handler = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on(IPC.TRADEUP_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.TRADEUP_PROGRESS, handler);
  },

  onArmoryProgress: (callback) => {
    const handler = (_event: any, progress: any) => callback(progress);
    ipcRenderer.on(IPC.ARMORY_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.ARMORY_PROGRESS, handler);
  },
};

contextBridge.exposeInMainWorld('csinventoryporter', api);
