// See specs/gamemaster-run-of-show.md
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GamemasterScreen from '@/components/screens/GamemasterScreen';
import type { GamemasterAnswerData, GamemasterControlsData } from '@/types/game';

const sendCommandMock = vi.fn();

let mockAnswer: GamemasterAnswerData | null = null;
let mockControls: GamemasterControlsData | null = null;

vi.mock('@/hooks/useGamemasterSync', () => ({
  useGamemasterAnswer: () => mockAnswer,
  useGamemasterControls: () => mockControls,
  useSendGamemasterCommand: () => sendCommandMock,
  requestShowReemit: vi.fn(),
}));

// Inlined into the factory — `vi.mock` is hoisted above any top-level const.
vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: ['Eine Regel'],
    enabledJokers: [],
  }),
  fetchRunOfShow: vi.fn().mockResolvedValue({
    games: [
      { index: 0, gameId: 'allgemeinwissen/v1', title: 'Allgemeinwissen', type: 'simple-quiz' },
      { index: 1, gameId: 'quizjagd/v2', title: 'Quizjagd', type: 'quizjagd' },
      { index: 2, gameId: 'weg/v1', title: 'weg/v1', type: null, missing: true },
      { index: 3, gameId: 'finale', title: 'Finale', type: 'final-quiz' },
    ],
  }),
  fetchTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
  saveTheme: vi.fn().mockResolvedValue(undefined),
}));

function renderScreen() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <GameProvider>
          <GamemasterScreen />
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

/** Wait for the fetched running order to land. */
async function findRow(name: string | RegExp) {
  return await screen.findByRole('button', { name });
}

describe('Gamemaster run-of-show — list', () => {
  beforeEach(() => {
    localStorage.clear();
    sendCommandMock.mockClear();
    mockAnswer = null;
    mockControls = null;
  });

  it('lists the framing screens around every game, in order', async () => {
    renderScreen();
    await findRow(/Allgemeinwissen/);

    const rows = Array.from(document.querySelectorAll('.gm-runofshow-row'))
      .map(el => el.querySelector('.gm-runofshow-label')?.textContent);

    expect(rows).toEqual([
      'Startseite',
      'Regelwerk',
      'Allgemeinwissen',
      'Quizjagd',
      'weg/v1',
      'Finale',
      'Zusammenfassung',
    ]);
  });

  it('omits the Regelwerk row when the rules screen has nothing to show', async () => {
    const api = await import('@/services/api');
    vi.mocked(api.fetchSettings).mockResolvedValueOnce({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: [],
      enabledJokers: [],
    } as never);

    renderScreen();
    await findRow(/Allgemeinwissen/);

    // The whole assertion waits: the row depends on async GlobalSettings.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Regelwerk/ })).toBeNull();
    });
  });

  it('marks the current game and disables a missing one', async () => {
    mockControls = { controls: [], phase: 'game', gameIndex: 1 } as GamemasterControlsData;
    renderScreen();

    const current = await findRow(/Quizjagd/);
    expect(current.className).toContain('gm-runofshow-row--current');
    expect(current).toBeDisabled();
    expect(current.getAttribute('aria-current')).toBe('true');

    // A broken ref is flagged and not jumpable.
    const broken = await findRow(/weg\/v1/);
    expect(broken.textContent).toContain('Fehlt');
    expect(broken).toBeDisabled();

    // Earlier entries read as already played.
    const past = await findRow(/Allgemeinwissen/);
    expect(past.className).toContain('gm-runofshow-row--past');
  });

  // The highlight carries "you are here" on its own; position markers on the
  // rows were redundant with it.
  it('shows no "Jetzt" / "Danach" position markers', async () => {
    mockControls = { controls: [], phase: 'game', gameIndex: 1 } as GamemasterControlsData;
    renderScreen();
    await findRow(/Quizjagd/);

    const panelText = document.querySelector('.gm-runofshow')!.textContent!;
    expect(panelText).not.toContain('Jetzt');
    expect(panelText).not.toContain('Danach');
    // The broken-reference marker is a different thing and stays.
    expect(panelText).toContain('Fehlt');
  });

  // The collapsed gutter panel shows exactly previous / current / next. The
  // window is marked here and applied by CSS, so a half-clipped row can never
  // appear at the bottom of the strip; the drawer ignores the marking.
  it('marks previous / current / next as the collapsed window', async () => {
    mockControls = { controls: [], phase: 'game', gameIndex: 1 } as GamemasterControlsData;
    renderScreen();
    await findRow(/Quizjagd/);

    const labelled = [...document.querySelectorAll('.gm-runofshow-item--window')]
      .map(li => li.querySelector('.gm-runofshow-label')?.textContent);
    // gameIndex 1 → Quizjagd, so the window is Allgemeinwissen / Quizjagd / weg-v1.
    expect(labelled).toEqual(['Allgemeinwissen', 'Quizjagd', 'weg/v1']);
  });

  it('falls back to the first three entries when no position is known', async () => {
    renderScreen();
    await findRow(/Allgemeinwissen/);

    const labelled = [...document.querySelectorAll('.gm-runofshow-item--window')]
      .map(li => li.querySelector('.gm-runofshow-label')?.textContent);
    expect(labelled).toEqual(['Startseite', 'Regelwerk', 'Allgemeinwissen']);
  });

  it('tracks the framing screens by screenLabel rather than gameIndex', async () => {
    mockAnswer = {
      gameTitle: 'Game Show',
      questionNumber: 0,
      totalQuestions: 0,
      answer: '',
      screenLabel: 'Zusammenfassung',
    };
    // A stale gameIndex must lose to the screen label.
    mockControls = { controls: [], gameIndex: 1 } as GamemasterControlsData;
    renderScreen();

    const summary = await findRow(/Zusammenfassung/);
    expect(summary.className).toContain('gm-runofshow-row--current');
    expect((await findRow(/Quizjagd/)).className).not.toContain('gm-runofshow-row--current');
  });
});

