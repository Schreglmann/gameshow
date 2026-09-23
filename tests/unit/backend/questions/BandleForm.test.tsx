import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BandleForm, { addedMonth, addedTitle, nextSort, sortCatalog } from '@/components/backend/questions/BandleForm';
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

describe('BandleForm song picker sorting', () => {
  // Distinct on all three sort keys so each field produces a different order.
  const sortCatalog: BandleCatalogEntry[] = [
    entry('A - Mid', { view: 200, year: 1990, folder: '202605/Mid' }),
    entry('B - Top', { view: 300, year: 1980, folder: '202604/Top' }),
    entry('C - Low', { view: 100, year: 2010, folder: '202606/Low' }),
  ];

  function titles(): string[] {
    return [...document.querySelectorAll('.bandle-picker-item-title')].map(el => el.textContent!);
  }

  /** Labels of the active sort chips — scoped to the sort row, not every chip group. */
  function activeSortChips(): string[] {
    return ['Name', 'Klicks', 'Hinzugefügt', 'Erscheinungsjahr']
      .flatMap(label => [...document.querySelectorAll<HTMLElement>('.bandle-chip.active')]
        .filter(el => el.textContent!.startsWith(label))
        .map(el => el.textContent!));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchBandleCatalog).mockResolvedValue(sortCatalog);
    vi.mocked(fetchBandleUsedSongs).mockResolvedValue([]);
  });

  it('applies no sort by default, keeping the catalog order', async () => {
    render(<BandleForm questions={[]} onChange={vi.fn()} />);
    await openPicker();
    await waitFor(() => expect(titles()).toEqual(['A - Mid', 'B - Top', 'C - Low']));
    expect(activeSortChips()).toEqual([]);
  });

  it('sorts by clicks, then flips direction on the second click', async () => {
    render(<BandleForm questions={[]} onChange={vi.fn()} />);
    await openPicker();
    await waitFor(() => expect(titles()).toHaveLength(3));
    fireEvent.click(screen.getByText('Klicks'));
    expect(titles()).toEqual(['B - Top', 'A - Mid', 'C - Low']);
    fireEvent.click(screen.getByText('Klicks ↓'));
    expect(titles()).toEqual(['C - Low', 'A - Mid', 'B - Top']);
    expect(screen.getByText('Klicks ↑')).toBeInTheDocument();
  });

  it('sorts alphabetically by name, A→Z first', async () => {
    render(<BandleForm questions={[]} onChange={vi.fn()} />);
    await openPicker();
    await waitFor(() => expect(titles()).toHaveLength(3));
    fireEvent.click(screen.getByText('Name'));
    expect(titles()).toEqual(['A - Mid', 'B - Top', 'C - Low']);
    fireEvent.click(screen.getByText('Name ↑'));
    expect(titles()).toEqual(['C - Low', 'B - Top', 'A - Mid']);
  });

  it('sorts by the month bandle added the song, newest first', async () => {
    render(<BandleForm questions={[]} onChange={vi.fn()} />);
    await openPicker();
    await waitFor(() => expect(titles()).toHaveLength(3));
    fireEvent.click(screen.getByText('Hinzugefügt'));
    expect(titles()).toEqual(['C - Low', 'A - Mid', 'B - Top']);
    fireEvent.click(screen.getByText('Hinzugefügt ↓'));
    expect(titles()).toEqual(['B - Top', 'A - Mid', 'C - Low']);
  });

  it('sorts by release year, newest first', async () => {
    render(<BandleForm questions={[]} onChange={vi.fn()} />);
    await openPicker();
    await waitFor(() => expect(titles()).toHaveLength(3));
    fireEvent.click(screen.getByText('Erscheinungsjahr'));
    expect(titles()).toEqual(['C - Low', 'A - Mid', 'B - Top']);
    fireEvent.click(screen.getByText('Erscheinungsjahr ↓'));
    expect(titles()).toEqual(['B - Top', 'A - Mid', 'C - Low']);
  });

  it('sorts themed-pack songs, which have no added month, last in both directions', async () => {
    vi.mocked(fetchBandleCatalog).mockResolvedValue([
      entry('A - Undated', { folder: '_kpop/Yeobo' }),
      entry('B - Old', { folder: '202604/Old' }),
      entry('C - New', { folder: '202606/New' }),
    ]);
    render(<BandleForm questions={[]} onChange={vi.fn()} />);
    await openPicker();
    await waitFor(() => expect(titles()).toHaveLength(3));
    fireEvent.click(screen.getByText('Hinzugefügt'));
    expect(titles()).toEqual(['C - New', 'B - Old', 'A - Undated']);
    fireEvent.click(screen.getByText('Hinzugefügt ↓'));
    expect(titles()).toEqual(['B - Old', 'C - New', 'A - Undated']);
  });

  it('returns to the default sort on a third click of the same field', async () => {
    render(<BandleForm questions={[]} onChange={vi.fn()} />);
    await openPicker();
    await waitFor(() => expect(titles()).toHaveLength(3));
    fireEvent.click(screen.getByText('Erscheinungsjahr'));      // 1st — year desc
    fireEvent.click(screen.getByText('Erscheinungsjahr ↓'));    // 2nd — year asc
    fireEvent.click(screen.getByText('Erscheinungsjahr ↑'));    // 3rd — no sort
    expect(activeSortChips()).toEqual([]);
    expect(titles()).toEqual(['A - Mid', 'B - Top', 'C - Low']);
  });

  it('shows the added month spelled out on hover', async () => {
    render(<BandleForm questions={[]} onChange={vi.fn()} />);
    await openPicker();
    await waitFor(() => expect(titles()).toHaveLength(3));
    expect(screen.getByTitle('Bei Bandle hinzugefügt: Mai 2026 (Tag unbekannt)')).toHaveTextContent('05/2026');
    expect(screen.getByTitle('Bei Bandle hinzugefügt: April 2026 (Tag unbekannt)')).toHaveTextContent('04/2026');
  });

  it('keeps the chosen sort when the picker is closed and reopened', async () => {
    render(<BandleForm questions={[]} onChange={vi.fn()} />);
    await openPicker();
    await waitFor(() => expect(titles()).toHaveLength(3));
    fireEvent.click(screen.getByText('Erscheinungsjahr'));
    fireEvent.click(screen.getByText('✕'));
    await openPicker();
    expect(screen.getByText('Erscheinungsjahr ↓')).toBeInTheDocument();
    expect(titles()).toEqual(['C - Low', 'A - Mid', 'B - Top']);
  });
});

