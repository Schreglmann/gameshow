import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InstanceEditor from '@/components/backend/InstanceEditor';

vi.mock('@/services/backendApi', () => ({
  fetchAssets: vi.fn().mockResolvedValue({ files: [], subfolders: [] }),
}));

const noop = vi.fn();

function renderEditor(gameType: string, instance: Record<string, unknown> = {}) {
  return render(
    <InstanceEditor
      gameType={gameType as never}
      instance={instance}
      onChange={noop}
      onGoToAssets={noop}
    />
  );
}

describe('InstanceEditor', () => {
  beforeEach(() => {
    noop.mockClear();
  });

  it('renders meta toggle button', () => {
    renderEditor('simple-quiz', { questions: [] });
    expect(screen.getByText(/Einstellungen/)).toBeInTheDocument();
  });

  it('meta section is hidden by default', () => {
    renderEditor('simple-quiz', { questions: [] });
    expect(screen.queryByText('Titel-Überschreibung (optional)')).not.toBeInTheDocument();
  });

  it('shows meta section when toggle button is clicked', async () => {
    const user = userEvent.setup();
    renderEditor('simple-quiz', { questions: [] });
    await user.click(screen.getByText(/▶ Einstellungen/));
    expect(screen.getByText('Titel-Überschreibung (optional)')).toBeInTheDocument();
    expect(screen.getByText(/Regeln.*Überschreibung/)).toBeInTheDocument();
  });

  it('has no per-game "Spieler" field any more (derived from gameshow membership)', async () => {
    const user = userEvent.setup();
    renderEditor('simple-quiz', { questions: [] });
    await user.click(screen.getByText(/▶ Einstellungen/));
    expect(screen.queryByText(/Spieler \(eine Session pro Zeile/)).not.toBeInTheDocument();
  });

  it('collapses meta section when toggle button is clicked again', async () => {
    const user = userEvent.setup();
    renderEditor('simple-quiz', { questions: [] });
    await user.click(screen.getByText(/▶ Einstellungen/));
    expect(screen.getByText('Titel-Überschreibung (optional)')).toBeInTheDocument();
    await user.click(screen.getByText(/▲ Einstellungen/));
    expect(screen.queryByText('Titel-Überschreibung (optional)')).not.toBeInTheDocument();
  });

  it('shows dot indicator when title override is set', () => {
    renderEditor('simple-quiz', { questions: [], title: 'Override' });
    expect(screen.getByText(/Einstellungen ●/)).toBeInTheDocument();
  });

  it('shows dot indicator when instance rules are set', () => {
    renderEditor('simple-quiz', { questions: [], rules: ['Rule 1'] });
    expect(screen.getByText(/Einstellungen ●/)).toBeInTheDocument();
  });

  it('no dot indicator when no meta values set', () => {
    renderEditor('simple-quiz', { questions: [] });
    const button = screen.getByText(/Einstellungen/);
    expect(button.textContent).not.toContain('●');
  });

  it('calls onChange when title override input changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <InstanceEditor gameType="simple-quiz" instance={{ questions: [] }} onChange={onChange} onGoToAssets={vi.fn()} />
    );
    await user.click(screen.getByText(/▶ Einstellungen/));
    const titleInput = screen.getByPlaceholderText('Leer lassen für Standard-Titel');
    fireEvent.change(titleInput, { target: { value: 'My Override' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'My Override' }));
  });

  const usageFixture = [
    { gameshowId: 'g1', gameshowName: 'Gameshow 1', players: ['Anna', 'Ben'], planned: false },
    { gameshowId: 'g2', gameshowName: 'Vivid 2', players: ['Clara'], planned: true },
  ];

  it('shows which players already played (and have queued) this instance', () => {
    render(
      <InstanceEditor gameType="simple-quiz" instance={{ questions: [] }} onChange={noop} onGoToAssets={noop} instanceUsage={usageFixture} />
    );
    expect(screen.getByText('Bereits gespielt')).toBeInTheDocument();
    expect(screen.getByText(/Gameshow 1:/)).toBeInTheDocument();
    expect(screen.getByText('Anna')).toBeInTheDocument();
    expect(screen.getByText('Ben')).toBeInTheDocument();
    expect(screen.getByText('Eingeplant')).toBeInTheDocument();
    expect(screen.getByText('Clara')).toBeInTheDocument();
  });

  it('renders player names as plain text (not buttons) without onPlayerClick', () => {
    render(
      <InstanceEditor gameType="simple-quiz" instance={{ questions: [] }} onChange={noop} onGoToAssets={noop} instanceUsage={usageFixture} />
    );
    expect(screen.queryByRole('button', { name: 'Anna' })).not.toBeInTheDocument();
  });

  it('calls onPlayerClick when a player name is clicked (link to profile)', async () => {
    const onPlayerClick = vi.fn();
    const user = userEvent.setup();
    render(
      <InstanceEditor gameType="simple-quiz" instance={{ questions: [] }} onChange={noop} onGoToAssets={noop} instanceUsage={usageFixture} onPlayerClick={onPlayerClick} />
    );
    await user.click(screen.getByRole('button', { name: 'Anna' }));
    expect(onPlayerClick).toHaveBeenCalledWith('Anna');
  });

  it('renders no usage block when the instance was never used', () => {
    renderEditor('simple-quiz', { questions: [] });
    expect(screen.queryByText('Bereits gespielt')).not.toBeInTheDocument();
  });

  it('renders "Fragen" label', () => {
    renderEditor('simple-quiz', { questions: [] });
    expect(screen.getByText('Fragen')).toBeInTheDocument();
  });

  // Game type routing tests — assert each form's ghost row (or a form-specific landmark) is present.
  it('renders SimpleQuizForm for simple-quiz type', () => {
    renderEditor('simple-quiz', { questions: [] });
    expect(screen.getByPlaceholderText(/Neue Frage – einfach hier tippen/)).toBeInTheDocument();
  });

  it('renders GuessingGameForm for guessing-game type', () => {
    renderEditor('guessing-game', { questions: [] });
    expect(screen.getByText('Antwort (Zahl)')).toBeInTheDocument();
  });

  it('renders FinalQuizForm for final-quiz type', () => {
    renderEditor('final-quiz', { questions: [] });
    expect(screen.getByPlaceholderText(/Neue Frage – einfach hier tippen/)).toBeInTheDocument();
  });

  it('renders Q1Form for q1 type', () => {
    renderEditor('q1', { questions: [] });
    expect(screen.getByText(/Wahre Aussage 1/)).toBeInTheDocument();
  });

  it('renders FourStatementsForm for four-statements type', () => {
    renderEditor('four-statements', { questions: [] });
    expect(screen.getByText('Thema / Frage')).toBeInTheDocument();
  });

  it('renders FactOrFakeForm for fact-or-fake type', () => {
    renderEditor('fact-or-fake', { questions: [] });
    expect(screen.getByPlaceholderText(/Neue Aussage – einfach hier tippen/)).toBeInTheDocument();
  });

  it('renders QuizjagdForm for quizjagd type', () => {
    renderEditor('quizjagd', { questions: [], questionsPerTeam: 10 });
    expect(screen.getByText('Fragen/Team:')).toBeInTheDocument();
  });

  it('renders AudioGuessForm for audio-guess type', () => {
    renderEditor('audio-guess', { questions: [{ answer: 'Test', audio: '/audio/test.m4a' }] });
    expect(screen.getAllByText('Audio-Datei').length).toBeGreaterThan(0);
  });

});
