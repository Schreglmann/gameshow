import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@/context/ThemeContext';
import { GameProvider } from '@/context/GameContext';
import '@/index.css';

const AdminScreen = lazy(() => import('@/components/screens/AdminScreen'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider rootTheme="admin">
      <GameProvider>
        <Suspense fallback={null}>
          <AdminScreen />
        </Suspense>
      </GameProvider>
    </ThemeProvider>
  </StrictMode>
);
