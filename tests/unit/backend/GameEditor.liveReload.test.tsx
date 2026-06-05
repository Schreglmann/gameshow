import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GameEditor from '@/components/backend/GameEditor';
import { __emitChannelForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';

// Hoisted so the (hoisted) vi.mock factory can reference the class directly without a TDZ.
const { ApiError } = vi.hoisted(() => {
  class ApiError extends Error {
    body: unknown;
    status: number;
    constructor(message: string, body: unknown, status = 0) {
      super(message);
      this.name = 'ApiError';
      this.body = body;
      this.status = status;
    }
  }
  return { ApiError };
});

const mockSaveGame = vi.fn().mockResolvedValue(undefined);
const mockFetchGame = vi.fn();
const mockDeleteGameInstance = vi.fn().mockResolvedValue({ success: true, removedRefs: [] });

vi.mock('@/services/backendApi', () => ({
  saveGame: (...args: unknown[]) => mockSaveGame(...args),
  fetchGame: (...args: unknown[]) => mockFetchGame(...args),
  deleteGameInstance: (...args: unknown[]) => mockDeleteGameInstance(...args),
  renameGame: vi.fn().mockResolvedValue(undefined),
  unlockPrecheck: vi.fn(),
  fetchConfig: vi.fn().mockResolvedValue({ activeGameshow: 'test', gameshows: {}, rulesPresets: [] }),
  ApiError,
}));

const singleInstanceData = {
  type: 'simple-quiz',
  title: 'My Quiz',
  rules: [],
  questions: [{ question: 'Q?', answer: 'A' }],
};

function renderEditor(overrides?: Partial<Parameters<typeof GameEditor>[0]>) {
  const props = {
    fileName: 'my-quiz.json',
    initialData: { ...singleInstanceData },
    onClose: vi.fn(),
    onGoToAssets: vi.fn(),
    onInstanceChange: vi.fn(),
    onRename: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<GameEditor {...props} />) };
}

const BANNER_RE = /in einem anderen Tab geändert/i;

describe('GameEditor — cross-tab live sync', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    mockSaveGame.mockResolvedValue(undefined);
    mockDeleteGameInstance.mockResolvedValue({ success: true, removedRefs: [] });
    __clearWsCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adopts a remote change in place when there are no unsaved edits', async () => {
    mockFetchGame.mockResolvedValue({
      type: 'simple-quiz',
      title: 'Remote Title',
      rules: [],
      questions: [{ question: 'Q?', answer: 'A' }],
    });
    renderEditor();

    await act(async () => {
      __emitChannelForTests('content-changed', { games: true });
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Remote Title')).toBeInTheDocument();
    });
    expect(screen.queryByText(BANNER_RE)).not.toBeInTheDocument();
  });

  it('does NOT re-save after adopting a remote change (no cross-tab ping-pong)', async () => {
    mockFetchGame.mockResolvedValue({
      type: 'simple-quiz',
      title: 'Remote Title',
      rules: [],
      questions: [{ question: 'Q?', answer: 'A' }],
    });
    renderEditor();

    await act(async () => {
      __emitChannelForTests('content-changed', { games: true });
    });
    await waitFor(() => expect(screen.getByDisplayValue('Remote Title')).toBeInTheDocument());

    // Let the debounce window pass — an adopted change must not schedule a save.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(mockSaveGame).not.toHaveBeenCalled();
  });

  it('shows a conflict banner (and keeps local edits) when a remote change arrives with unsaved edits', async () => {
    // Never-resolving save keeps the editor dirty regardless of the debounce.
    mockSaveGame.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();

    const titleInput = screen.getByDisplayValue('My Quiz');
    await user.clear(titleInput);
    await user.type(titleInput, 'Local Edit');

    mockFetchGame.mockResolvedValue({
      type: 'simple-quiz',
      title: 'Remote Title',
      rules: [],
      questions: [{ question: 'Q?', answer: 'A' }],
    });
    await act(async () => {
      __emitChannelForTests('content-changed', { games: true });
    });

    await waitFor(() => expect(screen.getByText(BANNER_RE)).toBeInTheDocument());
    // Local edits preserved — NOT overwritten by the remote version.
    expect(screen.getByDisplayValue('Local Edit')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Remote Title')).not.toBeInTheDocument();
  });

  it('does NOT show a banner when the on-disk file equals our saved baseline, even with unsaved edits (stray echo)', async () => {
    // Keep the editor dirty for the whole test.
    mockSaveGame.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();

    const titleInput = screen.getByDisplayValue('My Quiz');
    await user.clear(titleInput);
    await user.type(titleInput, 'Local Edit');

    // A stray content-changed (e.g. the fresh-install "Beispiele erstellen" write-burst) arrives,
    // but the file on disk is UNCHANGED — it still equals what the editor loaded (the baseline).
    mockFetchGame.mockResolvedValue({ ...singleInstanceData });
    await act(async () => {
      __emitChannelForTests('content-changed', { games: true });
    });

    // No false banner; local edits preserved.
    await waitFor(() => expect(mockFetchGame).toHaveBeenCalled());
    expect(screen.queryByText(BANNER_RE)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Local Edit')).toBeInTheDocument();
  });

  it('"Neu laden" adopts the remote version and clears the banner', async () => {
    mockSaveGame.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();

    const titleInput = screen.getByDisplayValue('My Quiz');
    await user.clear(titleInput);
    await user.type(titleInput, 'Local Edit');

    mockFetchGame.mockResolvedValue({
      type: 'simple-quiz',
      title: 'Remote Title',
      rules: [],
      questions: [{ question: 'Q?', answer: 'A' }],
    });
    await act(async () => {
      __emitChannelForTests('content-changed', { games: true });
    });
    await waitFor(() => expect(screen.getByText(BANNER_RE)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Neu laden' }));

    await waitFor(() => expect(screen.getByDisplayValue('Remote Title')).toBeInTheDocument());
    expect(screen.queryByText(BANNER_RE)).not.toBeInTheDocument();
  });

  it('does NOT show a banner for our OWN save echoing back', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();

    const titleInput = screen.getByDisplayValue('My Quiz');
    await user.clear(titleInput);
    await user.type(titleInput, 'Saved By Me');

    act(() => { vi.advanceTimersByTime(800); });
    await waitFor(() => expect(mockSaveGame).toHaveBeenCalled());

    // The watcher echoes back exactly what WE just persisted.
    const savedPayload = mockSaveGame.mock.calls.at(-1)![1];
    mockFetchGame.mockResolvedValue(savedPayload);
    await act(async () => {
      __emitChannelForTests('content-changed', { games: true });
    });

    // No banner, value unchanged.
    expect(screen.queryByText(BANNER_RE)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Saved By Me')).toBeInTheDocument();
  });

  it('returns to the list (onClose) when the open game was deleted in another tab (404)', async () => {
    const onClose = vi.fn();
    mockFetchGame.mockRejectedValue(new ApiError('Game not found', { error: 'Game not found' }, 404));
    renderEditor({ onClose });

    await act(async () => {
      __emitChannelForTests('content-changed', { games: true });
    });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('ignores a content-changed without the games flag', async () => {
    renderEditor();
    await act(async () => {
      __emitChannelForTests('content-changed', { config: true, theme: true });
    });
    expect(mockFetchGame).not.toHaveBeenCalled();
  });
});
