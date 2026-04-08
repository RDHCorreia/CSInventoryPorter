// ============================================================
// CSInventoryPorter — Login Page
// Supports credentials, refresh token, browser token, QR code,
// and saved accounts
// ============================================================

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useAccounts } from '../hooks/useAccounts';
import type { useAuth } from '../hooks/useAuth';

type LoginTab = 'credentials' | 'refreshToken' | 'browser' | 'qrCode' | 'saved';

interface Props {
  auth: ReturnType<typeof useAuth>;
  onBack?: () => void;
}

/**
 * Login page.
 *
 * Characteristics:
 * - @param { auth, onBack } - The parameter for { auth, onBack }
 * - @returns React.JSX.Element
 *
 */
export default function LoginPage({ auth, onBack }: Props) {
  const { status, steamGuardRequest, qrStatus, error, login, loginSavedAccount, submitSteamGuardCode, startQRLogin, cancelQRLogin } = auth;
  const { accounts, removeAccount, refresh: refreshAccounts } = useAccounts();
  const [tab, setTab] = useState<LoginTab>(accounts.length > 0 ? 'saved' : 'credentials');

  // Credential login state
  const [accountName, setAccountName] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [sharedSecret, setSharedSecret] = useState('');

  // Refresh token login state
  const [refreshToken, setRefreshToken] = useState('');

  // Browser token login state
  const [webLogonToken, setWebLogonToken] = useState('');
  const [browserSteamID, setBrowserSteamID] = useState('');

  // Steam Guard dialog state
  const [guardCode, setGuardCode] = useState('');

  const isLoading = status.state === 'connecting' || status.state === 'gcConnecting';

  // --- Handlers ---

  const handleCredentialLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    await login({
      accountName,
      password,
      twoFactorCode: twoFactorCode || undefined,
      sharedSecret: sharedSecret || undefined,
    });
  };

  const handleRefreshTokenLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    await login({ refreshToken });
  };

  const handleBrowserLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    await login({ webLogonToken, steamID: browserSteamID });
  };

  const handleSavedAccountLogin = async (steamID: string) => {
    await loginSavedAccount(steamID);
    refreshAccounts();
  };

  const handleSubmitGuardCode = (e: React.FormEvent) => {
    e.preventDefault();
    submitSteamGuardCode(guardCode);
    setGuardCode('');
  };

  // --- Steam Guard overlay ---
  if (steamGuardRequest) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="bg-slate-800 rounded-xl shadow-2xl p-8 w-full max-w-md border border-slate-700">
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold">Steam Guard</h2>
            <p className="text-slate-400 mt-1 text-sm">
              {steamGuardRequest.domain
                ? `Enter the code sent to your email (…@${steamGuardRequest.domain})`
                : 'Enter the code from your Steam authenticator app'}
            </p>
            {steamGuardRequest.lastCodeWrong && (
              <p className="text-red-400 text-sm mt-2">
                The previous code was incorrect. Wait for a new code.
              </p>
            )}
          </div>
          <form onSubmit={handleSubmitGuardCode} className="space-y-4">
            <input
              type="text"
              maxLength={5}
              value={guardCode}
              onChange={(e) => setGuardCode(e.target.value.toUpperCase())}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-center text-2xl tracking-[0.5em] font-mono placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="•••••"
              autoFocus
            />
            <button
              type="submit"
              disabled={guardCode.length < 5}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-3 transition-colors"
            >
              Submit Code
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- Tab buttons ---
  const tabs: { key: LoginTab; label: string }[] = [
    { key: 'credentials', label: 'Password' },
    { key: 'refreshToken', label: 'Token' },
    { key: 'browser', label: 'Browser' },
    { key: 'qrCode', label: 'QR Code' },
    ...(accounts.length > 0 ? [{ key: 'saved' as LoginTab, label: `Saved (${accounts.length})` }] : []),
  ];

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg border border-slate-700">
        {/* Header */}
        <div className="pt-8 pb-4 px-8">
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors mb-4"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Home
            </button>
          )}
          <div className="text-center">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              CSInventoryPorter
            </h1>
            <p className="text-slate-400 mt-1 text-sm">
              CS2 Storage Unit Manager
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700 px-8">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${
                tab === t.key
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Form content */}
        <div className="p-8">
          {/* Error banner */}
          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="mb-4 bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-3 text-blue-400 text-sm flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {status.state === 'connecting' && 'Connecting to Steam...'}
              {status.state === 'gcConnecting' && 'Connecting to CS2 Game Coordinator...'}
            </div>
          )}

          {/* === Credentials tab === */}
          {tab === 'credentials' && (
            <form onSubmit={handleCredentialLogin} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Account Name</label>
                <input
                  type="text"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Your Steam account name"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Your Steam password"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  2FA Code <span className="text-slate-500">(optional)</span>
                </label>
                <input
                  type="text"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="XXXXX"
                  maxLength={5}
                />
              </div>
              <details className="text-sm">
                <summary className="text-slate-500 cursor-pointer hover:text-slate-300">
                  Advanced: Shared Secret
                </summary>
                <div className="mt-2">
                  <label className="block text-sm text-slate-400 mb-1">Shared Secret</label>
                  <input
                    type="password"
                    value={sharedSecret}
                    onChange={(e) => setSharedSecret(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Auto-generates 2FA codes"
                  />
                </div>
              </details>
              <button
                type="submit"
                disabled={isLoading || !accountName || !password}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-3 transition-colors"
              >
                {isLoading ? 'Connecting…' : 'Login'}
              </button>
            </form>
          )}

          {/* === Refresh Token tab === */}
          {tab === 'refreshToken' && (
            <form onSubmit={handleRefreshTokenLogin} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Refresh Token</label>
                <textarea
                  value={refreshToken}
                  onChange={(e) => setRefreshToken(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs h-28 resize-none"
                  placeholder="Paste your Steam refresh token (JWT)..."
                  required
                />
              </div>
              <p className="text-xs text-slate-500">
                A refresh token is saved automatically after login with password.
                Valid for ~200 days.
              </p>
              <button
                type="submit"
                disabled={isLoading || !refreshToken.trim()}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-3 transition-colors"
              >
                {isLoading ? 'Connecting…' : 'Login with Token'}
              </button>
            </form>
          )}

          {/* === Browser Token tab === */}
          {tab === 'browser' && (
            <form onSubmit={handleBrowserLogin} className="space-y-4">
              <div className="bg-slate-700/50 rounded-lg p-4 text-sm text-slate-300">
                <p className="mb-2">
                  <strong>Safest method.</strong> Open this URL while logged into Steam:
                </p>
                <code className="block bg-slate-900 rounded px-3 py-2 text-xs text-cyan-400 break-all select-all">
                  https://steamcommunity.com/chat/clientjstoken
                </code>
                <p className="mt-2 text-slate-400 text-xs">
                  Copy the token and your SteamID from the response.
                </p>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Web Logon Token</label>
                <input
                  type="text"
                  value={webLogonToken}
                  onChange={(e) => setWebLogonToken(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                  placeholder="Token from the JSON response"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Steam ID (64-bit)</label>
                <input
                  type="text"
                  value={browserSteamID}
                  onChange={(e) => setBrowserSteamID(e.target.value)}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                  placeholder="76561198..."
                  required
                />
              </div>
              <button
                type="submit"
                disabled={isLoading || !webLogonToken.trim() || !browserSteamID.trim()}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-3 transition-colors"
              >
                {isLoading ? 'Connecting…' : 'Login via Browser'}
              </button>
            </form>
          )}

          {/* === Saved Accounts tab === */}
          {tab === 'saved' && (
            <div className="space-y-3">
              {accounts.length === 0 ? (
                <p className="text-center text-slate-500 py-6">
                  No saved accounts. Log in first to save one.
                </p>
              ) : (
                accounts.map((acc) => (
                  <div
                    key={acc.steamID}
                    className="flex items-center gap-3 bg-slate-700/50 hover:bg-slate-700 rounded-lg p-3 transition-colors group"
                  >
                    {/* Avatar placeholder */}
                    <div className="w-10 h-10 rounded-full bg-slate-600 flex items-center justify-center text-sm font-bold text-slate-300 uppercase shrink-0">
                      {acc.personaName?.charAt(0) || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{acc.personaName}</p>
                      <p className="text-xs text-slate-400 truncate">{acc.accountName}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {acc.refreshToken && (
                        <button
                          onClick={() => handleSavedAccountLogin(acc.steamID)}
                          disabled={isLoading}
                          className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
                        >
                          Login
                        </button>
                      )}
                      <button
                        onClick={() => removeAccount(acc.steamID)}
                        className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all p-1"
                        title="Remove account"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* === QR Code tab === */}
          {tab === 'qrCode' && (
            <div className="space-y-4">
              {/* Not started yet */}
              {!qrStatus && (
                <div className="text-center py-4">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                  </div>
                  <p className="text-slate-300 mb-2">Scan with your Steam Mobile App</p>
                  <p className="text-slate-500 text-sm mb-6">
                    Open the Steam app on your phone, tap the shield icon, and select "Scan QR code".
                  </p>
                  <button
                    onClick={() => startQRLogin()}
                    disabled={isLoading}
                    className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-6 py-3 transition-colors"
                  >
                    Generate QR Code
                  </button>
                </div>
              )}

              {/* Generating */}
              {qrStatus?.state === 'generating' && (
                <div className="text-center py-8">
                  <svg className="animate-spin h-8 w-8 mx-auto text-blue-400 mb-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <p className="text-slate-400">Generating QR code...</p>
                </div>
              )}

              {/* QR Ready */}
              {qrStatus?.state === 'ready' && qrStatus.challengeUrl && (
                <div className="text-center">
                  <div className="bg-white rounded-xl p-4 inline-block mb-4">
                    <QRCodeSVG
                      value={qrStatus.challengeUrl}
                      size={200}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#0f172a"
                    />
                  </div>
                  <p className="text-slate-300 text-sm mb-1">Scan this code with your Steam Mobile App</p>
                  <p className="text-slate-500 text-xs mb-4">
                    Steam App → Shield icon → Scan QR Code
                  </p>
                  <button
                    onClick={() => cancelQRLogin()}
                    className="text-slate-500 hover:text-slate-300 text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Scanned, waiting for confirmation */}
              {qrStatus?.state === 'scanned' && (
                <div className="text-center py-4">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
                    <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="text-green-400 font-medium mb-2">QR Code Scanned!</p>
                  <p className="text-slate-400 text-sm">Please confirm the login on your phone...</p>
                  <svg className="animate-spin h-5 w-5 mx-auto mt-4 text-green-400" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              )}

              {/* Confirmed — logging in */}
              {qrStatus?.state === 'confirmed' && (
                <div className="text-center py-4">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
                    <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-green-400 font-medium mb-2">Login Confirmed!</p>
                  <p className="text-slate-400 text-sm">Connecting to Steam...</p>
                </div>
              )}

              {/* Expired */}
              {qrStatus?.state === 'expired' && (
                <div className="text-center py-4">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-yellow-500/20 flex items-center justify-center">
                    <svg className="w-8 h-8 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-yellow-400 font-medium mb-2">QR Code Expired</p>
                  <p className="text-slate-500 text-sm mb-4">The QR code has timed out.</p>
                  <button
                    onClick={() => startQRLogin()}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg px-6 py-3 transition-colors"
                  >
                    Generate New QR Code
                  </button>
                </div>
              )}

              {/* Error */}
              {qrStatus?.state === 'error' && (
                <div className="text-center py-4">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                    <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </div>
                  <p className="text-red-400 font-medium mb-2">QR Login Failed</p>
                  <p className="text-slate-500 text-sm mb-4">{qrStatus.error || 'An unknown error occurred.'}</p>
                  <button
                    onClick={() => startQRLogin()}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg px-6 py-3 transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center pb-6 px-8">
          <p className="text-xs text-slate-600">
            CSInventoryPorter does not store your password. Refresh tokens are encrypted locally.
          </p>
        </div>
      </div>
    </div>
  );
}
