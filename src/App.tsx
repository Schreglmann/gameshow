import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { GameProvider, useGameContext } from '@/context/GameContext';
import { useBackgroundMusic } from '@/hooks/useBackgroundMusic';
import Header from '@/components/layout/Header';
import MusicControls from '@/components/layout/MusicControls';
import HomeScreen from '@/components/screens/HomeScreen';
import GlobalRulesScreen from '@/components/screens/GlobalRulesScreen';
import GameScreen from '@/components/screens/GameScreen';
import SummaryScreen from '@/components/screens/SummaryScreen';
import AdminScreen from '@/components/screens/AdminScreen';
import './index.css';

function AppContent() {
  const { state } = useGameContext();
  const musicPlayer = useBackgroundMusic();

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <Header showGameNumber={false} />
              <main>
                <HomeScreen />
              </main>
            </>
          }
        />
        <Route
          path="/rules"
          element={
            <>
              <Header showGameNumber={false} />
              <main>
                <GlobalRulesScreen />
              </main>
            </>
          }
        />
        <Route
          path="/game"
          element={
            <>
              <Header />
              <main>
                <GameScreen />
              </main>
            </>
          }
        />
        <Route
          path="/summary"
          element={
            <>
              <Header showGameNumber={false} />
              <main>
                <SummaryScreen />
              </main>
            </>
          }
        />
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
        <AppContent />
      </GameProvider>
    </BrowserRouter>
  );
}
