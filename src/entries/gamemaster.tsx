import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@/context/ThemeContext';
import { GameProvider } from '@/context/GameContext';
import '@/index.css';

const GamemasterScreen = lazy(() => import('@/components/screens/GamemasterScreen'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <GameProvider>
        <Suspense fallback={null}>
          <GamemasterScreen />
        </Suspense>
      </GameProvider>
    </ThemeProvider>
  </StrictMode>
);
