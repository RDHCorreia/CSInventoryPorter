// ============================================================
// CSInventoryPorter — SteamService
// Wraps steam-user + globaloffensive into a single service
// ============================================================

import { EventEmitter } from 'events';
import SteamUser from 'steam-user';
import GlobalOffensive from 'globaloffensive';
import SteamTotp from 'steam-totp';
import { LoginSession, EAuthTokenPlatformType } from 'steam-session';
import { app } from 'electron';
import path from 'path';
import {
  type LoginDetails,
  type LoginCredentials,
  type LoginRefreshToken,
  type LoginBrowserToken,
  type ConnectionState,
  type ConnectionStatus,
  type AccountInfo,
  type SteamGuardRequest,
  type QRLoginStatus,
} from '../../shared/types';
import { CS2_APP_ID } from '../../shared/constants';

export interface SteamServiceEvents {
  'status-changed': (status: ConnectionStatus) => void;
  'steam-guard': (request: SteamGuardRequest) => void;
  'refresh-token': (accountName: string, token: string) => void;
  'account-info': (info: AccountInfo) => void;
  'gc-connected': () => void;
  'gc-disconnected': (reason: number) => void;
  'qr-update': (status: QRLoginStatus) => void;
  'error': (error: Error) => void;
}

export class SteamService extends EventEmitter {
  private client: SteamUser;
  private csgo: GlobalOffensive;
  private _state: ConnectionState = 'disconnected';
  private _accountInfo: AccountInfo | null = null;
  private _steamGuardCallback: ((code: string) => void) | null = null;
  private _currentAccountName: string | null = null;
  private _qrSession: LoginSession | null = null;
  private _webSessionID: string | null = null;
  private _webCookies: string[] = [];
  /** Pending wallet data if wallet event fires before accountInfo */
  private _pendingWallet: { hasWallet: boolean; currency: number; balance: number } | null = null;

  constructor() {
    super();

    // Create data directory for steam-user cache
    const dataDir = path.join(app.getPath('userData'), 'steam-data');

    this.client = new SteamUser({
      autoRelogin: true,
      enablePicsCache: false, // We don't need PICS for inventory management
      language: 'english',
      dataDirectory: dataDir,
    });

    this.csgo = new GlobalOffensive(this.client);

    // CRITICAL: Patch csgo._send on the instance to replace the hardcoded version 2000244
    // with 2000598 in every ClientHello message.
    //
    // = Why this matters =
    // globaloffensive always sends:  version: 2000244  (hardcoded inside _connect())
    // CS2 GC requires at least:      version: 2000598  (skinledger's connectToGc.js value)
    //
    // With the old version the GC:
    //   • SILENTLY IGNORES armory-redemption requests (k_EMsgGCCStrike15_v2_ClientRedeemMissionReward = 9209)
    //     → 45-second timeout, nothing happens.
    //   • Sends incomplete / wrong data in ClientWelcome (missing/wrong `currency` field)
    //     → _gcWelcomeCurrency stays null or gets the wrong value
    //     → store purchase uses wrong currency → GC rejects with EGCStorePurchaseResultCode 8
    //
    // We cannot simply set GlobalOffensive.CSGO_VER because the version is a literal in
    // the _connect() closure and the library does not read that property.  Patching the
    // _send method on the instance is the correct approach.
    {
      const Language_ = require('globaloffensive/language.js');
      const clientHelloType = (Language_ as any).ClientHello as number;
      const prototypeSend = (GlobalOffensive as any).prototype._send as (
        type: number, protobuf: any, body: any,
      ) => boolean;
      (this.csgo as any)._send = function (type: number, protobuf: any, body: any): boolean {
        if (type === clientHelloType && body && typeof body === 'object') {
          // Clone so the original object (stored in _connect's closure) is not mutated
          body = { ...body, version: 2000598 };
        }
        return prototypeSend.call(this, type, protobuf, body);
      };
    }

    this.setupEventHandlers();
  }

  // ---- Getters ----

  get state(): ConnectionState {
    return this._state;
  }

