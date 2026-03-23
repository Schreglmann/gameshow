import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AudioGuessInfo from '@/components/backend/questions/AudioGuessInfo';

describe('AudioGuessInfo', () => {
  it('renders info heading', () => {
    render(<AudioGuessInfo onGoToAssets={vi.fn()} />);
    expect(screen.getByText('Fragen werden dynamisch geladen')).toBeInTheDocument();
  });

  it('renders description about audio-guess folder structure', () => {
    render(<AudioGuessInfo onGoToAssets={vi.fn()} />);
    expect(screen.getByText(/Audio-Guess Fragen werden automatisch/)).toBeInTheDocument();
  });

  it('renders file structure example', () => {
    render(<AudioGuessInfo onGoToAssets={vi.fn()} />);
    expect(screen.getByText('/audio-guess/SongName/short.wav')).toBeInTheDocument();
  });

  it('renders a button to go to assets', () => {
    render(<AudioGuessInfo onGoToAssets={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Zu Assets/ })).toBeInTheDocument();
  });

  it('calls onGoToAssets when button is clicked', async () => {
    const onGoToAssets = vi.fn();
    const user = userEvent.setup();
    render(<AudioGuessInfo onGoToAssets={onGoToAssets} />);
    await user.click(screen.getByRole('button', { name: /Zu Assets/ }));
    expect(onGoToAssets).toHaveBeenCalledOnce();
  });

  it('mentions Beispiel_ prefix for example questions', () => {
    render(<AudioGuessInfo onGoToAssets={vi.fn()} />);
    expect(screen.getByText(/Beispiel_/)).toBeInTheDocument();
  });

  it('explains folder name is used as answer', () => {
    render(<AudioGuessInfo onGoToAssets={vi.fn()} />);
    expect(screen.getByText(/Ordnername wird als Antwort verwendet/)).toBeInTheDocument();
  });
});
