import { StrictMode, Suspense, lazy, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@/context/ThemeContext';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider, useMusicPlayer } from '@/context/MusicContext';
import Header from '@/components/layout/Header';
import MusicControls from '@/components/layout/MusicControls';
import HomeScreen from '@/components/screens/HomeScreen';
import GlobalRulesScreen from '@/components/screens/GlobalRulesScreen';
import '@/index.css';

const GameScreen = lazy(() => import('@/components/screens/GameScreen'));
const SummaryScreen = lazy(() => import('@/components/screens/SummaryScreen'));
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
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/show">
      <ThemeProvider>
        <GameProvider>
          <MusicProvider>
            <AppContent />
          </MusicProvider>
        </GameProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
