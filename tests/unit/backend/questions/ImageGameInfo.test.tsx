import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ImageGameInfo from '@/components/backend/questions/ImageGameInfo';

describe('ImageGameInfo', () => {
  it('renders info heading', () => {
    render(<ImageGameInfo onGoToAssets={vi.fn()} />);
    expect(screen.getByText('Fragen werden dynamisch geladen')).toBeInTheDocument();
  });

  it('renders description about image-guess folder', () => {
    render(<ImageGameInfo onGoToAssets={vi.fn()} />);
    expect(screen.getByText(/Image-Game Fragen werden automatisch/)).toBeInTheDocument();
  });

  it('renders supported formats info', () => {
    render(<ImageGameInfo onGoToAssets={vi.fn()} />);
    expect(screen.getByText(/\.jpg, \.jpeg, \.png, \.gif/)).toBeInTheDocument();
  });

  it('renders a button to go to assets', () => {
    render(<ImageGameInfo onGoToAssets={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Zu Assets/ })).toBeInTheDocument();
  });

  it('calls onGoToAssets when button is clicked', async () => {
    const onGoToAssets = vi.fn();
    const user = userEvent.setup();
    render(<ImageGameInfo onGoToAssets={onGoToAssets} />);
    await user.click(screen.getByRole('button', { name: /Zu Assets/ }));
    expect(onGoToAssets).toHaveBeenCalledOnce();
  });

  it('mentions Beispiel_ prefix for example questions', () => {
    render(<ImageGameInfo onGoToAssets={vi.fn()} />);
    expect(screen.getByText(/Beispiel_/)).toBeInTheDocument();
  });

  it('explains filename is used as answer', () => {
    render(<ImageGameInfo onGoToAssets={vi.fn()} />);
    expect(screen.getByText(/Dateiname.*als Antwort verwendet/)).toBeInTheDocument();
  });
});
