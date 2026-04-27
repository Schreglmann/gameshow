import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuizjagdForm from '@/components/backend/questions/QuizjagdForm';
import type { QuizjagdFlatQuestion } from '@/types/config';

const q1: QuizjagdFlatQuestion = { question: 'Easy Q', answer: 'Easy A', difficulty: 3 };
const q2: QuizjagdFlatQuestion = { question: 'Medium Q', answer: 'Medium A', difficulty: 5 };
const q3: QuizjagdFlatQuestion = { question: 'Hard Q', answer: 'Hard A', difficulty: 7 };

describe('QuizjagdForm', () => {
  it('renders empty state with only the ghost row', () => {
    render(<QuizjagdForm questions={[]} questionsPerTeam={10} onChange={vi.fn()} onChangeQuestionsPerTeam={vi.fn()} />);
    expect(screen.getByText('Neu')).toBeInTheDocument();
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
  });

  it('renders difficulty summary stats', () => {
    render(<QuizjagdForm questions={[q1, q2, q3]} questionsPerTeam={10} onChange={vi.fn()} onChangeQuestionsPerTeam={vi.fn()} />);
    expect(screen.getByText('Leicht: 1')).toBeInTheDocument();
    expect(screen.getByText('Mittel: 1')).toBeInTheDocument();
    expect(screen.getByText('Schwer: 1')).toBeInTheDocument();
  });

  it('counts multiple questions of same difficulty', () => {
    render(<QuizjagdForm
      questions={[q1, q1, q2]}
      questionsPerTeam={10}
      onChange={vi.fn()}
      onChangeQuestionsPerTeam={vi.fn()}
    />);
    expect(screen.getByText('Leicht: 2')).toBeInTheDocument();
    expect(screen.getByText('Mittel: 1')).toBeInTheDocument();
    expect(screen.getByText('Schwer: 0')).toBeInTheDocument();
  });

  it('renders questionsPerTeam input', () => {
    render(<QuizjagdForm questions={[]} questionsPerTeam={15} onChange={vi.fn()} onChangeQuestionsPerTeam={vi.fn()} />);
    const input = screen.getByDisplayValue('15');
    expect(input).toBeInTheDocument();
  });

  it('calls onChangeQuestionsPerTeam when value changes', () => {
    const onChangeQuestionsPerTeam = vi.fn();
    render(<QuizjagdForm questions={[]} questionsPerTeam={10} onChange={vi.fn()} onChangeQuestionsPerTeam={onChangeQuestionsPerTeam} />);
    const input = screen.getByDisplayValue('10');
    fireEvent.change(input, { target: { value: '20' } });
    expect(onChangeQuestionsPerTeam).toHaveBeenLastCalledWith(20);
  });

  it('renders question numbers for each question', () => {
    render(<QuizjagdForm questions={[q1, q2, q3]} questionsPerTeam={10} onChange={vi.fn()} onChangeQuestionsPerTeam={vi.fn()} />);
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText('#3')).toBeInTheDocument();
  });

  it('renders Frage and Antwort placeholders', () => {
    render(<QuizjagdForm questions={[q1]} questionsPerTeam={10} onChange={vi.fn()} onChangeQuestionsPerTeam={vi.fn()} />);
    expect(screen.getAllByPlaceholderText('Frage').length).toBeGreaterThan(0);
    expect(screen.getAllByPlaceholderText('Antwort').length).toBeGreaterThan(0);
  });

  it('renders question and answer values', () => {
    render(<QuizjagdForm questions={[q1]} questionsPerTeam={10} onChange={vi.fn()} onChangeQuestionsPerTeam={vi.fn()} />);
    expect(screen.getByDisplayValue('Easy Q')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Easy A')).toBeInTheDocument();
  });

  it('renders difficulty selector buttons (Leicht/Mittel/Schwer) for each question (incl. ghost row)', () => {
    render(<QuizjagdForm questions={[q1]} questionsPerTeam={10} onChange={vi.fn()} onChangeQuestionsPerTeam={vi.fn()} />);
    // 1 real question + 1 ghost row = 2 sets of difficulty buttons
    expect(screen.getAllByRole('button', { name: 'Leicht' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Mittel' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Schwer' })).toHaveLength(2);
  });

  it('calls onChange with difficulty=3 when Leicht is clicked on a real question', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<QuizjagdForm questions={[q2]} questionsPerTeam={10} onChange={onChange} onChangeQuestionsPerTeam={vi.fn()} />);
    await user.click(screen.getAllByRole('button', { name: 'Leicht' })[0]);
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ difficulty: 3 })]);
  });

  it('calls onChange with difficulty=5 when Mittel is clicked on a real question', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<QuizjagdForm questions={[q1]} questionsPerTeam={10} onChange={onChange} onChangeQuestionsPerTeam={vi.fn()} />);
    await user.click(screen.getAllByRole('button', { name: 'Mittel' })[0]);
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ difficulty: 5 })]);
  });

  it('calls onChange with difficulty=7 when Schwer is clicked on a real question', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<QuizjagdForm questions={[q1]} questionsPerTeam={10} onChange={onChange} onChangeQuestionsPerTeam={vi.fn()} />);
    await user.click(screen.getAllByRole('button', { name: 'Schwer' })[0]);
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ difficulty: 7 })]);
  });

  it('does not render Beispiel toggle (first per difficulty is implicit example)', () => {
    render(<QuizjagdForm questions={[q1]} questionsPerTeam={10} onChange={vi.fn()} onChangeQuestionsPerTeam={vi.fn()} />);
    expect(screen.queryByText('Beispiel')).not.toBeInTheDocument();
  });

  it('creates a new question by typing into the ghost row', () => {
    const onChange = vi.fn();
    render(<QuizjagdForm questions={[]} questionsPerTeam={10} onChange={onChange} onChangeQuestionsPerTeam={vi.fn()} />);
    const ghost = screen.getByPlaceholderText(/Neue Frage – einfach hier tippen/);
    fireEvent.change(ghost, { target: { value: 'My Q' } });
    expect(onChange).toHaveBeenCalledWith([{ question: 'My Q', answer: '', difficulty: 5 }]);
  });

  it('calls onChange with updated question text', () => {
    const onChange = vi.fn();
    render(<QuizjagdForm questions={[{ question: 'Old', answer: '', difficulty: 5 }]} questionsPerTeam={10} onChange={onChange} onChangeQuestionsPerTeam={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue('Old'), { target: { value: 'My question' } });
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ question: 'My question' })]);
  });

  it('calls onChange removing question on confirmed delete', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<QuizjagdForm questions={[q1, q2]} questionsPerTeam={10} onChange={onChange} onChangeQuestionsPerTeam={vi.fn()} />);
    const deleteButtons = screen.getAllByTitle('Löschen');
    await user.click(deleteButtons[0]);
    expect(onChange).toHaveBeenCalledWith([q2]);
  });

  it('does NOT delete when confirm is cancelled', async () => {
    window.confirm = vi.fn(() => false);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<QuizjagdForm questions={[q1]} questionsPerTeam={10} onChange={onChange} onChangeQuestionsPerTeam={vi.fn()} />);
    await user.click(screen.getByTitle('Löschen'));
    expect(onChange).not.toHaveBeenCalled();
    window.confirm = () => true;
  });

  it('renders draggable handles only for real questions', () => {
    render(<QuizjagdForm questions={[q1, q2]} questionsPerTeam={10} onChange={vi.fn()} onChangeQuestionsPerTeam={vi.fn()} />);
    const draggable = screen.getAllByText('⠿').filter(h => h.getAttribute('draggable') === 'true');
    expect(draggable).toHaveLength(2);
  });

  it('renders Fragen/Team label', () => {
    render(<QuizjagdForm questions={[]} questionsPerTeam={10} onChange={vi.fn()} onChangeQuestionsPerTeam={vi.fn()} />);
    expect(screen.getByText('Fragen/Team:')).toBeInTheDocument();
  });
});
