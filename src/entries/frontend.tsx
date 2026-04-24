import { StrictMode, Suspense, lazy, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@/context/ThemeContext';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider, useMusicPlayer } from '@/context/MusicContext';
import { AudioCoverMetaProvider } from '@/context/AudioCoverMetaContext';
import Header from '@/components/layout/Header';
import MusicControls from '@/components/layout/MusicControls';
import HomeScreen from '@/components/screens/HomeScreen';
import GlobalRulesScreen from '@/components/screens/GlobalRulesScreen';
import GameScreen from '@/components/screens/GameScreen';
import SummaryScreen from '@/components/screens/SummaryScreen';
import InactiveShowOverlay from '@/components/common/InactiveShowOverlay';
import { useShowPresence } from '@/hooks/useShowPresence';
import '@/index.css';

// GameScreen and SummaryScreen are loaded eagerly: lazy-loading them delayed
// useGamemasterSync's first emit until the code-split bundle had loaded
// (seconds on a slow LAN) — which the gamemaster view experienced as a long
// window of stale state after every frontend reload.
const ThemeShowcase = lazy(() => import('@/components/screens/ThemeShowcase'));

function PageLayout({ children, showGameNumber, showHeader = true }: { children: ReactNode; showGameNumber?: boolean; showHeader?: boolean }) {
  return (
    <>
      {showHeader && <Header showGameNumber={showGameNumber} />}
      <main>{children}</main>
    </>
  );
}

function AppContent() {
  const musicPlayer = useMusicPlayer();
  const location = useLocation();
  const { isActive, claim } = useShowPresence();

  return (
    <>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<PageLayout showGameNumber={false} showHeader={false}><HomeScreen /></PageLayout>} />
          <Route path="/rules" element={<PageLayout showGameNumber={false} showHeader={false}><GlobalRulesScreen /></PageLayout>} />
          <Route path="/game" element={<PageLayout><GameScreen /></PageLayout>} />
          <Route path="/summary" element={<PageLayout showGameNumber={false}><SummaryScreen /></PageLayout>} />
          <Route path="/theme-showcase" element={<ThemeShowcase />} />
        </Routes>
      </Suspense>
      {location.pathname !== '/theme-showcase' && <MusicControls player={musicPlayer} />}
      {!isActive && location.pathname !== '/theme-showcase' && <InactiveShowOverlay onClaim={claim} />}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/show">
      <ThemeProvider>
        <GameProvider>
          <AudioCoverMetaProvider>
            <MusicProvider>
              <AppContent />
            </MusicProvider>
          </AudioCoverMetaProvider>
        </GameProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
