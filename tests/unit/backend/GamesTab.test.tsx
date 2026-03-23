import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GamesTab from '@/components/backend/GamesTab';
import type { GameFileSummary } from '@/types/config';

const mockFetchGames = vi.fn();
const mockFetchGame = vi.fn();
const mockCreateGame = vi.fn();
const mockDeleteGame = vi.fn();
const mockSaveGame = vi.fn();
const mockFetchAssets = vi.fn();

vi.mock('@/services/backendApi', () => ({
  fetchGames: (...args: unknown[]) => mockFetchGames(...args),
  fetchGame: (...args: unknown[]) => mockFetchGame(...args),
  createGame: (...args: unknown[]) => mockCreateGame(...args),
  deleteGame: (...args: unknown[]) => mockDeleteGame(...args),
  saveGame: (...args: unknown[]) => mockSaveGame(...args),
  fetchAssets: (...args: unknown[]) => mockFetchAssets(...args),
}));

const sampleGames: GameFileSummary[] = [
  { fileName: 'quiz-1', type: 'simple-quiz', title: 'Quiz 1', instances: ['v1', 'v2'], isSingleInstance: false },
  { fileName: 'audio-game', type: 'audio-guess', title: 'Audio Game', instances: [], isSingleInstance: true },
  { fileName: '_template', type: 'simple-quiz', title: 'Template', instances: [], isSingleInstance: true },
];

const gameData = {
  type: 'simple-quiz',
  title: 'Quiz 1',
  rules: [],
  instances: { v1: { questions: [] }, v2: { questions: [] } },
};

function renderGamesTab(props?: Partial<Parameters<typeof GamesTab>[0]>) {
  return render(
    <GamesTab
      onGoToAssets={vi.fn()}
      onNavigate={vi.fn()}
      {...props}
    />
  );
}

