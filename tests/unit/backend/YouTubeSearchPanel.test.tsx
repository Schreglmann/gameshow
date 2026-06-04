import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import YouTubeSearchPanel from '@/components/backend/YouTubeSearchPanel';
import type { YouTubeSearchResult } from '@/services/backendApi';

const mockSearchYouTube = vi.fn();

vi.mock('@/services/backendApi', async () => {
  const actual = await vi.importActual<typeof import('@/services/backendApi')>('@/services/backendApi');
  return {
    ...actual,
    searchYouTube: (...args: unknown[]) => mockSearchYouTube(...args),
  };
});

const RESULT: YouTubeSearchResult = {
  id: 'dQw4w9WgXcQ',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'Never Gonna Give You Up',
  channel: 'Rick Astley',
  duration: 213,
  thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
};

beforeEach(() => {
  mockSearchYouTube.mockReset();
});

describe('YouTubeSearchPanel', () => {
  it('shows the prompt before any search', () => {
    render(<YouTubeSearchPanel onSelect={vi.fn()} />);
    expect(screen.getByText(/Suchbegriff eingeben/)).toBeInTheDocument();
  });

  it('searches on submit and renders result cards with title, channel and duration', async () => {
    mockSearchYouTube.mockResolvedValue({ results: [RESULT], page: 1, hasMore: false });
    const user = userEvent.setup();
    render(<YouTubeSearchPanel onSelect={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('YouTube durchsuchen'), 'rick astley');
    await user.click(screen.getByRole('button', { name: /Suchen/ }));

    expect(await screen.findByText('Never Gonna Give You Up')).toBeInTheDocument();
    expect(screen.getByText('Rick Astley')).toBeInTheDocument();
    expect(screen.getByText('3:33')).toBeInTheDocument(); // 213s formatted
    expect(mockSearchYouTube).toHaveBeenCalledWith('rick astley', expect.objectContaining({ page: 1 }));
  });

  it('fires onSelect with the result and submitted query when a card is clicked', async () => {
    mockSearchYouTube.mockResolvedValue({ results: [RESULT], page: 1, hasMore: false });
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<YouTubeSearchPanel onSelect={onSelect} />);

    await user.type(screen.getByPlaceholderText('YouTube durchsuchen'), 'rick astley');
    await user.click(screen.getByRole('button', { name: /Suchen/ }));
    await user.click(await screen.findByRole('button', { name: /Never Gonna Give You Up/ }));

    expect(onSelect).toHaveBeenCalledWith(RESULT, 'rick astley');
  });

  it('auto-runs the search when a defaultQuery is provided', async () => {
    mockSearchYouTube.mockResolvedValue({ results: [RESULT], page: 1, hasMore: false });
    render(<YouTubeSearchPanel defaultQuery="rick astley" onSelect={vi.fn()} />);
    await waitFor(() => expect(mockSearchYouTube).toHaveBeenCalledWith('rick astley', expect.objectContaining({ page: 1 })));
    expect(await screen.findByText('Never Gonna Give You Up')).toBeInTheDocument();
  });

  it('shows an empty state when the query returns no results', async () => {
    mockSearchYouTube.mockResolvedValue({ results: [], page: 1, hasMore: false });
    const user = userEvent.setup();
    render(<YouTubeSearchPanel onSelect={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('YouTube durchsuchen'), 'zzzz');
    await user.click(screen.getByRole('button', { name: /Suchen/ }));
    expect(await screen.findByText(/Keine Ergebnisse/)).toBeInTheDocument();
  });

  it('surfaces an error banner when the search fails', async () => {
    mockSearchYouTube.mockRejectedValue(new Error('yt-dlp boom'));
    const user = userEvent.setup();
    render(<YouTubeSearchPanel onSelect={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('YouTube durchsuchen'), 'x');
    await user.click(screen.getByRole('button', { name: /Suchen/ }));
    expect(await screen.findByText(/yt-dlp boom/)).toBeInTheDocument();
  });

  it('paginates with "Mehr laden" when hasMore is true', async () => {
    const second: YouTubeSearchResult = { ...RESULT, id: 'abc', url: 'https://www.youtube.com/watch?v=abc', title: 'Second Video' };
    mockSearchYouTube
      .mockResolvedValueOnce({ results: [RESULT], page: 1, hasMore: true })
      .mockResolvedValueOnce({ results: [second], page: 2, hasMore: false });
    const user = userEvent.setup();
    render(<YouTubeSearchPanel onSelect={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('YouTube durchsuchen'), 'q');
    await user.click(screen.getByRole('button', { name: /Suchen/ }));
    await screen.findByText('Never Gonna Give You Up');

    await user.click(screen.getByRole('button', { name: /Mehr laden/ }));
    expect(await screen.findByText('Second Video')).toBeInTheDocument();
    expect(mockSearchYouTube).toHaveBeenLastCalledWith('q', expect.objectContaining({ page: 2 }));
  });

  it('lets the user re-search while one is in flight, aborting the superseded request', async () => {
    let firstSignal: AbortSignal | undefined;
    mockSearchYouTube
      // First (typo) search hangs until its signal aborts.
      .mockImplementationOnce((_q: string, opts: { signal: AbortSignal }) => {
        firstSignal = opts.signal;
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      })
      // Corrected search resolves normally.
      .mockResolvedValueOnce({ results: [RESULT], page: 1, hasMore: false });

    const user = userEvent.setup();
    render(<YouTubeSearchPanel onSelect={vi.fn()} />);
    const input = screen.getByPlaceholderText('YouTube durchsuchen');
    const submit = screen.getByRole('button', { name: /Suchen/ });

    await user.type(input, 'rick astley'); // typo
    await user.click(submit);
    expect(submit).toBeEnabled(); // still usable while the first search runs

    await user.clear(input);
    await user.type(input, 'rick astley'); // corrected
    await user.click(submit);

    expect(firstSignal?.aborted).toBe(true); // the typo search was aborted
    expect(await screen.findByText('Never Gonna Give You Up')).toBeInTheDocument();
  });

  it('shows a cancel button while loading that stops the search', async () => {
    mockSearchYouTube.mockImplementationOnce((_q: string, opts: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    );
    const user = userEvent.setup();
    render(<YouTubeSearchPanel onSelect={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('YouTube durchsuchen'), 'x');
    await user.click(screen.getByRole('button', { name: /Suchen/ }));

    const cancel = await screen.findByRole('button', { name: 'Suche abbrechen' });
    await user.click(cancel);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Suche abbrechen' })).toBeNull());
  });
});
