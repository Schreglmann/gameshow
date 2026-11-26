import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import ConnectionDot, { SHOW_OFFLINE_DELAY_MS } from '@/components/common/ConnectionDot';
import GmConnectionBanner, { GM_OFFLINE_DELAY_MS, DROPPED_FLASH_MS } from '@/components/common/GmConnectionBanner';
import { __setConnectedForTests, sendWs } from '@/services/useBackendSocket';

// Offline indicators on the show and gamemaster screens. See specs/crash-recovery.md.
describe('server connection indicators', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    act(() => __setConnectedForTests(true));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('ConnectionDot (show)', () => {
    it('stays hidden while connected', () => {
      render(<ConnectionDot />);
      expect(screen.queryByTestId('connection-dot')).toBeNull();
    });

    it('appears only after the server has been gone for 3 s', () => {
      render(<ConnectionDot />);
      act(() => __setConnectedForTests(false));
      act(() => { vi.advanceTimersByTime(SHOW_OFFLINE_DELAY_MS - 1); });
      expect(screen.queryByTestId('connection-dot')).toBeNull();
      act(() => { vi.advanceTimersByTime(1); });
      expect(screen.getByLabelText('Server getrennt')).toBeInTheDocument();
    });

    it('never shows for a blip shorter than the delay', () => {
      render(<ConnectionDot />);
      act(() => __setConnectedForTests(false));
      act(() => { vi.advanceTimersByTime(1000); });
      act(() => __setConnectedForTests(true));
      act(() => { vi.advanceTimersByTime(SHOW_OFFLINE_DELAY_MS * 2); });
      expect(screen.queryByTestId('connection-dot')).toBeNull();
    });

    it('disappears on reconnect', () => {
      render(<ConnectionDot />);
      act(() => __setConnectedForTests(false));
      act(() => { vi.advanceTimersByTime(SHOW_OFFLINE_DELAY_MS); });
      expect(screen.getByTestId('connection-dot')).toBeInTheDocument();
      act(() => __setConnectedForTests(true));
      expect(screen.queryByTestId('connection-dot')).toBeNull();
    });
  });

  describe('GmConnectionBanner (gamemaster)', () => {
    it('appears after 1.5 s offline and clears on reconnect', () => {
      render(<GmConnectionBanner />);
      act(() => __setConnectedForTests(false));
      act(() => { vi.advanceTimersByTime(GM_OFFLINE_DELAY_MS); });
      expect(screen.getByText('Server getrennt – verbinde neu…')).toBeInTheDocument();
      act(() => __setConnectedForTests(true));
      expect(screen.queryByTestId('gm-connection-banner')).toBeNull();
    });

    it('flashes "Befehl nicht gesendet" right away when a command is dropped', () => {
      render(<GmConnectionBanner />);
      act(() => __setConnectedForTests(false));
      // In tests the socket never opens, so every send is dropped.
      act(() => { sendWs('gamemaster-command', { controlId: 'nav-forward' }); });
      expect(screen.getByText('Befehl nicht gesendet')).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(DROPPED_FLASH_MS); });
      expect(screen.queryByText('Befehl nicht gesendet')).toBeNull();
    });

    it('does not flash for state channels that are re-sent on reconnect', () => {
      render(<GmConnectionBanner />);
      act(() => { sendWs('gamemaster-team-state-v2', {}); });
      expect(screen.queryByText('Befehl nicht gesendet')).toBeNull();
    });

    it('is excluded from tap-to-advance', () => {
      render(<GmConnectionBanner forceState="offline" />);
      expect(screen.getByTestId('gm-connection-banner')).toHaveAttribute('data-gm-no-nav');
      fireEvent.click(screen.getByTestId('gm-connection-banner'));
    });
  });
});
