import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AudioGuessForm from '@/components/backend/questions/AudioGuessForm';
import type { AudioGuessQuestion } from '@/types/config';

const sampleQuestions: AudioGuessQuestion[] = [
  { answer: 'Song 1 - Artist 1', audio: '/audio/song1.m4a', isExample: true },
  { answer: 'Song 2 - Artist 2', audio: '/audio/song2.m4a' },
];

describe('AudioGuessForm', () => {
  it('renders an answer input for each real question + a ghost row', () => {
    render(<AudioGuessForm questions={sampleQuestions} onChange={vi.fn()} />);
    // 2 real "Antwort (Song - Künstler)..." + 1 ghost "Neue Frage..." = 3 inputs matching /Antwort/
    expect(screen.getAllByPlaceholderText(/Antwort/)).toHaveLength(3);
  });

  it('renders ghost row when no questions exist', () => {
    render(<AudioGuessForm questions={[]} onChange={vi.fn()} />);
    expect(screen.getByText('Neu')).toBeInTheDocument();
  });

  it('creates a new question when typing into the ghost row', () => {
    const onChange = vi.fn();
    render(<AudioGuessForm questions={sampleQuestions} onChange={onChange} />);
    const ghost = screen.getByPlaceholderText(/Neue Frage – Antwort tippen/);
    fireEvent.change(ghost, { target: { value: 'Brand new' } });
    expect(onChange).toHaveBeenCalled();
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
