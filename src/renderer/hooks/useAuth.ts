// ============================================================
// CSInventoryPorter — React hook for Steam auth state
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import type { ConnectionStatus, SteamGuardRequest, QRLoginStatus } from '../../shared/types';

const api = () => window.csinventoryporter;

export interface AuthState {
  status: ConnectionStatus;
  steamGuardRequest: SteamGuardRequest | null;
  qrStatus: QRLoginStatus | null;
  error: string | null;
}

/**
 * Hook for auth.
 *
 * Characteristics:
 * - @returns { status: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").ConnectionStatus; steamGuardRequest: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").SteamGuardRequest; qrStatus: import("C:/Users/Rafael/Desktop/CSInventoryPorter/src/shared/types").QRLoginStatus; error: string; login: (details: any) => Promise<{ success: boolean; error?: string; }>; loginSavedAccount: (steamID: string) => Promise<{ success: boolean; error?: string; }>; submitSteamGuardCode: (code: string) => void; logout: () => Promise<{ success: boolean; }>; startQRLogin: () => Promise<{ success: boolean; challengeUrl?: string; error?: string; }>; cancelQRLogin: () => void; }
 *
 */
export function useAuth() {
  const [status, setStatus] = useState<ConnectionStatus>({ state: 'disconnected' });
  const [steamGuardRequest, setSteamGuardRequest] = useState<SteamGuardRequest | null>(null);
  const [qrStatus, setQRStatus] = useState<QRLoginStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Listen for status changes from main process
  useEffect(() => {
    const unsubStatus = api().onStatusChanged((newStatus: ConnectionStatus) => {
      setStatus(newStatus);
      if (newStatus.error) {
        setError(newStatus.error);
      }
      // Clear steam guard when we move past it
      if (newStatus.state !== 'waitingSteamGuard') {
        setSteamGuardRequest(null);
      }
      // Clear QR status when connected
      if (newStatus.state === 'loggedIn' || newStatus.state === 'gcConnecting' || newStatus.state === 'gcConnected') {
        setQRStatus(null);
      }
    });

    const unsubGuard = api().onSteamGuard((request: SteamGuardRequest) => {
      setSteamGuardRequest(request);
      setError(null);
    });

    const unsubQR = api().onQRUpdate((qr: QRLoginStatus) => {
      setQRStatus(qr);
      if (qr.error) {
        setError(qr.error);
      }
    });

    // Get initial status
    api().getStatus().then(setStatus);

    return () => {
      unsubStatus();
      unsubGuard();
      unsubQR();
    };
  }, []);

  const login = useCallback(async (details: any) => {
    setError(null);
    const result = await api().login(details);
    if (!result.success && result.error) {
      setError(result.error);
    }
    return result;
  }, []);

  const loginSavedAccount = useCallback(async (steamID: string) => {
    setError(null);
    const result = await api().loginSavedAccount(steamID);
    if (!result.success && result.error) {
      setError(result.error);
    }
    return result;
  }, []);

  const submitSteamGuardCode = useCallback((code: string) => {
    api().submitSteamGuardCode(code);
    setSteamGuardRequest(null);
  }, []);

  const logout = useCallback(async () => {
    setError(null);
    return api().logout();
  }, []);

  const startQRLogin = useCallback(async () => {
    setError(null);
    setQRStatus({ state: 'generating' });
    const result = await api().startQRLogin();
    if (!result.success && result.error) {
      setError(result.error);
      setQRStatus(null);
    }
    return result;
  }, []);

  const cancelQRLogin = useCallback(() => {
    api().cancelQRLogin();
    setQRStatus(null);
  }, []);

  return {
    status,
    steamGuardRequest,
    qrStatus,
    error,
    login,
    loginSavedAccount,
    submitSteamGuardCode,
    logout,
    startQRLogin,
    cancelQRLogin,
  };
}
