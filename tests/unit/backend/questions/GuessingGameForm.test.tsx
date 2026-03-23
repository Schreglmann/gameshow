import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GuessingGameForm from '@/components/backend/questions/GuessingGameForm';
import type { GuessingGameQuestion } from '@/types/config';

vi.mock('@/services/backendApi', () => ({
  fetchAssets: vi.fn().mockResolvedValue({ files: [], subfolders: [] }),
}));

const q1: GuessingGameQuestion = { question: 'How many planets?', answer: 8 };
const q2: GuessingGameQuestion = { question: 'Distance to moon (km)?', answer: 384400 };

describe('GuessingGameForm', () => {
  it('renders empty state with only add button', () => {
    render(<GuessingGameForm questions={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Frage hinzufügen/ })).toBeInTheDocument();
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
  });

  it('renders question label and input for each question', () => {
    render(<GuessingGameForm questions={[q1]} onChange={vi.fn()} />);
    expect(screen.getByText('Frage')).toBeInTheDocument();
    expect(screen.getByDisplayValue('How many planets?')).toBeInTheDocument();
  });

  it('renders numeric answer label and input', () => {
    render(<GuessingGameForm questions={[q1]} onChange={vi.fn()} />);
    expect(screen.getByText('Antwort (Zahl)')).toBeInTheDocument();
    expect(screen.getByDisplayValue('8')).toBeInTheDocument();
  });

  it('renders question numbers', () => {
    render(<GuessingGameForm questions={[q1, q2]} onChange={vi.fn()} />);
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('calls onChange with new empty question when add button clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<GuessingGameForm questions={[q1]} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Frage hinzufügen/ }));
    expect(onChange).toHaveBeenCalledWith([q1, { question: '', answer: 0 }]);
  });

  it('calls onChange with updated question text', () => {
    const onChange = vi.fn();
    render(<GuessingGameForm questions={[{ question: 'Old', answer: 5 }]} onChange={onChange} />);
    const input = screen.getByPlaceholderText('Was wird geschätzt?');
    fireEvent.change(input, { target: { value: 'New question' } });
    expect(onChange).toHaveBeenLastCalledWith([{ question: 'New question', answer: 5 }]);
  });

  it('calls onChange with updated numeric answer', () => {
    const onChange = vi.fn();
    render(<GuessingGameForm questions={[{ question: 'Q', answer: 5 }]} onChange={onChange} />);
    const inputs = screen.getAllByRole('spinbutton');
    fireEvent.change(inputs[0], { target: { value: '42' } });
    expect(onChange).toHaveBeenLastCalledWith([{ question: 'Q', answer: 42 }]);
  });

  it('calls onChange removing question when delete is confirmed', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<GuessingGameForm questions={[q1, q2]} onChange={onChange} />);
    const deleteButtons = screen.getAllByTitle('Löschen');
    await user.click(deleteButtons[0]);
    expect(onChange).toHaveBeenCalledWith([q2]);
  });

  it('does NOT delete when confirm is cancelled', async () => {
    window.confirm = vi.fn(() => false);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<GuessingGameForm questions={[q1]} onChange={onChange} />);
    await user.click(screen.getByTitle('Löschen'));
    expect(onChange).not.toHaveBeenCalled();
    window.confirm = () => true;
  });

  it('renders answerImage AssetField', () => {
    render(<GuessingGameForm questions={[q1]} onChange={vi.fn()} />);
    expect(screen.getByText('Antwort-Bild (optional)')).toBeInTheDocument();
  });

  it('renders drag handles for each question', () => {
    render(<GuessingGameForm questions={[q1, q2]} onChange={vi.fn()} />);
    const handles = screen.getAllByText('⠿');
    expect(handles).toHaveLength(2);
  });
});