describe('addedMonth', () => {
  it('reads the month from a dated bandle folder slot', () => {
    expect(addedMonth(entry('x', { folder: '202607/Wanted' }))).toBe(202607);
  });

  it('returns null for themed-pack slots and for a missing folder', () => {
    expect(addedMonth(entry('x', { folder: '_kpop/Yeobo' }))).toBeNull();
    expect(addedMonth(entry('x', { folder: undefined }))).toBeNull();
  });
});

describe('nextSort', () => {
  it('picks a field at its default direction from the unsorted state', () => {
    expect(nextSort('year', null)).toEqual({ field: 'year', dir: 'desc' });
    expect(nextSort('song', null)).toEqual({ field: 'song', dir: 'asc' });
  });

  it('switches straight to another field at its own default direction', () => {
    expect(nextSort('song', { field: 'year', dir: 'asc' })).toEqual({ field: 'song', dir: 'asc' });
  });

  it('runs each field through pick → flip → unsorted', () => {
    const first = nextSort('view', null);
    expect(first).toEqual({ field: 'view', dir: 'desc' });
    const second = nextSort('view', first);
    expect(second).toEqual({ field: 'view', dir: 'asc' });
    expect(nextSort('view', second)).toBeNull();
  });

  it('cycles an ascending-by-default field the same way', () => {
    const first = nextSort('song', null);
    expect(first).toEqual({ field: 'song', dir: 'asc' });
    const second = nextSort('song', first);
    expect(second).toEqual({ field: 'song', dir: 'desc' });
    expect(nextSort('song', second)).toBeNull();
  });
});

describe('sortCatalog', () => {
  const a = entry('A', { dailyDate: '2026-07-20', folder: '202607/A' });
  const b = entry('B', { dailyDate: '2026-07-03', folder: '202607/B' });
  const c = entry('C', { folder: '202607/C' });          // month only, no daily slot
  const d = entry('D', { folder: '_kpop/D' });           // themed pack, no date at all

  it('leaves the catalog order untouched when there is no sort', () => {
    const input = [c, a, d, b];
    expect(sortCatalog(input, null)).toBe(input);
  });

  it('orders by exact day within a month, month-only songs first', () => {
    const order = sortCatalog([a, b, c, d], { field: 'added', dir: 'asc' }).map(e => e.song);
    expect(order).toEqual(['C', 'B', 'A', 'D']);
  });

  it('sorts a re-run song by the month it was added, not the repeat airing', () => {
    const rerun = entry('Rerun', { dailyDate: '2026-08-18', folder: '202408/Save' });
    const order = sortCatalog([a, rerun], { field: 'added', dir: 'desc' }).map(e => e.song);
    expect(order).toEqual(['A', 'Rerun']);   // A = 07/2026, well after 08/2024
  });

  it('keeps undated songs last when the direction flips', () => {
    const order = sortCatalog([a, b, c, d], { field: 'added', dir: 'desc' }).map(e => e.song);
    expect(order).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('addedTitle', () => {
  it('spells out the exact day when the song ran as a daily puzzle', () => {
    expect(addedTitle(entry('x', { dailyDate: '2026-07-15', folder: '202607/W' })))
      .toBe('Bei Bandle hinzugefügt: 15. Juli 2026');
  });

  it('falls back to the month and says the day is unknown', () => {
    expect(addedTitle(entry('x', { folder: '202603/W' })))
      .toBe('Bei Bandle hinzugefügt: März 2026 (Tag unbekannt)');
  });

  it('ignores a re-run airing from outside the added month', () => {
    // The Fray — added 08/2024, aired again 2026-08-18.
    expect(addedTitle(entry('x', { dailyDate: '2026-08-18', folder: '202408/Save' })))
      .toBe('Bei Bandle hinzugefügt: August 2024 (Tag unbekannt)');
  });
});
