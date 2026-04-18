import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AudioGuessForm from '@/components/backend/questions/AudioGuessForm';
import type { AudioGuessQuestion } from '@/types/config';

const sampleQuestions: AudioGuessQuestion[] = [
  { answer: 'Song 1 - Artist 1', audio: '/audio/song1.m4a', isExample: true },
  { answer: 'Song 2 - Artist 2', audio: '/audio/song2.m4a' },
];

describe('AudioGuessForm', () => {
  it('renders question inputs for each question', () => {
    render(<AudioGuessForm questions={sampleQuestions} onChange={vi.fn()} />);
    expect(screen.getAllByPlaceholderText(/Antwort/)).toHaveLength(2);
  });

  it('renders add question button', () => {
    render(<AudioGuessForm questions={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Frage hinzufügen/ })).toBeInTheDocument();
  });

  it('calls onChange when adding a question', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<AudioGuessForm questions={sampleQuestions} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Frage hinzufügen/ }));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0]).toHaveLength(3);
  });

  it('renders Beispiel checkbox for each question', () => {
    render(<AudioGuessForm questions={sampleQuestions} onChange={vi.fn()} />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it('displays question numbers', () => {
    render(<AudioGuessForm questions={sampleQuestions} onChange={vi.fn()} />);
    expect(screen.getAllByText('Beispiel').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('#1')).toBeInTheDocument();
  });
});