describe('GamesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchGames.mockResolvedValue(sampleGames);
    mockFetchGame.mockResolvedValue(gameData);
    mockCreateGame.mockResolvedValue(undefined);
    mockDeleteGame.mockResolvedValue(undefined);
    mockSaveGame.mockResolvedValue(undefined);
    mockFetchAssets.mockResolvedValue({ files: [], subfolders: [] });
  });

  it('shows loading state initially', () => {
    mockFetchGames.mockReturnValue(new Promise(() => {}));
    renderGamesTab();
    expect(screen.getByText('Lade Spiele...')).toBeInTheDocument();
  });

  it('renders game list after loading', async () => {
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByText('Quiz 1')).toBeInTheDocument();
      expect(screen.getByText('Audio Game')).toBeInTheDocument();
    });
  });

  it('filters out games starting with underscore', async () => {
    renderGamesTab();
    await waitFor(() => {
      expect(screen.queryByText('Template')).not.toBeInTheDocument();
    });
  });

  it('shows empty state when no games found', async () => {
    mockFetchGames.mockResolvedValue([]);
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByText('Keine Spiele gefunden')).toBeInTheDocument();
    });
  });

  it('renders game type badges', async () => {
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByText('simple-quiz')).toBeInTheDocument();
      expect(screen.getByText('audio-guess')).toBeInTheDocument();
    });
  });

  it('renders instances for multi-instance games', async () => {
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByText('v1, v2')).toBeInTheDocument();
    });
  });

  it('renders dash for single-instance games', async () => {
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByText('—')).toBeInTheDocument();
    });
  });

  it('renders "Spiele" tab title', async () => {
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByText('Spiele')).toBeInTheDocument();
    });
  });

  it('renders "+ Neues Spiel" button', async () => {
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Neues Spiel' })).toBeInTheDocument();
    });
  });

  it('renders delete buttons for each visible game', async () => {
    renderGamesTab();
    await waitFor(() => {
      const deleteButtons = screen.getAllByTitle('Löschen');
      expect(deleteButtons).toHaveLength(2); // quiz-1 and audio-game (not _template)
    });
  });

  it('opens GameEditor when game row is clicked', async () => {
    const user = userEvent.setup();
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByText('Quiz 1')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Quiz 1'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /← Zurück/ })).toBeInTheDocument();
    });
  });

  it('calls onNavigate with fileName when game is opened', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    renderGamesTab({ onNavigate });
    await waitFor(() => {
      expect(screen.getByText('Quiz 1')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Quiz 1'));
    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith('quiz-1');
    });
  });

  it('shows error message when fetchGames fails', async () => {
    mockFetchGames.mockRejectedValue(new Error('Network error'));
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByText(/Fehler: Network error/)).toBeInTheDocument();
    });
  });

  it('shows error message when opening a game fails', async () => {
    mockFetchGame.mockRejectedValue(new Error('Load error'));
    const user = userEvent.setup();
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByText('Quiz 1')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Quiz 1'));
    await waitFor(() => {
      expect(screen.getByText(/Fehler beim Laden: Load error/)).toBeInTheDocument();
    });
  });

  it('opens new game modal when "+ Neues Spiel" is clicked', async () => {
    const user = userEvent.setup();
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Neues Spiel' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: '+ Neues Spiel' }));
    expect(screen.getByText('Neues Spiel erstellen')).toBeInTheDocument();
  });

  it('new game modal has filename input', async () => {
    const user = userEvent.setup();
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Neues Spiel' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: '+ Neues Spiel' }));
    expect(screen.getByPlaceholderText('mein-neues-spiel')).toBeInTheDocument();
  });

  it('new game modal shows all 8 game type options', async () => {
    const user = userEvent.setup();
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Neues Spiel' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: '+ Neues Spiel' }));
    expect(screen.getByRole('button', { name: 'simple-quiz' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'guessing-game' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'audio-guess' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'quizjagd' })).toBeInTheDocument();
  });

  it('sanitizes filename input to lowercase with dashes', async () => {
    const user = userEvent.setup();
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Neues Spiel' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: '+ Neues Spiel' }));
    const filenameInput = screen.getByPlaceholderText('mein-neues-spiel');
    await user.type(filenameInput, 'My New Game!');
    expect((filenameInput as HTMLInputElement).value).toBe('my-new-game-');
  });

  it('Erstellen button is disabled when filename is empty', async () => {
    const user = userEvent.setup();
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Neues Spiel' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: '+ Neues Spiel' }));
    expect(screen.getByRole('button', { name: 'Erstellen' })).toBeDisabled();
  });

  it('Erstellen button is enabled when filename is filled', async () => {
    const user = userEvent.setup();
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Neues Spiel' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: '+ Neues Spiel' }));
    await user.type(screen.getByPlaceholderText('mein-neues-spiel'), 'my-quiz');
    expect(screen.getByRole('button', { name: 'Erstellen' })).not.toBeDisabled();
  });

  it('closes modal on Abbrechen click', async () => {
    const user = userEvent.setup();
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Neues Spiel' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: '+ Neues Spiel' }));
    expect(screen.getByText('Neues Spiel erstellen')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByText('Neues Spiel erstellen')).not.toBeInTheDocument();
  });

  it('closes modal on overlay click', async () => {
    const user = userEvent.setup();
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Neues Spiel' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: '+ Neues Spiel' }));
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) await user.click(overlay);
    expect(screen.queryByText('Neues Spiel erstellen')).not.toBeInTheDocument();
  });

  it('creates game and opens editor when Erstellen is clicked', async () => {
    const user = userEvent.setup();
    mockFetchGame.mockResolvedValueOnce({ type: 'simple-quiz', title: 'New Quiz', rules: [], instances: { v1: { questions: [] } } });
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Neues Spiel' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: '+ Neues Spiel' }));
    await user.type(screen.getByPlaceholderText('mein-neues-spiel'), 'new-quiz');
    await user.click(screen.getByRole('button', { name: 'Erstellen' }));
    await waitFor(() => {
      expect(mockCreateGame).toHaveBeenCalledWith('new-quiz', expect.objectContaining({ type: 'simple-quiz' }));
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /← Zurück/ })).toBeInTheDocument();
    });
  });

  it('shows error when create fails', async () => {
    mockCreateGame.mockRejectedValueOnce(new Error('Create failed'));
    const user = userEvent.setup();
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Neues Spiel' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: '+ Neues Spiel' }));
    await user.type(screen.getByPlaceholderText('mein-neues-spiel'), 'new-quiz');
    await user.click(screen.getByRole('button', { name: 'Erstellen' }));
    await waitFor(() => {
      expect(screen.getByText(/Create failed/)).toBeInTheDocument();
    });
  });

  it('calls deleteGame API when delete button is clicked', async () => {
    const user = userEvent.setup();
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getAllByTitle('Löschen')).toHaveLength(2);
    });
    await user.click(screen.getAllByTitle('Löschen')[0]);
    await waitFor(() => {
      expect(mockDeleteGame).toHaveBeenCalledWith('quiz-1');
    });
  });

  it('shows success message after successful delete', async () => {
    const user = userEvent.setup();
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getAllByTitle('Löschen')).toHaveLength(2);
    });
    await user.click(screen.getAllByTitle('Löschen')[0]);
    await waitFor(() => {
      expect(screen.getByText(/gelöscht/)).toBeInTheDocument();
    });
  });

  it('shows error message when delete fails', async () => {
    mockDeleteGame.mockRejectedValueOnce(new Error('Delete error'));
    const user = userEvent.setup();
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getAllByTitle('Löschen')).toHaveLength(2);
    });
    await user.click(screen.getAllByTitle('Löschen')[0]);
    await waitFor(() => {
      expect(screen.getByText(/Delete error/)).toBeInTheDocument();
    });
  });

  it('requires confirm before deleting', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getAllByTitle('Löschen')).toHaveLength(2);
    });
    await user.click(screen.getAllByTitle('Löschen')[0]);
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('wirklich löschen'));
    confirmSpy.mockRestore();
  });

  it('does NOT delete when confirm is cancelled', async () => {
    window.confirm = vi.fn(() => false);
    const user = userEvent.setup();
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getAllByTitle('Löschen')).toHaveLength(2);
    });
    await user.click(screen.getAllByTitle('Löschen')[0]);
    expect(mockDeleteGame).not.toHaveBeenCalled();
    window.confirm = () => true;
  });

  it('opens editor for initialFile when provided', async () => {
    renderGamesTab({ initialFile: 'quiz-1' });
    await waitFor(() => {
      expect(mockFetchGame).toHaveBeenCalledWith('quiz-1');
      expect(screen.getByRole('button', { name: /← Zurück/ })).toBeInTheDocument();
    });
  });

  it('calls onNavigate with null when editor back button is clicked', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    renderGamesTab({ onNavigate });
    await waitFor(() => {
      expect(screen.getByText('Quiz 1')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Quiz 1'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /← Zurück/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /← Zurück/ }));
    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith(null);
    });
  });

  it('renders list header columns', async () => {
    renderGamesTab();
    await waitFor(() => {
      expect(screen.getByText('Titel')).toBeInTheDocument();
      expect(screen.getByText('Typ')).toBeInTheDocument();
      expect(screen.getByText('Instanzen')).toBeInTheDocument();
    });
  });
});
