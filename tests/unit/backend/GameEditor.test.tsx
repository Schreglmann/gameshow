import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GameEditor from '@/components/backend/GameEditor';

const mockSaveGame = vi.fn().mockResolvedValue(undefined);
const mockDeleteGameInstance = vi.fn().mockResolvedValue({ success: true, removedRefs: [] });
const mockConvertGameToMulti = vi.fn();

vi.mock('@/services/backendApi', () => ({
  saveGame: (...args: unknown[]) => mockSaveGame(...args),
  deleteGameInstance: (...args: unknown[]) => mockDeleteGameInstance(...args),
  convertGameToMulti: (...args: unknown[]) => mockConvertGameToMulti(...args),
  fetchAssets: vi.fn().mockResolvedValue({ files: [], subfolders: [] }),
  fetchConfig: vi.fn().mockResolvedValue({ activeGameshow: 'test', gameshows: {} }),
  fetchGames: vi.fn().mockResolvedValue([]),
}));

const multiInstanceData = {
  type: 'simple-quiz',
  title: 'My Quiz',
  rules: [],
  instances: {
    v1: { questions: [] },
    v2: { questions: [{ question: 'Q?', answer: 'A' }] },
  },
};

const singleInstanceData = {
  type: 'audio-guess',
  title: 'My Audio Game',
  rules: [],
};

