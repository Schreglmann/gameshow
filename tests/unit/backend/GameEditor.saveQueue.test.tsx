import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GameEditor from '@/components/backend/GameEditor';
import { getStatus, hasPending, gameSaveKey } from '@/services/saveQueue';

const mockSaveGame = vi.fn().mockResolvedValue(undefined);
const mockRenameGame = vi.fn().mockResolvedValue(undefined);
const mockDeleteGameInstance = vi.fn().mockResolvedValue({ success: true, removedRefs: [] });

vi.mock('@/services/backendApi', () => ({
  saveGame: (...args: unknown[]) => mockSaveGame(...args),
  saveGameBeacon: vi.fn(),
  renameGame: (...args: unknown[]) => mockRenameGame(...args),
  deleteGameInstance: (...args: unknown[]) => mockDeleteGameInstance(...args),
  convertGameToMulti: vi.fn(),
  fetchAssets: vi.fn().mockResolvedValue({ files: [], subfolders: [] }),
  fetchConfig: vi.fn().mockResolvedValue({ activeGameshow: 'test', gameshows: {} }),
  fetchGames: vi.fn().mockResolvedValue([]),
  fetchGame: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/components/backend/ConfirmContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/backend/ConfirmContext')>();
  return { ...actual, useConfirm: () => () => Promise.resolve(true) };
});

const multiInstanceData = {
  type: 'simple-quiz',
  title: 'My Quiz',
  rules: [],
  instances: {
    v1: { questions: [{ question: 'Q1?', answer: 'A1' }] },
    v2: { questions: [{ question: 'Q2?', answer: 'A2' }] },
  },
};

const singleInstanceData = {
  type: 'simple-quiz',
  title: 'My Quiz',
  rules: [],
  questions: [{ question: 'Q?', answer: 'A' }],
};

/** See specs/admin-save-queue.md — the editor unmounts on a tab switch or a Back click. */
describe('GameEditor — saves that outlive the editor', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    mockSaveGame.mockResolvedValue(undefined);
    mockRenameGame.mockResolvedValue(undefined);
    mockDeleteGameInstance.mockResolvedValue({ success: true, removedRefs: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderEditor(overrides?: Partial<Parameters<typeof GameEditor>[0]>) {
    const props = {
      fileName: 'my-quiz.json',
      initialData: JSON.parse(JSON.stringify(singleInstanceData)) as Record<string, unknown>,
      onClose: vi.fn(),
      onGoToAssets: vi.fn(),
      onInstanceChange: vi.fn(),
      onRename: vi.fn(),
      ...overrides,
    };
    return { props, ...render(<GameEditor {...props} />) };
  }

  it('still saves an edit made immediately before the editor closes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = renderEditor();

    await user.type(screen.getByDisplayValue('My Quiz'), 'x');
    unmount();
    expect(mockSaveGame).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(800); });

    await waitFor(() => expect(mockSaveGame).toHaveBeenCalledTimes(1));
    expect(mockSaveGame.mock.calls[0][1]).toMatchObject({ title: 'My Quizx' });
  });

  it('flushes a pending edit BEFORE deleting an instance, so the other instances survive', async () => {
    const order: string[] = [];
    mockSaveGame.mockImplementation(() => { order.push('save'); return Promise.resolve(); });
    mockDeleteGameInstance.mockImplementation(() => {
      order.push('delete');
      return Promise.resolve({ success: true, removedRefs: [] });
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor({ initialData: JSON.parse(JSON.stringify(multiInstanceData)) as Record<string, unknown> });

    // Edit the title, then delete an instance well inside the debounce window.
    await user.type(screen.getByDisplayValue('My Quiz'), 'y');
    await user.click(screen.getByRole('button', { name: /Instanz löschen/i }));

    await waitFor(() => expect(order).toEqual(['save', 'delete']));
    expect(mockSaveGame.mock.calls[0][1]).toMatchObject({ title: 'My Quizy' });
  });

  it('aborts a rename when the pre-rename flush fails, leaving the edit queued', async () => {
    mockSaveGame.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { props } = renderEditor();

    const titleInput = screen.getByDisplayValue('My Quiz');
    await user.clear(titleInput);
    await user.type(titleInput, 'Renamed Quiz');
    await act(async () => { titleInput.blur(); });

    await waitFor(() => expect(screen.getByText(/Umbenennung abgebrochen/i)).toBeInTheDocument());
    expect(mockRenameGame).not.toHaveBeenCalled();
    expect(props.onRename).not.toHaveBeenCalled();
    // Not dropped — the queue holds it and keeps trying.
    expect(hasPending(gameSaveKey('my-quiz.json'))).toBe(true);
    expect(getStatus().state).toBe('retrying');
  });
});