  get accountInfo(): AccountInfo | null {
    return this._accountInfo;
  }

  get isLoggedIn(): boolean {
    return this._state === 'loggedIn' || this._state === 'gcConnecting' || this._state === 'gcConnected';
  }

  get isGCConnected(): boolean {
    return this._state === 'gcConnected';
  }

  get csgoClient(): GlobalOffensive {
    return this.csgo;
  }

  get steamClient(): SteamUser {
    return this.client;
  }

  /** Session ID from the web session (needed for market API calls) */
  get webSessionID(): string | null {
    return this._webSessionID;
  }

  /** Cookies from the web session (needed for market API calls) */
  get webCookies(): string[] {
    return this._webCookies;
  }

  /** Build a Cookie header string from stored web cookies */
  get cookieHeader(): string {
    return this._webCookies.join('; ');
  }

  // ---- State management ----

  /**
     * Sets state.
     *
     * Characteristics:
     * - @param state - The parameter for state
     * - @param error - The parameter for error
     * - @returns Nothing (void)
     *
     */
    private setState(state: ConnectionState, error?: string): void {
    this._state = state;
    const status: ConnectionStatus = {
      state,
      accountName: this._currentAccountName ?? undefined,
      personaName: this._accountInfo?.personaName ?? undefined,
      steamID: this.client.steamID?.getSteamID64() ?? undefined,
      error,
    };
    this.emit('status-changed', status);
  }

  // ---- Event handlers ----

  /**
     * Setup event handlers.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    private setupEventHandlers(): void {
    // --- Steam User events ---

    this.client.on('loggedOn', (_details: any) => {
      console.log('[SteamService] Logged on to Steam');
      this.setState('loggedIn');

      // Launch CS2 to connect to Game Coordinator
      this.setState('gcConnecting');
      this.client.gamesPlayed([CS2_APP_ID]);
    });

    this.client.on('steamGuard', (domain: string | null, callback: (code: string) => void, lastCodeWrong: boolean) => {
      console.log('[SteamService] Steam Guard code requested', domain ? `(email: ${domain})` : '(app)');
      this._steamGuardCallback = callback;
      this.setState('waitingSteamGuard');
      this.emit('steam-guard', { domain, lastCodeWrong } as SteamGuardRequest);
    });

    this.client.on('refreshToken', (token: string) => {
      console.log('[SteamService] Received refresh token');
      const steamID = this.client.steamID?.getSteamID64();
      // Always emit so AccountManager can persist the new token
      this.emit('refresh-token', this._currentAccountName ?? '', steamID ?? '', token);
    });

    this.client.on('error', (err: Error) => {
      console.error('[SteamService] Steam error:', err.message);
      this.setState('error', err.message);
      this.emit('error', err);
    });

    this.client.on('disconnected', (eresult: number, msg?: string) => {
      console.log('[SteamService] Disconnected:', eresult, msg);
      this.setState('disconnected');
    });

    this.client.on('webSession', (sessionID: string, cookies: string[]) => {
      console.log('[SteamService] Web session established');
      this._webSessionID = sessionID;
      this._webCookies = cookies;
    });

    this.client.on('accountInfo', (name: string, country: string) => {
      this._accountInfo = {
        steamID: this.client.steamID?.getSteamID64() ?? '',
        accountName: this._currentAccountName ?? '',
        personaName: name,
        country,
      };

      // Apply pending wallet data that arrived before accountInfo
      if (this._pendingWallet) {
        this._accountInfo.walletBalance = this._pendingWallet.balance;
        this._accountInfo.walletCurrency = this._pendingWallet.currency;
        this._pendingWallet = null;
      }

      this.emit('account-info', this._accountInfo);
    });

    this.client.on('wallet', (hasWallet: boolean, currency: number, balance: number) => {
      // NOTE: steam-user already divides balance by 100, so balance is in whole currency units (e.g. 4.99)
      // We convert to cents (integer) for consistency with store catalog prices
      const balanceCents = Math.round(balance * 100);
      if (this._accountInfo) {
        this._accountInfo.walletBalance = balanceCents;
        this._accountInfo.walletCurrency = currency;
      } else {
        // accountInfo hasn't arrived yet — hold the wallet data
        this._pendingWallet = { hasWallet, currency, balance: balanceCents };
      }
      // Always emit so listeners can capture wallet changes
      this.emit('wallet', hasWallet, currency, balanceCents);
    });

    this.client.on('vacBans', (numBans: number) => {
      if (this._accountInfo) {
        this._accountInfo.vacBans = numBans;
      }
    });

    this.client.on('accountLimitations', (limited: boolean) => {
      if (this._accountInfo) {
        this._accountInfo.isLimited = limited;
      }
    });

    // --- CS:GO Game Coordinator events ---

    this.csgo.on('connectedToGC', () => {
      console.log('[SteamService] Connected to CS2 Game Coordinator');
      this.setState('gcConnected');
      this.emit('gc-connected');
    });

    this.csgo.on('disconnectedFromGC', (reason: number) => {
      console.log('[SteamService] Disconnected from GC, reason:', reason);
      // Only change state if we're still supposed to be connected
      if (this._state === 'gcConnected') {
        this.setState('gcConnecting');
      }
      this.emit('gc-disconnected', reason);
    });

    this.csgo.on('error', (err: Error) => {
      console.error('[SteamService] GC error:', err.message);
      this.emit('error', err);
    });
  }

  // ---- Login methods ----

  /**
     * Login.
     *
     * Characteristics:
     * - @param details - The parameter for details
     * - @returns Promise<void>
     *
     */
    async login(details: LoginDetails): Promise<void> {
    // If already logged in, logout first to avoid "Already logged on" error
    if (this.isLoggedIn || this._state !== 'disconnected') {
      console.log('[SteamService] Already connected — logging off before new login');
      this.cancelQRLogin();
      this.client.gamesPlayed([]);
      this.client.logOff();
      this._accountInfo = null;
      this._currentAccountName = null;
      this._steamGuardCallback = null;
      // Small delay for steam-user to fully clean up
      await new Promise((r) => setTimeout(r, 300));
    }

    this.setState('connecting');

    // Determine login method
    if ('refreshToken' in details && details.refreshToken) {
      return this.loginWithRefreshToken(details as LoginRefreshToken);
    }

    if ('webLogonToken' in details) {
      return this.loginWithBrowserToken(details as LoginBrowserToken);
    }

    return this.loginWithCredentials(details as LoginCredentials);
  }

