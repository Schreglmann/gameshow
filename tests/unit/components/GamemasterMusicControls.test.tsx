import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GamemasterMusicControls from '@/components/screens/GamemasterMusicControls';
import type { MusicPlayerState } from '@/types/game';

// Drive the component with a controllable remote state + a spy command sender.
const h = vi.hoisted(() => ({
  state: null as MusicPlayerState | null,
  send: vi.fn(),
}));

vi.mock('@/hooks/useMusicSync', () => ({
  useMusicState: () => h.state,
  useSendMusicCommand: () => h.send,
}));

function setState(overrides: Partial<MusicPlayerState> = {}): void {
  h.state = {
    isPlaying: false,
    currentSong: '',
    currentTime: 0,
    duration: 0,
    volume: 0.2,
    ...overrides,
  };
}

describe('GamemasterMusicControls', () => {
  beforeEach(() => {
    h.send.mockClear();
    h.state = null;
  });

  it('renders the docked player (no slide-out toggle) with the Musik label', () => {
    setState({ currentSong: 'Track A' });
    render(<GamemasterMusicControls />);
    expect(screen.getByText('Musik')).toBeInTheDocument();
    expect(document.querySelector('.music-controls.docked')).toBeInTheDocument();
    // Docked mode never renders the collapse toggle.
    expect(document.querySelector('.music-toggle')).toBeNull();
  });

  it('mirrors the remote track name and elapsed/total time', () => {
    setState({ isPlaying: true, currentSong: 'My Track', currentTime: 65, duration: 180 });
    render(<GamemasterMusicControls />);
    expect(document.querySelector('.song-name')!.getAttribute('data-text')).toBe('My Track');
    expect(screen.getByText('1:05 / 3:00')).toBeInTheDocument();
  });

  it('sends a toggle command from the play/pause button', async () => {
    const user = userEvent.setup();
    setState({ isPlaying: true, currentSong: 'A' });
    render(<GamemasterMusicControls />);
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(h.send).toHaveBeenCalledWith('toggle');
  });

  it('sends a skip command from the next button', async () => {
    const user = userEvent.setup();
    setState({ isPlaying: true, currentSong: 'A' });
    render(<GamemasterMusicControls />);
    await user.click(screen.getByRole('button', { name: 'Next Track' }));
    expect(h.send).toHaveBeenCalledWith('skip');
  });

  it('sends a volume command and updates the slider optimistically before the show echoes', () => {
    setState({ isPlaying: true, currentSong: 'A', volume: 0.2 });
    render(<GamemasterMusicControls />);
    const slider = document.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider.value).toBe('20');

    fireEvent.change(slider, { target: { value: '75' } });

    expect(h.send).toHaveBeenCalledWith('volume', 0.75);
    // Optimistic: the knob reflects 75% even though remote state still reports 20%.
    expect(slider.value).toBe('75');
  });
});
