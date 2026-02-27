import { BrowserRouter, Routes, Route } from 'react-router-dom';
import type { ReactNode } from 'react';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider, useMusicPlayer } from '@/context/MusicContext';
import Header from '@/components/layout/Header';
import MusicControls from '@/components/layout/MusicControls';
import HomeScreen from '@/components/screens/HomeScreen';
import GlobalRulesScreen from '@/components/screens/GlobalRulesScreen';
import GameScreen from '@/components/screens/GameScreen';
import SummaryScreen from '@/components/screens/SummaryScreen';
import AdminScreen from '@/components/screens/AdminScreen';
import './index.css';

function PageLayout({ children, showGameNumber }: { children: ReactNode; showGameNumber?: boolean }) {
  return (
    <>
      <Header showGameNumber={showGameNumber} />
      <main>{children}</main>
    </>
  );
}

function AppContent() {
  const musicPlayer = useMusicPlayer();

  return (
    <>
      <Routes>
        <Route path="/" element={<PageLayout showGameNumber={false}><HomeScreen /></PageLayout>} />
        <Route path="/rules" element={<PageLayout showGameNumber={false}><GlobalRulesScreen /></PageLayout>} />
        <Route path="/game" element={<PageLayout><GameScreen /></PageLayout>} />
        <Route path="/summary" element={<PageLayout showGameNumber={false}><SummaryScreen /></PageLayout>} />
        <Route path="/admin" element={<AdminScreen />} />
      </Routes>
      <MusicControls player={musicPlayer} />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <GameProvider>
        <MusicProvider>
          <AppContent />
        </MusicProvider>
      </GameProvider>
    </BrowserRouter>
  );
}