  /**
     * Login with credentials.
     *
     * Characteristics:
     * - @param creds - The parameter for creds
     * - @returns Promise<void>
     *
     */
    private async loginWithCredentials(creds: LoginCredentials): Promise<void> {
    this._currentAccountName = creds.accountName;

    const logonDetails: any = {
      accountName: creds.accountName,
      password: creds.password,
    };

    // If shared secret is provided, auto-generate TOTP
    if (creds.sharedSecret) {
      logonDetails.twoFactorCode = SteamTotp.generateAuthCode(creds.sharedSecret);
    } else if (creds.twoFactorCode) {
      logonDetails.twoFactorCode = creds.twoFactorCode;
    }

    this.client.logOn(logonDetails);
  }

  /**
     * Login with refresh token.
     *
     * Characteristics:
     * - @param details - The parameter for details
     * - @returns Promise<void>
     *
     */
    private async loginWithRefreshToken(details: LoginRefreshToken): Promise<void> {
    // Note: _currentAccountName remains null until 'accountInfo' event provides it.
    // The 'accountInfo' handler + AccountManager will save the account from there.
    this.client.logOn({
      refreshToken: details.refreshToken,
    });
  }

  /**
     * Login with browser token.
     *
     * Characteristics:
     * - @param details - The parameter for details
     * - @returns Promise<void>
     *
     */
    private async loginWithBrowserToken(details: LoginBrowserToken): Promise<void> {
    this.client.logOn({
      webLogonToken: details.webLogonToken,
      steamID: details.steamID,
    } as any);
  }

  // ---- Steam Guard ----

