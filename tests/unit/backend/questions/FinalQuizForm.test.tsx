import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FinalQuizForm from '@/components/backend/questions/FinalQuizForm';
import type { FinalQuizQuestion } from '@/types/config';

vi.mock('@/services/backendApi', () => ({
  fetchAssets: vi.fn().mockResolvedValue({ files: [], subfolders: [] }),
}));

const q1: FinalQuizQuestion = { question: 'Name a European capital', answer: 'Paris' };
const q2: FinalQuizQuestion = { question: 'Name a river in Germany', answer: 'Rhine' };

describe('FinalQuizForm', () => {
  it('renders empty state with only add button', () => {
    render(<FinalQuizForm questions={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Frage hinzufügen/ })).toBeInTheDocument();
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
  });

  it('renders question and answer inputs for each question', () => {
    render(<FinalQuizForm questions={[q1]} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('Name a European capital')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Paris')).toBeInTheDocument();
  });

  it('renders question numbers', () => {
    render(<FinalQuizForm questions={[q1, q2]} onChange={vi.fn()} />);
    expect(screen.getByText('Beispiel')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('calls onChange with new empty question on add', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FinalQuizForm questions={[q1]} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Frage hinzufügen/ }));
    expect(onChange).toHaveBeenCalledWith([q1, { question: '', answer: '' }]);
  });

  it('calls onChange with updated question', () => {
    const onChange = vi.fn();
    render(<FinalQuizForm questions={[{ question: '', answer: '' }]} onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'New Q' } });
    expect(onChange).toHaveBeenLastCalledWith([{ question: 'New Q', answer: '' }]);
  });

  it('calls onChange with updated answer', () => {
    const onChange = vi.fn();
    render(<FinalQuizForm questions={[{ question: 'Q', answer: '' }]} onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[1], { target: { value: 'New A' } });
    expect(onChange).toHaveBeenLastCalledWith([{ question: 'Q', answer: 'New A' }]);
  });

  it('calls onChange removing question on confirmed delete', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FinalQuizForm questions={[q1, q2]} onChange={onChange} />);
    const deleteButtons = screen.getAllByTitle('Löschen');
    await user.click(deleteButtons[0]);
    expect(onChange).toHaveBeenCalledWith([q2]);
  });

  it('does NOT delete when confirm is cancelled', async () => {
    window.confirm = vi.fn(() => false);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FinalQuizForm questions={[q1]} onChange={onChange} />);
    await user.click(screen.getByTitle('Löschen'));
    expect(onChange).not.toHaveBeenCalled();
    window.confirm = () => true;
  });

  it('renders answerImage AssetField', () => {
    render(<FinalQuizForm questions={[q1]} onChange={vi.fn()} />);
    expect(screen.getByText('Antwort-Bild (optional)')).toBeInTheDocument();
  });

  it('renders drag handles', () => {
    render(<FinalQuizForm questions={[q1, q2]} onChange={vi.fn()} />);
    const handles = screen.getAllByText('⠿');
    expect(handles).toHaveLength(2);
  });

  it('renders Frage and Antwort labels', () => {
    render(<FinalQuizForm questions={[q1]} onChange={vi.fn()} />);
    expect(screen.getByText('Frage')).toBeInTheDocument();
    expect(screen.getByText('Antwort')).toBeInTheDocument();
  });
});
