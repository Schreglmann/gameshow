import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BandleForm from '@/components/backend/questions/BandleForm';
import type { BandleQuestion, BandleCatalogEntry } from '@/types/config';
import { fetchBandleCatalog, fetchBandleUsedSongs } from '@/services/backendApi';

vi.mock('@/services/backendApi', () => ({
  fetchAssets: vi.fn().mockResolvedValue({ files: [], subfolders: [] }),
  fetchBandleCatalog: vi.fn(),
  fetchBandleUsedSongs: vi.fn(),
}));

function entry(song: string, overrides: Partial<BandleCatalogEntry> = {}): BandleCatalogEntry {
  return {
    path: Math.random().toString(16).slice(2, 12),
    song,
    year: 2000,
    par: 3,
    view: 100,
    genre: [],
    packs: [],
    instruments: ['drum', 'bass', 'voice'],
    ...overrides,
  };
}

const catalog: BandleCatalogEntry[] = [
  entry('Luis Fonsi - Despacito'),
  entry('Crazy Frog - Axel F'),
  entry('Maroon 5 - Sugar'),
];

// Slug of "Crazy Frog - Axel F" as produced by the picker's songSlug()
const USED_SLUG = 'crazy-frog-axel-f';

async function openPicker() {
  fireEvent.click(screen.getByText('+ Song aus Katalog hinzufügen'));
  await waitFor(() => expect(screen.getByText('Song hinzufügen')).toBeInTheDocument());
}

describe('BandleForm song picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchBandleCatalog).mockResolvedValue(catalog);
    vi.mocked(fetchBandleUsedSongs).mockResolvedValue([USED_SLUG]);
  });

  it('hides songs used in any bandle game by default', async () => {
    render(<BandleForm questions={[]} onChange={vi.fn()} />);
    await openPicker();
    await waitFor(() => expect(screen.getByText('Luis Fonsi - Despacito')).toBeInTheDocument());
    expect(screen.getByText('Maroon 5 - Sugar')).toBeInTheDocument();
    expect(screen.queryByText('Crazy Frog - Axel F')).not.toBeInTheDocument();
    expect(screen.getByText('2 Songs')).toBeInTheDocument();
  });

  it('shows used songs again when the Verwendung chip is toggled off', async () => {
    render(<BandleForm questions={[]} onChange={vi.fn()} />);
    await openPicker();
    await waitFor(() => expect(screen.getByText('Luis Fonsi - Despacito')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Bereits verwendete Songs ausblenden'));
    expect(screen.getByText('Crazy Frog - Axel F')).toBeInTheDocument();
    expect(screen.getByText('3 Songs')).toBeInTheDocument();
  });

  it('re-fetches the used set on every picker open', async () => {
    render(<BandleForm questions={[]} onChange={vi.fn()} />);
    await openPicker();
    fireEvent.click(screen.getByText('✕'));
    await openPicker();
    expect(vi.mocked(fetchBandleUsedSongs)).toHaveBeenCalledTimes(2);
  });

  it('always hides songs already in the current instance, matched by audio folder slug', async () => {
    vi.mocked(fetchBandleUsedSongs).mockResolvedValue([]);
    const existing: BandleQuestion = {
      answer: 'Maroon 5 - Sugar',
      tracks: [{ label: 'Schlagzeug', audio: '/audio/bandle/maroon-5-sugar/track1.mp3' }],
    };
    render(<BandleForm questions={[existing]} onChange={vi.fn()} />);
    await openPicker();
    await waitFor(() => expect(screen.getByText('Luis Fonsi - Despacito')).toBeInTheDocument());
    // Only inside the picker list — the question row also shows the title
    expect(screen.getByText('2 Songs')).toBeInTheDocument();
    expect(screen.getByText('Crazy Frog - Axel F')).toBeInTheDocument();
    const pickerList = document.querySelector('.bandle-picker-list')!;
    expect(pickerList.textContent).not.toContain('Maroon 5 - Sugar');
  });
});
