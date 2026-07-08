import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RankingForm from '@/components/backend/questions/RankingForm';
import type { RankingQuestion } from '@/types/config';

vi.mock('@/services/backendApi', () => ({
  fetchAssets: vi.fn().mockResolvedValue({ files: [], subfolders: [] }),
}));

const sample: RankingQuestion = {
  question: 'Top 3 der umsatzstärksten Filme 2023',
  answers: ['Barbie', 'Mario', 'Oppenheimer'],
};

/** Answers are collapsed by default — click the header to reveal the editable list. */
function expandAnswers(idx = 0) {
  const headers = screen.getAllByText(/Antworten in korrekter Reihenfolge/);
  fireEvent.click(headers[idx]!);
}

describe('RankingForm', () => {
  it('renders empty state with only the ghost row when no questions', () => {
    render(<RankingForm questions={[]} onChange={vi.fn()} />);
    expect(screen.getByText('Neu')).toBeInTheDocument();
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
    expect(screen.queryByText('Beispiel')).not.toBeInTheDocument();
  });

  it('collapses answers by default, showing a compact preview', () => {
    render(<RankingForm questions={[sample]} onChange={vi.fn()} />);
    // No answer inputs rendered while collapsed
    expect(screen.queryByDisplayValue('Barbie')).not.toBeInTheDocument();
    // Compact, numbered, dot-separated preview is shown instead
    expect(screen.getByText('1. Barbie · 2. Mario · 3. Oppenheimer')).toBeInTheDocument();
    // Header reflects the answer count
    expect(screen.getByText(/Antworten in korrekter Reihenfolge \(3\)/)).toBeInTheDocument();
  });

  it('expands the answer list when the header is clicked', () => {
    render(<RankingForm questions={[sample]} onChange={vi.fn()} />);
    expandAnswers();
    expect(screen.getByDisplayValue('Barbie')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Mario')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Oppenheimer')).toBeInTheDocument();
  });

  it('updates an answer at the correct index', () => {
    const onChange = vi.fn();
    render(<RankingForm questions={[sample]} onChange={onChange} />);
    expandAnswers();
    fireEvent.change(screen.getByDisplayValue('Mario'), { target: { value: 'Super Mario' } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ answers: ['Barbie', 'Super Mario', 'Oppenheimer'] }),
    ]);
  });

  it('shows an auto-appended empty slot after the last real answer', () => {
    render(<RankingForm questions={[sample]} onChange={vi.fn()} />);
    expandAnswers();
    const inputs = screen.getAllByPlaceholderText(/^(Antwort \d|Weitere Antwort)/);
    expect(inputs).toHaveLength(sample.answers.length + 1);
    expect(screen.getByPlaceholderText(/Weitere Antwort/)).toHaveValue('');
  });

  it('does NOT render an add-answer button (trailing row replaces it)', () => {
    render(<RankingForm questions={[sample]} onChange={vi.fn()} />);
    expandAnswers();
    expect(screen.queryByRole('button', { name: /Antwort hinzufügen/ })).not.toBeInTheDocument();
  });

  it('typing into the trailing slot appends the answer (no manual add)', () => {
    const onChange = vi.fn();
    render(<RankingForm questions={[sample]} onChange={onChange} />);
    expandAnswers();
    const trailing = screen.getByPlaceholderText(/Weitere Antwort/);
    fireEvent.change(trailing, { target: { value: 'Fast X' } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ answers: ['Barbie', 'Mario', 'Oppenheimer', 'Fast X'] }),
    ]);
  });

  it('clearing the last answer strips the trailing empty from onChange', () => {
    const onChange = vi.fn();
    render(<RankingForm questions={[sample]} onChange={onChange} />);
    expandAnswers();
    fireEvent.change(screen.getByDisplayValue('Oppenheimer'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ answers: ['Barbie', 'Mario'] }),
    ]);
  });

  it('hides reorder/remove buttons on the trailing virtual slot', () => {
    render(<RankingForm questions={[sample]} onChange={vi.fn()} />);
    expandAnswers();
    expect(screen.getAllByTitle('Nach oben')).toHaveLength(sample.answers.length);
    expect(screen.getAllByTitle('Nach unten')).toHaveLength(sample.answers.length);
    expect(screen.getAllByTitle('Antwort entfernen')).toHaveLength(sample.answers.length);
  });

  it('removes the selected answer slot on ×', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RankingForm questions={[sample]} onChange={onChange} />);
    expandAnswers();
    const removeButtons = screen.getAllByTitle('Antwort entfernen');
    await user.click(removeButtons[1]);
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ answers: ['Barbie', 'Oppenheimer'] }),
    ]);
  });

  it('reorders answers with the up/down arrow buttons', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RankingForm questions={[sample]} onChange={onChange} />);
    expandAnswers();
    const upButtons = screen.getAllByTitle('Nach oben');
    // Move "Mario" up to swap with "Barbie"
    await user.click(upButtons[1]);
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ answers: ['Mario', 'Barbie', 'Oppenheimer'] }),
    ]);
  });

  it('creates a new question by typing into the ghost row', () => {
    const onChange = vi.fn();
    render(<RankingForm questions={[]} onChange={onChange} />);
    const ghostQuestionInput = screen.getByPlaceholderText(/Neue Frage – einfach hier tippen/);
    fireEvent.change(ghostQuestionInput, { target: { value: 'Neue Frage' } });
    expect(onChange).toHaveBeenCalledWith([
      { question: 'Neue Frage', answers: [] },
    ]);
  });

  it('updates the question text', () => {
    const onChange = vi.fn();
    render(<RankingForm questions={[sample]} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue(sample.question), { target: { value: 'Neue Frage' } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ question: 'Neue Frage' }),
    ]);
  });

  it('updates the optional topic, clearing it when emptied', () => {
    const onChange = vi.fn();
    render(<RankingForm questions={[{ ...sample, topic: 'alt' }]} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('alt'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ topic: undefined }),
    ]);
  });

  it('renders question numbers (Beispiel for index 0, #N for the rest)', () => {
    render(<RankingForm questions={[sample, { ...sample, question: 'Q2' }]} onChange={vi.fn()} />);
    expect(screen.getByText('Beispiel')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('removes a question on confirmed delete', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    window.confirm = vi.fn(() => true);
    const two = [sample, { ...sample, question: 'Q2' }];
    render(<RankingForm questions={two} onChange={onChange} />);
    const deleteButtons = screen.getAllByTitle('Löschen');
    await user.click(deleteButtons[0]);
    expect(onChange).toHaveBeenCalledWith([two[1]]);
  });

  it('duplicates a question with a deep-cloned answers array', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RankingForm questions={[sample]} onChange={onChange} />);
    await user.click(screen.getByTitle('Duplizieren'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [nextQuestions] = onChange.mock.calls[0];
    expect(nextQuestions).toHaveLength(2);
    expect(nextQuestions[1].answers).toEqual(sample.answers);
    // Deep clone: mutating the new array shouldn't touch the original
    expect(nextQuestions[1].answers).not.toBe(sample.answers);
  });

  it('hides the audio trigger toggle until an answer audio is set', () => {
    render(<RankingForm questions={[sample]} onChange={vi.fn()} />);
    expect(screen.queryByText(/Erst abspielen, wenn alle Antworten/)).not.toBeInTheDocument();
  });

  it('shows the trigger toggle when answerAudio is set and stores "all" when checked', () => {
    const onChange = vi.fn();
    render(<RankingForm questions={[{ ...sample, answerAudio: '/audio/x.mp3' }]} onChange={onChange} />);
    const toggle = screen.getByText(/Erst abspielen, wenn alle Antworten/);
    expect(toggle).toBeInTheDocument();
    const checkbox = toggle.closest('label')!.querySelector('input[type="checkbox"]')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ answerAudioTrigger: 'all' }),
    ]);
  });

  it('clears the trigger back to first (undefined) when unchecked', () => {
    const onChange = vi.fn();
    render(<RankingForm questions={[{ ...sample, answerAudio: '/audio/x.mp3', answerAudioTrigger: 'all' }]} onChange={onChange} />);
    const toggle = screen.getByText(/Erst abspielen, wenn alle Antworten/);
    const checkbox = toggle.closest('label')!.querySelector('input[type="checkbox"]')!;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ answerAudioTrigger: undefined }),
    ]);
  });
});
