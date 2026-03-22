import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GameEditor from '@/components/backend/GameEditor';

const mockSaveGame = vi.fn().mockResolvedValue(undefined);

vi.mock('@/services/backendApi', () => ({
  saveGame: (...args: unknown[]) => mockSaveGame(...args),
  fetchAssets: vi.fn().mockResolvedValue({ files: [], subfolders: [] }),
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
    expect(badge?.textContent).toBe('simple-quiz');
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
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('simple-quiz');
  });

  it('renders all game type options in select', () => {
    renderEditor();
    const select = screen.getByRole('combobox');
    const options = Array.from(select.querySelectorAll('option'));
    const values = options.map(o => o.value);
    expect(values).toContain('simple-quiz');
    expect(values).toContain('guessing-game');
    expect(values).toContain('final-quiz');
    expect(values).toContain('audio-guess');
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
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor({ initialData: { type: 'simple-quiz', title: 'Q', rules: [], instances: { v1: { questions: [] } } } });
    expect(screen.queryByRole('button', { name: 'Instanz löschen' })).not.toBeInTheDocument();
  });

  it('deletes instance on confirmed delete', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();
    // v1 is active by default
    await user.click(screen.getByRole('button', { name: 'Instanz löschen' }));
    expect(screen.queryByRole('button', { name: 'v1' })).not.toBeInTheDocument();
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

    const select = screen.getByRole('combobox');
    await user.selectOptions(select, 'guessing-game');

    expect((select as HTMLSelectElement).value).toBe('guessing-game');
  });

  it('toggles randomizeQuestions when checkbox is clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it('saves with randomizeQuestions=true when checkbox is enabled', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderEditor();

    await user.click(screen.getByRole('checkbox'));

    act(() => { vi.advanceTimersByTime(800); });

    await waitFor(() => {
      expect(mockSaveGame).toHaveBeenCalledWith(
        'my-quiz.json',
        expect.objectContaining({ randomizeQuestions: true })
      );
    });
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