describe('GameEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockSaveGame.mockClear();
    mockConvertGameToMulti.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderEditor(overrides?: Partial<Parameters<typeof GameEditor>[0]>) {
    const props = {
      fileName: 'my-quiz.json',
      initialData: { ...multiInstanceData },
      onClose: vi.fn(),
      onGoToAssets: vi.fn(),
      onInstanceChange: vi.fn(),
      ...overrides,
    };
    return render(<GameEditor {...props} />);
  }

  it('renders back button', () => {
    renderEditor();
    expect(screen.getByRole('button', { name: /← Zurück/ })).toBeInTheDocument();
  });

  it('calls onClose when back button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor({ onClose });
    await user.click(screen.getByRole('button', { name: /← Zurück/ }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders game title in header', () => {
    renderEditor();
    expect(screen.getByText('My Quiz')).toBeInTheDocument();
  });

  it('renders type badge in header', () => {
    renderEditor();
    const badge = document.querySelector('.type-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('Klassisches Quiz');
  });

  it('renders "Grundeinstellungen" card', () => {
    renderEditor();
    expect(screen.getByText('Grundeinstellungen')).toBeInTheDocument();
  });

  it('renders title input with current value', () => {
    renderEditor();
    expect(screen.getByDisplayValue('My Quiz')).toBeInTheDocument();
  });

  it('renders type select with current value', () => {
    renderEditor();
    const select = screen.getByRole('combobox', { name: 'Spieltyp' }) as HTMLSelectElement;
    expect(select.value).toBe('simple-quiz');
  });

  it('renders all game type options in select', () => {
    renderEditor();
    const select = screen.getByRole('combobox', { name: 'Spieltyp' });
    const options = Array.from(select.querySelectorAll('option'));
    const values = options.map(o => o.value);
    expect(values).toContain('simple-quiz');
    expect(values).toContain('guessing-game');
    expect(values).toContain('final-quiz');
    expect(values).toContain('audio-guess');
    expect(values).toContain('q1');
    expect(values).toContain('four-statements');
    expect(values).toContain('fact-or-fake');
    expect(values).toContain('quizjagd');
  });

  it('renders randomizeQuestions checkbox', () => {
    renderEditor();
    expect(screen.getByText('Fragen zufällig anordnen')).toBeInTheDocument();
  });

  it('renders instance tabs for multi-instance game', () => {
    renderEditor();
    expect(screen.getByRole('button', { name: 'v1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'v2' })).toBeInTheDocument();
  });

  it('renders "+ Instanz" button for multi-instance games', () => {
    renderEditor();
    expect(screen.getByRole('button', { name: '+ Instanz' })).toBeInTheDocument();
  });

  it('does NOT render instance tabs for single-instance game', () => {
    renderEditor({ initialData: { ...singleInstanceData } });
    expect(screen.queryByRole('button', { name: 'v1' })).not.toBeInTheDocument();
  });

  it('renders "Inhalte" heading for single-instance game', () => {
    renderEditor({ initialData: { ...singleInstanceData } });
    expect(screen.getByText('Inhalte')).toBeInTheDocument();
  });

  it('renders "+ Instanz" button for single-instance games too', () => {
    renderEditor({ initialData: { ...singleInstanceData } });
    expect(screen.getByRole('button', { name: '+ Instanz' })).toBeInTheDocument();
  });

  it('converts single-instance to multi and adds an empty v2 when "+ Instanz" is clicked', async () => {
    mockConvertGameToMulti.mockResolvedValue({
      gameFile: { type: 'audio-guess', title: 'My Audio Game', rules: [], instances: { v1: {} } },
      rewrittenRefs: [],
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor({ fileName: 'my-audio-game.json', initialData: { ...singleInstanceData } });
    await user.click(screen.getByRole('button', { name: '+ Instanz' }));
    await waitFor(() => expect(mockConvertGameToMulti).toHaveBeenCalledWith('my-audio-game.json'));
    // Existing content stays as v1, the new empty v2 becomes the active instance.
    await waitFor(() => expect(screen.getByText('Instanz: v2')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'v1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'v2' })).toBeInTheDocument();
  });

  it('renders "Instanz: v1" heading for multi-instance game', () => {
    renderEditor();
    expect(screen.getByText('Instanz: v1')).toBeInTheDocument();
  });

  it('switches active instance when tab is clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'v2' }));
    expect(screen.getByText('Instanz: v2')).toBeInTheDocument();
  });

  it('calls onInstanceChange when switching instance', async () => {
    const onInstanceChange = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor({ onInstanceChange });
    await user.click(screen.getByRole('button', { name: 'v2' }));
    expect(onInstanceChange).toHaveBeenCalledWith('v2');
  });

  it('adds new instance when "+ Instanz" is clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();
    await user.click(screen.getByRole('button', { name: '+ Instanz' }));
    expect(screen.getByRole('button', { name: 'v3' })).toBeInTheDocument();
  });

  it('shows "Instanz löschen" button when multiple instances exist', () => {
    renderEditor();
    expect(screen.getByRole('button', { name: 'Instanz löschen' })).toBeInTheDocument();
  });

  it('does NOT show "Instanz löschen" button when only one instance exists', async () => {
    renderEditor({ initialData: { type: 'simple-quiz', title: 'Q', rules: [], instances: { v1: { questions: [] } } } });
    expect(screen.queryByRole('button', { name: 'Instanz löschen' })).not.toBeInTheDocument();
  });

  it('deletes instance on confirmed delete', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();
    // v1 is active by default
    await user.click(screen.getByRole('button', { name: 'Instanz löschen' }));
    // Deletion is server-side (file + gameOrder cascade), so the instance disappears
    // only after the DELETE resolves.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'v1' })).not.toBeInTheDocument();
    });
    expect(mockDeleteGameInstance).toHaveBeenCalledWith('my-quiz.json', 'v1');
    expect(screen.getByRole('button', { name: 'v2' })).toBeInTheDocument();
  });

  it('does NOT delete instance when confirm is cancelled', async () => {
    window.confirm = vi.fn(() => false);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Instanz löschen' }));
    expect(screen.getByRole('button', { name: 'v1' })).toBeInTheDocument();
    window.confirm = () => true;
  });

  it('auto-saves after 800ms debounce when title changes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();

    const titleInput = screen.getByDisplayValue('My Quiz');
    await user.clear(titleInput);
    await user.type(titleInput, 'Updated Title');

    act(() => { vi.advanceTimersByTime(800); });

    await waitFor(() => {
      expect(mockSaveGame).toHaveBeenCalledWith(
        'my-quiz.json',
        expect.objectContaining({ title: 'Updated Title' })
      );
    });
  });

  it('does NOT save before 800ms debounce', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();

    const titleInput = screen.getByDisplayValue('My Quiz');
    await user.type(titleInput, 'x');

    act(() => { vi.advanceTimersByTime(400); });

    expect(mockSaveGame).not.toHaveBeenCalled();
  });

  it('shows success toast after save', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();

    const titleInput = screen.getByDisplayValue('My Quiz');
    await user.type(titleInput, 'x');

    act(() => { vi.advanceTimersByTime(800); });

    await waitFor(() => {
      expect(screen.getByText('✅ Gespeichert!')).toBeInTheDocument();
    });
  });

  it('shows error toast when save fails', async () => {
    mockSaveGame.mockRejectedValueOnce(new Error('Save failed'));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();

    const titleInput = screen.getByDisplayValue('My Quiz');
    await user.type(titleInput, 'x');

    act(() => { vi.advanceTimersByTime(800); });

    await waitFor(() => {
      expect(screen.getByText(/Save failed/)).toBeInTheDocument();
    });
  });

  it('updates title in header when title input changes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();

    const titleInput = screen.getByDisplayValue('My Quiz');
    await user.clear(titleInput);
    await user.type(titleInput, 'New Title');

    expect(screen.getByText('New Title')).toBeInTheDocument();
  });

  it('changes game type when select is changed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor({ initialData: { type: 'simple-quiz', title: 'T', rules: [], instances: { v1: { questions: [] } } } });

    const select = screen.getByRole('combobox', { name: 'Spieltyp' });
    await user.selectOptions(select, 'guessing-game');

    expect((select as HTMLSelectElement).value).toBe('guessing-game');
  });

  it('warns before changing game type when the game has questions, and resets to a clean game on confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor(); // multiInstanceData: v1 + v2 (v2 has a question) → has content

    const select = screen.getByRole('combobox', { name: 'Spieltyp' }) as HTMLSelectElement;
    await user.selectOptions(select, 'guessing-game');

    expect(confirmSpy).toHaveBeenCalledWith('Spieltyp ändern?');
    await waitFor(() => expect(select.value).toBe('guessing-game'));
    // Content reset to the clean template (single v1 instance) — NOT a blank page, and the
    // old v2 instance is gone. The editor still renders its base card + instance editor.
    expect(screen.getByText('Grundeinstellungen')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Instanz: v1')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'v2' })).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('keeps the game type when the change warning is cancelled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor(); // has content

    const select = screen.getByRole('combobox', { name: 'Spieltyp' }) as HTMLSelectElement;
    await user.selectOptions(select, 'guessing-game');

    expect(confirmSpy).toHaveBeenCalledWith('Spieltyp ändern?');
    // Type unchanged — the header badge reflects the live `data.type`.
    await waitFor(() => expect(document.querySelector('.type-badge')?.textContent).toBe('Klassisches Quiz'));
    confirmSpy.mockRestore();
  });

  it('does NOT warn when changing the type of a game with no questions', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor({ initialData: { type: 'simple-quiz', title: 'T', rules: [], instances: { v1: { questions: [] } } } });

    const select = screen.getByRole('combobox', { name: 'Spieltyp' }) as HTMLSelectElement;
    await user.selectOptions(select, 'guessing-game');

    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(select.value).toBe('guessing-game'));
    confirmSpy.mockRestore();
  });

  it('switches between compatible types (simple-quiz ↔ bet-quiz) without warning and keeps questions', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor(); // multiInstanceData: simple-quiz, v2 has a question

    const select = screen.getByRole('combobox', { name: 'Spieltyp' }) as HTMLSelectElement;
    await user.selectOptions(select, 'bet-quiz');

    // Compatible shape — no warning, type switches, instances/questions preserved.
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(select.value).toBe('bet-quiz'));
    expect(screen.getByRole('button', { name: 'v1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'v2' })).toBeInTheDocument();

    // The retained question is persisted on the next auto-save.
    act(() => { vi.advanceTimersByTime(800); });
    await waitFor(() => {
      const saved = mockSaveGame.mock.calls.at(-1)?.[1] as { type: string; instances: { v2: { questions: unknown[] } } };
      expect(saved.type).toBe('bet-quiz');
      expect(saved.instances.v2.questions).toHaveLength(1);
    });
    confirmSpy.mockRestore();
  });

  it('toggles randomizeQuestions when checkbox is clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();

    const checkbox = screen.getByRole('checkbox', { name: 'Fragen zufällig anordnen' });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it('saves with randomizeQuestions=true when checkbox is enabled', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();

    await user.click(screen.getByRole('checkbox', { name: 'Fragen zufällig anordnen' }));

    act(() => { vi.advanceTimersByTime(800); });

    await waitFor(() => {
      expect(mockSaveGame).toHaveBeenCalledWith(
        'my-quiz.json',
        expect.objectContaining({ randomizeQuestions: true })
      );
    });
  });

  it('reads randomizeQuestions from active instance when only set there', () => {
    renderEditor({
      initialData: {
        type: 'simple-quiz',
        title: 'Inst-Level',
        rules: [],
        instances: {
          v1: { randomizeQuestions: true, questions: [] },
          v2: { questions: [] },
        },
      },
    });
    expect(screen.getByRole('checkbox', { name: 'Fragen zufällig anordnen' })).toBeChecked();
  });

  it('reflects instance switch when randomizeQuestions differs per instance', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor({
      initialData: {
        type: 'simple-quiz',
        title: 'Inst-Level',
        rules: [],
        instances: {
          v1: { randomizeQuestions: true, questions: [] },
          v2: { questions: [] },
        },
      },
    });
    expect(screen.getByRole('checkbox', { name: 'Fragen zufällig anordnen' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'v2' }));
    expect(screen.getByRole('checkbox', { name: 'Fragen zufällig anordnen' })).not.toBeChecked();
  });

  it('writes randomizeQuestions back to instance when it lives there', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor({
      initialData: {
        type: 'simple-quiz',
        title: 'Inst-Level',
        rules: [],
        instances: {
          v1: { randomizeQuestions: true, questions: [] },
        },
      },
    });

    await user.click(screen.getByRole('checkbox', { name: 'Fragen zufällig anordnen' }));

    act(() => { vi.advanceTimersByTime(800); });

    await waitFor(() => {
      expect(mockSaveGame).toHaveBeenCalledWith(
        'my-quiz.json',
        expect.objectContaining({
          instances: expect.objectContaining({
            v1: expect.not.objectContaining({ randomizeQuestions: true }),
          }),
        })
      );
    });
    const lastCall = mockSaveGame.mock.calls.at(-1)!;
    const saved = lastCall[1] as { randomizeQuestions?: boolean };
    expect(saved.randomizeQuestions).toBeUndefined();
  });

  it('renders initialInstance tab as active when provided', () => {
    renderEditor({ initialInstance: 'v2' });
    expect(screen.getByText('Instanz: v2')).toBeInTheDocument();
  });

  it('shows RulesEditor in Grundeinstellungen card', () => {
    renderEditor();
    expect(screen.getByRole('button', { name: /Hinzufügen/ })).toBeInTheDocument();
  });
});
