import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@/context/ThemeContext';
import { GameProvider } from '@/context/GameContext';
import { AudioCoverMetaProvider } from '@/context/AudioCoverMetaContext';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import '@/index.css';

const AdminScreen = lazyWithRetry(() => import('@/components/screens/AdminScreen'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider rootTheme="admin">
      <GameProvider>
        <AudioCoverMetaProvider>
          <Suspense fallback={null}>
            <AdminScreen />
          </Suspense>
        </AudioCoverMetaProvider>
      </GameProvider>
    </ThemeProvider>
  </StrictMode>
);