  /**
     * Submit steam guard code.
     *
     * Characteristics:
     * - @param code - The parameter for code
     * - @returns Nothing (void)
     *
     */
    submitSteamGuardCode(code: string): void {
    if (this._steamGuardCallback) {
      this._steamGuardCallback(code);
      this._steamGuardCallback = null;
    }
  }

  // ---- QR Code Login ----

  /**
     * Start q r login.
     *
     * Characteristics:
     * - @returns Promise<import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").QRLoginStatus>
     *
     */
    async startQRLogin(): Promise<QRLoginStatus> {
    // Cancel any existing QR session
    this.cancelQRLogin();

    this.emit('qr-update', { state: 'generating' } as QRLoginStatus);

    try {
      const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
      this._qrSession = session;

      const result = await session.startWithQR();

      const status: QRLoginStatus = {
        state: 'ready',
        challengeUrl: result.qrChallengeUrl,
      };
      this.emit('qr-update', status);

      // User scanned the QR code but hasn't confirmed yet
      session.on('remoteInteraction', () => {
        console.log('[SteamService] QR code scanned, waiting for confirmation');
        this.emit('qr-update', { state: 'scanned' } as QRLoginStatus);
      });

      // QR code expired
      session.on('timeout', () => {
        console.log('[SteamService] QR code expired');
        this.emit('qr-update', { state: 'expired' } as QRLoginStatus);
        this._qrSession = null;
      });

      // Error
      session.on('error', (err: Error) => {
        console.error('[SteamService] QR session error:', err.message);
        this.emit('qr-update', { state: 'error', error: err.message } as QRLoginStatus);
        this._qrSession = null;
      });

      // User confirmed on their phone — we have tokens!
      session.on('authenticated', async () => {
        console.log('[SteamService] QR login authenticated');
        this.emit('qr-update', { state: 'confirmed' } as QRLoginStatus);
        this._qrSession = null;

        try {
          const refreshToken = session.refreshToken;
          const accountName = session.accountName;

          // Set the account name for auto-saving
          this._currentAccountName = accountName ?? null;

          // If already logged in, log off first to avoid "Already logged on"
          if (this.isLoggedIn || this._state !== 'disconnected') {
            console.log('[SteamService] Already connected — logging off before QR login');
            this.client.gamesPlayed([]);
            this.client.logOff();
            this._accountInfo = null;
            await new Promise((r) => setTimeout(r, 300));
          }

          // Log in to steam-user with the obtained refresh token
          this.setState('connecting');
          this.client.logOn({ refreshToken });

          // Emit refresh token so it gets saved (steamID not yet available — use empty string;
          // AccountManager will hold this as a pending token until account-info arrives)
          if (accountName && refreshToken) {
            this.emit('refresh-token', accountName, '', refreshToken);
          }
        } catch (err: any) {
          console.error('[SteamService] QR post-auth error:', err.message);
          this.setState('error', err.message);
        }
      });

      return status;
    } catch (err: any) {
      console.error('[SteamService] Failed to start QR login:', err.message);
      const errorStatus: QRLoginStatus = { state: 'error', error: err.message };
      this.emit('qr-update', errorStatus);
      this._qrSession = null;
      return errorStatus;
    }
  }

  /**
     * Cancel q r login.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    cancelQRLogin(): void {
    if (this._qrSession) {
      try {
        this._qrSession.cancelLoginAttempt();
      } catch { /* ignore */ }
      this._qrSession = null;
    }
  }

  // ---- Logout ----

  /**
     * Logout.
     *
     * Characteristics:
     * - @returns Nothing (void)
     *
     */
    logout(): void {
    console.log('[SteamService] Logging off');
    this.cancelQRLogin();
    this.client.gamesPlayed([]); // Stop playing CS2
    this.client.logOff();
    this._state = 'disconnected';
    this._accountInfo = null;
    this._currentAccountName = null;
    this._steamGuardCallback = null;
    this._webSessionID = null;
    this._webCookies = [];
    this.setState('disconnected');
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
    this.logout();
    this.removeAllListeners();
  }
}