describe('Gamemaster run-of-show — jumping', () => {
  beforeEach(() => {
    localStorage.clear();
    sendCommandMock.mockClear();
    mockAnswer = null;
    mockControls = null;
  });

  it('asks for confirmation and sends goto:game-<index> on confirm', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await findRow(/Finale/));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Zu «Finale» springen?');
    // Nothing is sent while the dialog is merely open.
    expect(sendCommandMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Springen' }));

    expect(sendCommandMock).toHaveBeenCalledWith('goto:game-3');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  // Regression: the dialog used to render inside the panel. The panel is a
  // fixed, transformed, overflow-scrolling container, and on iOS Safari that
  // ancestor becomes the containing block for a `position: fixed` child — the
  // overlay was sized and clipped to the sidebar, so on an iPad the menu greyed
  // out and no dialog appeared. It must live directly under <body>.
  it('renders the confirm dialog in a portal on document.body, not inside the panel', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await findRow(/Finale/));

    const overlay = document.querySelector('.gm-confirm-overlay')!;
    expect(overlay.parentElement).toBe(document.body);
    expect(document.querySelector('.gm-runofshow')!.contains(overlay)).toBe(false);
  });

  it('sends nothing when the jump is cancelled', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await findRow(/Finale/));
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sendCommandMock).not.toHaveBeenCalled();
  });

  it('addresses the framing screens by name', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await findRow(/Startseite/));
    await user.click(screen.getByRole('button', { name: 'Springen' }));

    expect(sendCommandMock).toHaveBeenCalledWith('goto:home');
  });
});

describe('Gamemaster run-of-show — expand toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    sendCommandMock.mockClear();
    mockAnswer = null;
    mockControls = null;
  });

  it('starts collapsed and persists the expanded choice per device', async () => {
    const user = userEvent.setup();
    renderScreen();

    const toggle = await screen.findByRole('button', { name: 'Alle Spiele zeigen' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.gm-runofshow')!.className).not.toContain('--expanded');

    await user.click(toggle);

    expect(document.querySelector('.gm-runofshow')!.className).toContain('--expanded');
    expect(localStorage.getItem('gm-ablauf-expanded')).toBe('true');
    // The control now offers the way back.
    expect(screen.getByRole('button', { name: 'Ablauf einklappen' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('restores the expanded state from localStorage on reload', async () => {
    localStorage.setItem('gm-ablauf-expanded', 'true');
    renderScreen();

    await screen.findByRole('button', { name: 'Ablauf einklappen' });
    expect(document.querySelector('.gm-runofshow')!.className).toContain('--expanded');
  });

  it('collapses again and persists that too', async () => {
    localStorage.setItem('gm-ablauf-expanded', 'true');
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole('button', { name: 'Ablauf einklappen' }));

    expect(document.querySelector('.gm-runofshow')!.className).not.toContain('--expanded');
    expect(localStorage.getItem('gm-ablauf-expanded')).toBe('false');
  });
});

describe('Gamemaster run-of-show — navigation suppression', () => {
  beforeEach(() => {
    localStorage.clear();
    sendCommandMock.mockClear();
    mockAnswer = null;
    mockControls = null;
  });

  it('does not advance the show while the confirm dialog is open', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await findRow(/Finale/));
    sendCommandMock.mockClear();

    // Space / arrows must not reach the show behind the dialog.
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });

    expect(sendCommandMock).not.toHaveBeenCalled();
  });

  it('does not advance the show when the dialog backdrop is clicked away', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await findRow(/Finale/));
    sendCommandMock.mockClear();

    const overlay = document.querySelector('.gm-confirm-overlay') as HTMLElement;
    await user.click(overlay);

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sendCommandMock).not.toHaveBeenCalled();
  });

  it('still advances the show once the dialog is gone', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(await findRow(/Finale/));
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    sendCommandMock.mockClear();

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    });

    expect(sendCommandMock).toHaveBeenCalledWith('nav-forward');
  });
});
