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
    expect(screen.getByText(/Spieler & Einstellungen/)).toBeInTheDocument();
  });

  it('meta section is hidden by default', () => {
    renderEditor('simple-quiz', { questions: [] });
    expect(screen.queryByText('Spieler (kommagetrennt, optional)')).not.toBeInTheDocument();
  });

  it('shows meta section when toggle button is clicked', async () => {
    const user = userEvent.setup();
    renderEditor('simple-quiz', { questions: [] });
    await user.click(screen.getByText(/▶ Spieler & Einstellungen/));
    expect(screen.getByText('Spieler (kommagetrennt, optional)')).toBeInTheDocument();
    expect(screen.getByText('Titel-Überschreibung (optional)')).toBeInTheDocument();
    expect(screen.getByText(/Regeln.*Überschreibung/)).toBeInTheDocument();
  });

  it('collapses meta section when toggle button is clicked again', async () => {
    const user = userEvent.setup();
    renderEditor('simple-quiz', { questions: [] });
    await user.click(screen.getByText(/▶ Spieler & Einstellungen/));
    expect(screen.getByText('Spieler (kommagetrennt, optional)')).toBeInTheDocument();
    await user.click(screen.getByText(/▲ Spieler & Einstellungen/));
    expect(screen.queryByText('Spieler (kommagetrennt, optional)')).not.toBeInTheDocument();
  });

  it('shows dot indicator in meta toggle when _players is set', () => {
    renderEditor('simple-quiz', { questions: [], _players: 'Alice' });
    expect(screen.getByText(/Spieler & Einstellungen ●/)).toBeInTheDocument();
  });

  it('shows dot indicator when title override is set', () => {
    renderEditor('simple-quiz', { questions: [], title: 'Override' });
    expect(screen.getByText(/Spieler & Einstellungen ●/)).toBeInTheDocument();
  });

  it('shows dot indicator when instance rules are set', () => {
    renderEditor('simple-quiz', { questions: [], rules: ['Rule 1'] });
    expect(screen.getByText(/Spieler & Einstellungen ●/)).toBeInTheDocument();
  });

  it('no dot indicator when no meta values set', () => {
    renderEditor('simple-quiz', { questions: [] });
    const button = screen.getByText(/Spieler & Einstellungen/);
    expect(button.textContent).not.toContain('●');
  });

  it('calls onChange when _players input changes (meta section open)', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <InstanceEditor gameType="simple-quiz" instance={{ questions: [] }} onChange={onChange} onGoToAssets={vi.fn()} />
    );
    await user.click(screen.getByText(/▶ Spieler & Einstellungen/));
    const playersInput = screen.getByPlaceholderText('Alice, Bob, Clara, ...');
    fireEvent.change(playersInput, { target: { value: 'Alice' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ _players: ['Alice'] }));
  });

  it('calls onChange when title override input changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <InstanceEditor gameType="simple-quiz" instance={{ questions: [] }} onChange={onChange} onGoToAssets={vi.fn()} />
    );
    await user.click(screen.getByText(/▶ Spieler & Einstellungen/));
    const titleInput = screen.getByPlaceholderText('Leer lassen für Standard-Titel');
    fireEvent.change(titleInput, { target: { value: 'My Override' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'My Override' }));
  });

  it('renders "Fragen" label', () => {
    renderEditor('simple-quiz', { questions: [] });
    expect(screen.getByText('Fragen')).toBeInTheDocument();
  });

  // Game type routing tests
  it('renders SimpleQuizForm for simple-quiz type', () => {
    renderEditor('simple-quiz', { questions: [] });
    expect(screen.getByRole('button', { name: /Frage hinzufügen/ })).toBeInTheDocument();
  });

  it('renders GuessingGameForm for guessing-game type', () => {
    renderEditor('guessing-game', { questions: [] });
    expect(screen.getByRole('button', { name: /Frage hinzufügen/ })).toBeInTheDocument();
  });

  it('renders FinalQuizForm for final-quiz type', () => {
    renderEditor('final-quiz', { questions: [] });
    expect(screen.getByRole('button', { name: /Frage hinzufügen/ })).toBeInTheDocument();
  });

  it('renders Q1Form for q1 type', () => {
    renderEditor('q1', { questions: [] });
    expect(screen.getByRole('button', { name: /Frage hinzufügen/ })).toBeInTheDocument();
  });

  it('renders FourStatementsForm for four-statements type', () => {
    renderEditor('four-statements', { questions: [] });
    expect(screen.getByRole('button', { name: /Frage hinzufügen/ })).toBeInTheDocument();
  });

  it('renders FactOrFakeForm for fact-or-fake type', () => {
    renderEditor('fact-or-fake', { questions: [] });
    expect(screen.getByRole('button', { name: /Aussage hinzufügen/ })).toBeInTheDocument();
  });

  it('renders QuizjagdForm for quizjagd type', () => {
    renderEditor('quizjagd', { questions: [], questionsPerTeam: 10 });
    expect(screen.getByRole('button', { name: /Frage hinzufügen/ })).toBeInTheDocument();
    expect(screen.getByText('Fragen/Team:')).toBeInTheDocument();
  });

  it('renders AudioGuessForm for audio-guess type', () => {
    renderEditor('audio-guess', { questions: [{ answer: 'Test', audio: '/audio/test.m4a' }] });
    expect(screen.getByRole('button', { name: /Frage hinzufügen/ })).toBeInTheDocument();
  });

});
