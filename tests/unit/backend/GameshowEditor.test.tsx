import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@/context/ThemeContext';
import GameshowEditor from '@/components/backend/GameshowEditor';
import type { GameshowConfig, GameFileSummary } from '@/types/config';

const mockFetchGames = vi.fn();

vi.mock('@/services/backendApi', () => ({
  fetchGames: (...args: unknown[]) => mockFetchGames(...args),
}));

vi.mock('@/services/api', () => ({
  fetchTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
  saveTheme: vi.fn().mockResolvedValue(undefined),
}));

const gs: GameshowConfig = {
  name: 'My Gameshow',
  gameOrder: ['quiz-1/v1', 'audio-game'],
};

const availableGames: GameFileSummary[] = [
  { fileName: 'quiz-1', type: 'simple-quiz', title: 'Quiz 1', instances: ['v1', 'v2'], isSingleInstance: false, questionCounts: { v1: 5, v2: 3 } },
  { fileName: 'audio-game', type: 'audio-guess', title: 'Audio Game', instances: [], isSingleInstance: true, questionCount: 4 },
];

function renderEditor(props?: Partial<Parameters<typeof GameshowEditor>[0]>) {
  return render(
    <ThemeProvider>
      <GameshowEditor
        id="gs1"
        gameshow={gs}
        isActive={false}
        expanded
        onToggleExpand={vi.fn()}
        onSetActive={vi.fn()}
        onChange={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        {...props}
      />
    </ThemeProvider>
  );
}

describe('GameshowEditor', () => {
  beforeEach(() => {
    mockFetchGames.mockResolvedValue(availableGames);
  });

  it('renders the gameshow name as plain text (not an always-on input)', () => {
    renderEditor();
    expect(screen.getByText('My Gameshow')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('My Gameshow')).not.toBeInTheDocument();
  });

  it('turns the name into an input when clicked', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByText('My Gameshow'));
    expect(screen.getByDisplayValue('My Gameshow')).toBeInTheDocument();
  });

  it('shows "Als aktiv setzen" button when not active', () => {
    renderEditor({ isActive: false });
    expect(screen.getByRole('button', { name: 'Als aktiv setzen' })).toBeInTheDocument();
  });

  it('shows "✓ Aktiv" badge when active', () => {
    renderEditor({ isActive: true });
    expect(screen.getByText('✓ Aktiv')).toBeInTheDocument();
  });

  it('does NOT show "Als aktiv setzen" when active', () => {
    renderEditor({ isActive: true });
    expect(screen.queryByRole('button', { name: 'Als aktiv setzen' })).not.toBeInTheDocument();
  });

  it('calls onSetActive when "Als aktiv setzen" button is clicked', async () => {
    const onSetActive = vi.fn();
    const user = userEvent.setup();
    renderEditor({ onSetActive });
    await user.click(screen.getByRole('button', { name: 'Als aktiv setzen' }));
    expect(onSetActive).toHaveBeenCalledOnce();
  });

  it('renders delete button for the gameshow', () => {
    renderEditor();
    expect(screen.getByTitle('Gameshow löschen')).toBeInTheDocument();
  });

  it('calls onDelete when delete button is clicked and confirmed', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    renderEditor({ onDelete });
    await user.click(screen.getByTitle('Gameshow löschen'));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('shows gameshow ID', () => {
    renderEditor();
    expect(screen.getByText('gs1')).toBeInTheDocument();
  });

  it('shows game count', () => {
    renderEditor();
    expect(screen.getByText(/2 Spiele/)).toBeInTheDocument();
  });

  it('shows singular "Spiel" for one game', () => {
    renderEditor({ gameshow: { name: 'Show', gameOrder: ['quiz-1/v1'] } });
    expect(screen.getByText(/1 Spiel\b/)).toBeInTheDocument();
  });

  it('shows the total number of questions across all games', async () => {
    // quiz-1/v1 has 5 questions + audio-game has 4 → 9 total.
    renderEditor();
    await waitFor(() => expect(mockFetchGames).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/9 Fragen/)).toBeInTheDocument());
  });

  it('shows singular "Frage" for a single question', async () => {
    mockFetchGames.mockResolvedValue([
      { fileName: 'solo', type: 'simple-quiz', title: 'Solo', instances: [], isSingleInstance: true, questionCount: 1 },
    ]);
    renderEditor({ gameshow: { name: 'Show', gameOrder: ['solo'] } });
    await waitFor(() => expect(screen.getByText(/1 Frage\b/)).toBeInTheDocument());
  });

  it('shows empty state when no games in order', () => {
    renderEditor({ gameshow: { name: 'Empty Show', gameOrder: [] } });
    expect(screen.getByText(/Keine Spiele/)).toBeInTheDocument();
  });

  it('renders game entries in game order list after loading', async () => {
    renderEditor();
    await waitFor(() => {
      expect(mockFetchGames).toHaveBeenCalled();
    });
  });

  it('renders add-game combobox', () => {
    renderEditor();
    expect(screen.getByPlaceholderText('Spiel hinzufügen...')).toBeInTheDocument();
  });

  it('commits the renamed name via onRename on blur', async () => {
    const onRename = vi.fn();
    const user = userEvent.setup();
    renderEditor({ onRename });
    await user.click(screen.getByText('My Gameshow'));
    const input = screen.getByDisplayValue('My Gameshow');
    await user.clear(input);
    await user.type(input, 'New Name');
    await user.tab(); // blur commits
    expect(onRename).toHaveBeenLastCalledWith('New Name');
  });

  it('commits the renamed name via onRename on Enter', async () => {
    const onRename = vi.fn();
    const user = userEvent.setup();
    renderEditor({ onRename });
    await user.click(screen.getByText('My Gameshow'));
    const input = screen.getByDisplayValue('My Gameshow');
    await user.clear(input);
    await user.type(input, 'Enter Name{Enter}');
    expect(onRename).toHaveBeenLastCalledWith('Enter Name');
  });

  it('cancels the rename on Escape without calling onRename', async () => {
    const onRename = vi.fn();
    const user = userEvent.setup();
    renderEditor({ onRename });
    await user.click(screen.getByText('My Gameshow'));
    const input = screen.getByDisplayValue('My Gameshow');
    await user.clear(input);
    await user.type(input, 'Discarded{Escape}');
    expect(onRename).not.toHaveBeenCalled();
    // Edit mode exits, falling back to the original plain-text name.
    expect(screen.getByText('My Gameshow')).toBeInTheDocument();
  });

  it('renders delete buttons for each game entry', async () => {
    renderEditor();
    await waitFor(() => {
      expect(mockFetchGames).toHaveBeenCalled();
    });
    const deleteButtons = screen.getAllByTitle('Entfernen');
    expect(deleteButtons).toHaveLength(2);
  });

  it('calls onChange removing entry when delete button is clicked and confirmed', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderEditor({ onChange });
    await waitFor(() => {
      expect(screen.getAllByTitle('Entfernen')).toHaveLength(2);
    });
    await user.click(screen.getAllByTitle('Entfernen')[0]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ gameOrder: ['audio-game'] })
    );
  });

  it('does NOT remove entry when confirm is cancelled', async () => {
    window.confirm = vi.fn(() => false);
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderEditor({ onChange });
    await waitFor(() => {
      expect(screen.getAllByTitle('Entfernen')).toHaveLength(2);
    });
    await user.click(screen.getAllByTitle('Entfernen')[0]);
    expect(onChange).not.toHaveBeenCalled();
    window.confirm = () => true;
  });

  it('shows add-game combobox with placeholder', () => {
    renderEditor();
    expect(screen.getByPlaceholderText('Spiel hinzufügen...')).toBeInTheDocument();
  });

  it('opens combobox dropdown when game search input is focused', async () => {
    const user = userEvent.setup();
    renderEditor({ gameshow: { name: 'Show', gameOrder: [] } });
    await waitFor(() => {
      expect(mockFetchGames).toHaveBeenCalled();
    });
    const addInput = screen.getByPlaceholderText('Spiel hinzufügen...');
    await user.click(addInput);
    await waitFor(() => {
      expect(screen.getByText('Quiz 1')).toBeInTheDocument();
    });
  });

  it('filters combobox by search query', async () => {
    const user = userEvent.setup();
    renderEditor({ gameshow: { name: 'Show', gameOrder: [] } });
    await waitFor(() => {
      expect(mockFetchGames).toHaveBeenCalled();
    });
    const addInput = screen.getByPlaceholderText('Spiel hinzufügen...');
    await user.type(addInput, 'Audio');
    await waitFor(() => {
      expect(screen.getByText('Audio Game')).toBeInTheDocument();
      expect(screen.queryByText('Quiz 1')).not.toBeInTheDocument();
    });
  });

  it('shows "Keine Treffer" when search has no results', async () => {
    const user = userEvent.setup();
    renderEditor({ gameshow: { name: 'Show', gameOrder: [] } });
    await waitFor(() => {
      expect(mockFetchGames).toHaveBeenCalled();
    });
    const addInput = screen.getByPlaceholderText('Spiel hinzufügen...');
    await user.type(addInput, 'zzznomatch');
    await waitFor(() => {
      expect(screen.getByText('Keine Treffer')).toBeInTheDocument();
    });
  });

  it('adds single-instance game to order when selected from combobox', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderEditor({ gameshow: { name: 'Show', gameOrder: [] }, onChange });
    await waitFor(() => {
      expect(mockFetchGames).toHaveBeenCalled();
    });
    const addInput = screen.getByPlaceholderText('Spiel hinzufügen...');
    await user.click(addInput);
    await waitFor(() => {
      expect(screen.getByText('Audio Game')).toBeInTheDocument();
    });
    // Selecting a game directly adds it to the order
    fireEvent.mouseDown(screen.getByText('audio-game'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ gameOrder: ['audio-game'] })
    );
  });

  it('Enter selects the single matching game without arrow-keying to it', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderEditor({ gameshow: { name: 'Show', gameOrder: [] }, onChange });
    await waitFor(() => {
      expect(mockFetchGames).toHaveBeenCalled();
    });
    const addInput = screen.getByPlaceholderText('Spiel hinzufügen...');
    // Query that narrows to exactly one result, then Enter — all in one focused session so
    // onFocus (which clears the query) doesn't reset between keystrokes. Enter with nothing
    // highlighted still adds the lone match.
    await user.type(addInput, 'Audio{Enter}');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ gameOrder: ['audio-game'] })
    );
  });

  // ── Collapse / expand ─────────────────────────────────────────────────────

  it('hides the body when collapsed but keeps the header visible', () => {
    renderEditor({ expanded: false });
    // Header controls stay visible.
    expect(screen.getByText('My Gameshow')).toBeInTheDocument();
    expect(screen.getByTitle('Gameshow löschen')).toBeInTheDocument();
    // Body is hidden: no players row, no add-game combobox, no ID meta line.
    expect(screen.queryByText('Spieler')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Spiel hinzufügen...')).not.toBeInTheDocument();
    expect(screen.queryByText('gs1')).not.toBeInTheDocument();
  });

  it('shows a game-count chip in the header when collapsed', () => {
    renderEditor({ expanded: false });
    expect(screen.getByText(/2 Spiele/)).toBeInTheDocument();
  });

  it('shows the body (players row) when expanded', () => {
    renderEditor({ expanded: true });
    expect(screen.getByText('Spieler')).toBeInTheDocument();
  });

  it('renders an "ausklappen" toggle when collapsed and "einklappen" when expanded', () => {
    const { unmount } = renderEditor({ expanded: false });
    expect(screen.getByRole('button', { name: 'Gameshow ausklappen' })).toBeInTheDocument();
    unmount();
    renderEditor({ expanded: true });
    expect(screen.getByRole('button', { name: 'Gameshow einklappen' })).toBeInTheDocument();
  });

  it('calls onToggleExpand when the disclosure chevron is clicked', async () => {
    const onToggleExpand = vi.fn();
    const user = userEvent.setup();
    renderEditor({ expanded: false, onToggleExpand });
    await user.click(screen.getByRole('button', { name: 'Gameshow ausklappen' }));
    expect(onToggleExpand).toHaveBeenCalledOnce();
  });

  // ── Planning overview: archive instance is always hidden ──────────────────

  it('hides the archive instance row in Planung even when other instances have questions', async () => {
    mockFetchGames.mockResolvedValue([
      { fileName: 'quiz-1', type: 'simple-quiz', title: 'Quiz 1', instances: ['v1', 'archive'], isSingleInstance: false, questionCounts: { v1: 5, archive: 2 } },
    ]);
    const user = userEvent.setup();
    renderEditor({ gameshow: { name: 'Show', gameOrder: [] } });
    await waitFor(() => expect(mockFetchGames).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: '▼ Planung' }));
    await waitFor(() => expect(screen.getByText('v1')).toBeInTheDocument());
    expect(screen.queryByText('archive')).not.toBeInTheDocument();
  });

  it('hides the archive instance row in Planung even when it is the only instance (fallback case)', async () => {
    mockFetchGames.mockResolvedValue([
      { fileName: 'quiz-1', type: 'simple-quiz', title: 'Quiz 1', instances: ['archive'], isSingleInstance: false, questionCounts: { archive: 2 } },
    ]);
    const user = userEvent.setup();
    renderEditor({ gameshow: { name: 'Show', gameOrder: [] } });
    await waitFor(() => expect(mockFetchGames).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: '▼ Planung' }));
    await waitFor(() => expect(screen.getByText('Keine Spiele gefunden')).toBeInTheDocument());
  });

  it('still adds a game directly via the "Spiel hinzufügen" picker when archive is its only instance', async () => {
    mockFetchGames.mockResolvedValue([
      { fileName: 'quiz-1', type: 'simple-quiz', title: 'Quiz 1', instances: ['archive'], isSingleInstance: false, questionCounts: { archive: 2 } },
    ]);
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderEditor({ gameshow: { name: 'Show', gameOrder: [] }, onChange });
    await waitFor(() => expect(mockFetchGames).toHaveBeenCalled());
    const addInput = screen.getByPlaceholderText('Spiel hinzufügen...');
    await user.click(addInput);
    await waitFor(() => expect(screen.getByText('Quiz 1')).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByText('Quiz 1'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ gameOrder: ['quiz-1/archive'] })
    );
  });
});

