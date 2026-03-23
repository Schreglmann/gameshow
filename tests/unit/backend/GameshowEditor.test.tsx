import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GameshowEditor from '@/components/backend/GameshowEditor';
import type { GameshowConfig, GameFileSummary } from '@/types/config';

const mockFetchGames = vi.fn();

vi.mock('@/services/backendApi', () => ({
  fetchGames: (...args: unknown[]) => mockFetchGames(...args),
}));

const gs: GameshowConfig = {
  name: 'My Gameshow',
  gameOrder: ['quiz-1/v1', 'audio-game'],
};

const availableGames: GameFileSummary[] = [
  { fileName: 'quiz-1', type: 'simple-quiz', title: 'Quiz 1', instances: ['v1', 'v2'], isSingleInstance: false },
  { fileName: 'audio-game', type: 'audio-guess', title: 'Audio Game', instances: [], isSingleInstance: true },
];

function renderEditor(props?: Partial<Parameters<typeof GameshowEditor>[0]>) {
  return render(
    <GameshowEditor
      id="gs1"
      gameshow={gs}
      isActive={false}
      onSetActive={vi.fn()}
      onChange={vi.fn()}
      onDelete={vi.fn()}
      {...props}
    />
  );
}

describe('GameshowEditor', () => {
  beforeEach(() => {
    mockFetchGames.mockResolvedValue(availableGames);
  });

  it('renders gameshow name input', () => {
    renderEditor();
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
    expect(screen.getByText(/1 Spiel$/)).toBeInTheDocument();
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

  it('renders "+ Hinzufügen" button', () => {
    renderEditor();
    expect(screen.getByRole('button', { name: '+ Hinzufügen' })).toBeInTheDocument();
  });

  it('"+ Hinzufügen" button is disabled when no game is selected', async () => {
    renderEditor({ gameshow: { name: 'Empty', gameOrder: [] } });
    await waitFor(() => {
      expect(mockFetchGames).toHaveBeenCalled();
    });
    expect(screen.getByRole('button', { name: '+ Hinzufügen' })).toBeDisabled();
  });

  it('calls onChange with updated name when name input changes', () => {
    const onChange = vi.fn();
    renderEditor({ onChange });
    const nameInput = screen.getByDisplayValue('My Gameshow');
    fireEvent.change(nameInput, { target: { value: 'New Name' } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'New Name' })
    );
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

  it('adds single-instance game to order when selected and + button clicked', async () => {
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
    // Use mouseDown to select (as per the component)
    fireEvent.mouseDown(screen.getByText('audio-game'));
    await waitFor(() => {
      // After selecting single-instance game, add button should be enabled
      expect(screen.getByRole('button', { name: '+ Hinzufügen' })).not.toBeDisabled();
    });
    await user.click(screen.getByRole('button', { name: '+ Hinzufügen' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ gameOrder: ['audio-game'] })
    );
  });
});

