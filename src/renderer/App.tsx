// ============================================================
// CSInventoryPorter — Root App component
// ============================================================

import { useState, useEffect, useRef, useCallback, createContext } from 'react';
import { useAuth } from './hooks/useAuth';
import { useCurrency } from './hooks/useCurrency';
import { useTheme } from './hooks/useTheme';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import PortfolioPage from './pages/PortfolioPage';
import HomePage from './pages/HomePage';
import LoadingPage from './pages/LoadingPage';
import MarketPage from './pages/MarketPage';
import TradePage from './pages/TradePage';
import InvestmentsPage from './pages/InvestmentsPage';
import TradeupPage from './pages/TradeupPage';
import ArmoryPage from './pages/ArmoryPage';
import SettingsPage from './pages/SettingsPage';
import CustomizationPanel from './components/CustomizationPanel';
import type { CurrencyCode } from '../shared/constants';
import type { AppPage } from './utils/itemUtils';

// Currency context so all pages can access format helpers
export const CurrencyContext = createContext<{
  currency: CurrencyCode;
  setCurrency: (code: CurrencyCode) => Promise<void>;
  symbol: string;
  formatPrice: (value: number) => string;
  formatPriceShort: (value: number) => string;
  currencyVersion: number;
}>({
  currency: 'EUR',
  setCurrency: async () => {},
  symbol: '€',
  formatPrice: (v) => `€${v.toFixed(2)}`,
  formatPriceShort: (v) => `€${v.toFixed(0)}`,
  currencyVersion: 0,
});

// Customization panel context — lets NavBar toggle the drawer without prop drilling
export const CustomizationContext = createContext<{
  openPanel: () => void;
}>({
  openPanel: () => {},
});

/**
 * App.
 *
 * Characteristics:
 * - @returns React.JSX.Element
 *
 */
export default function App() {
  const auth = useAuth();
  const currencyState = useCurrency();
  useTheme(); // Applies theme CSS variables to :root on mount
  const [activePage, setActivePage] = useState<AppPage>('home');
  const [customPanelOpen, setCustomPanelOpen] = useState(false);
  const prevConnected = useRef(false);
  const prevGC = useRef(false);

  const openCustomPanel = useCallback(() => setCustomPanelOpen(true), []);
  const closeCustomPanel = useCallback(() => setCustomPanelOpen(false), []);

  const isConnected =
    auth.status.state === 'loggedIn' ||
    auth.status.state === 'gcConnecting' ||
    auth.status.state === 'gcConnected';

  const isGCReady = auth.status.state === 'gcConnected';

  // When GC JUST became connected → navigate to loading screen
  useEffect(() => {
    if (isGCReady && !prevGC.current) {
      setActivePage('loading');
    }
    prevGC.current = isGCReady;
  }, [isGCReady]);

  // Auto-navigate: login page → home only when a NEW connection completes
  // (loading screen handles the rest now)
  useEffect(() => {
    if (isConnected && !prevConnected.current && activePage === 'login') {
      // Don't navigate to home directly; the GC effect above will handle it
    }
    prevConnected.current = isConnected;
  }, [isConnected, activePage]);

  // Auto-navigate: portfolio/inventory/market → home when disconnected
  useEffect(() => {
    if (!isConnected && (activePage === 'portfolio' || activePage === 'inventory' || activePage === 'market' || activePage === 'trade' || activePage === 'investments' || activePage === 'tradeup' || activePage === 'armory' || activePage === 'loading')) {
      setActivePage('home');
    }
  }, [isConnected, activePage]);

  const handleLoadingComplete = () => {
    setActivePage('home');
  };

  return (
    <CurrencyContext.Provider value={currencyState}>
      <CustomizationContext.Provider value={{ openPanel: openCustomPanel }}>
        <div className="h-screen flex flex-col text-slate-100" style={{ backgroundColor: 'var(--sp-bg)' }}>
          {activePage === 'loading' ? (
            <LoadingPage onComplete={handleLoadingComplete} />
          ) : activePage === 'login' ? (
            <LoginPage auth={auth} onBack={() => setActivePage('home')} />
          ) : activePage === 'settings' ? (
            <SettingsPage auth={auth} onNavigate={setActivePage} />
          ) : activePage === 'home' ? (
            <HomePage auth={auth} onNavigate={setActivePage} />
          ) : isConnected && activePage === 'portfolio' ? (
            <PortfolioPage auth={auth} onNavigate={setActivePage} />
          ) : isConnected && activePage === 'inventory' ? (
            <DashboardPage auth={auth} onNavigate={setActivePage} />
          ) : isConnected && activePage === 'market' ? (
            <MarketPage auth={auth} onNavigate={setActivePage} />
        ) : isConnected && activePage === 'trade' ? (
          <TradePage auth={auth} onNavigate={setActivePage} />
        ) : isConnected && activePage === 'investments' ? (
          <InvestmentsPage auth={auth} onNavigate={setActivePage} />
        ) : isConnected && activePage === 'tradeup' ? (
          <TradeupPage auth={auth} onNavigate={setActivePage} />
        ) : isConnected && activePage === 'armory' ? (
          <ArmoryPage auth={auth} onNavigate={setActivePage} />
        ) : (
          <HomePage auth={auth} onNavigate={setActivePage} />
        )}

          {/* Global customization drawer – rendered above all pages */}
          <CustomizationPanel open={customPanelOpen} onClose={closeCustomPanel} />
        </div>
      </CustomizationContext.Provider>
    </CurrencyContext.Provider>
  );
}
