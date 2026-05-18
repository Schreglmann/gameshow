import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@/context/ThemeContext';
import { GameProvider } from '@/context/GameContext';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import '@/index.css';

const GamemasterScreen = lazyWithRetry(() => import('@/components/screens/GamemasterScreen'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider rootTheme="admin">
      <GameProvider>
        <Suspense fallback={null}>
          <GamemasterScreen />
        </Suspense>
      </GameProvider>
    </ThemeProvider>
  </StrictMode>
);
