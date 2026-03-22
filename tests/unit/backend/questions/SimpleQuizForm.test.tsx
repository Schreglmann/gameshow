import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SimpleQuizForm from '@/components/backend/questions/SimpleQuizForm';
import type { SimpleQuizQuestion } from '@/types/config';

vi.mock('@/services/backendApi', () => ({
  fetchAssets: vi.fn().mockResolvedValue({ files: [], subfolders: [] }),
}));

const q1: SimpleQuizQuestion = { question: 'What is 2+2?', answer: '4' };
const q2: SimpleQuizQuestion = { question: 'Capital of France?', answer: 'Paris' };

describe('SimpleQuizForm', () => {
  it('renders empty state with only add button when no questions', () => {
    render(<SimpleQuizForm questions={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Frage hinzufügen/ })).toBeInTheDocument();
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
  });

  it('renders question and answer inputs for each question', () => {
    render(<SimpleQuizForm questions={[q1, q2]} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('What is 2+2?')).toBeInTheDocument();
    expect(screen.getByDisplayValue('4')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Capital of France?')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Paris')).toBeInTheDocument();
  });

  it('renders question numbers', () => {
    render(<SimpleQuizForm questions={[q1, q2]} onChange={vi.fn()} />);
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('calls onChange with new empty question when add button clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SimpleQuizForm questions={[q1]} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Frage hinzufügen/ }));
    expect(onChange).toHaveBeenCalledWith([q1, { question: '', answer: '' }]);
  });

  it('calls onChange with updated question when question input changes', () => {
    const onChange = vi.fn();
    render(<SimpleQuizForm questions={[{ question: 'Old', answer: 'Ans' }]} onChange={onChange} />);
    const questionInput = screen.getByPlaceholderText('Frage...');
    fireEvent.change(questionInput, { target: { value: 'New' } });
    expect(onChange).toHaveBeenLastCalledWith([{ question: 'New', answer: 'Ans' }]);
  });

  it('calls onChange with updated answer when answer input changes', () => {
    const onChange = vi.fn();
    render(<SimpleQuizForm questions={[{ question: 'Q', answer: 'Old' }]} onChange={onChange} />);
    const answerInput = screen.getByPlaceholderText('Antwort...');
    fireEvent.change(answerInput, { target: { value: 'New' } });
    expect(onChange).toHaveBeenLastCalledWith([{ question: 'Q', answer: 'New' }]);
  });

  it('calls onChange without deleted question when delete is confirmed', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SimpleQuizForm questions={[q1, q2]} onChange={onChange} />);
    const deleteButtons = screen.getAllByTitle('Löschen');
    await user.click(deleteButtons[0]);
    expect(onChange).toHaveBeenCalledWith([q2]);
  });

  it('does NOT delete when confirm is cancelled', async () => {
    window.confirm = vi.fn(() => false);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SimpleQuizForm questions={[q1]} onChange={onChange} />);
    await user.click(screen.getByTitle('Löschen'));
    expect(onChange).not.toHaveBeenCalled();
    window.confirm = () => true;
  });

  it('shows optional fields toggle button for each question', () => {
    render(<SimpleQuizForm questions={[q1, q2]} onChange={vi.fn()} />);
    const optButtons = screen.getAllByText(/Opt\./);
    expect(optButtons).toHaveLength(2);
  });

  it('shows optional fields section when toggle is clicked', async () => {
    const user = userEvent.setup();
    render(<SimpleQuizForm questions={[q1]} onChange={vi.fn()} />);
    const optBtn = screen.getByText(/▶ Opt\./);
    await user.click(optBtn);
    expect(screen.getByText('Timer (Sekunden)')).toBeInTheDocument();
    expect(screen.getByText('Bild ersetzen bei Auflösung')).toBeInTheDocument();
    expect(screen.getByText('Mehrzeilige Antwort (eine Zeile pro Abschnitt)')).toBeInTheDocument();
  });

  it('collapses optional fields when toggle is clicked again', async () => {
    const user = userEvent.setup();
    render(<SimpleQuizForm questions={[q1]} onChange={vi.fn()} />);
    const optBtn = screen.getByText(/▶ Opt\./);
    await user.click(optBtn);
    expect(screen.getByText('Timer (Sekunden)')).toBeInTheDocument();
    await user.click(screen.getByText(/▲ Opt\./));
    expect(screen.queryByText('Timer (Sekunden)')).not.toBeInTheDocument();
  });

  it('shows timer input and allows setting timer value', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SimpleQuizForm questions={[{ question: 'Q', answer: 'A' }]} onChange={onChange} />);
    await user.click(screen.getByText(/▶ Opt\./));
    const timerInput = screen.getByPlaceholderText('Kein Timer');
    fireEvent.change(timerInput, { target: { value: '30' } });
    expect(onChange).toHaveBeenLastCalledWith([{ question: 'Q', answer: 'A', timer: 30 }]);
  });

  it('shows replaceImage checkbox in optional section', async () => {
    const user = userEvent.setup();
    render(<SimpleQuizForm questions={[q1]} onChange={vi.fn()} />);
    await user.click(screen.getByText(/▶ Opt\./));
    expect(screen.getByText('Bild ersetzen bei Auflösung')).toBeInTheDocument();
  });

  it('updates replaceImage when checkbox is toggled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SimpleQuizForm questions={[{ question: 'Q', answer: 'A' }]} onChange={onChange} />);
    await user.click(screen.getByText(/▶ Opt\./));
    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);
    expect(onChange).toHaveBeenLastCalledWith([{ question: 'Q', answer: 'A', replaceImage: true }]);
  });

  it('shows optional indicator (dot) when question has optional fields set', () => {
    const qWithOpts: SimpleQuizQuestion = { question: 'Q', answer: 'A', timer: 30 };
    render(<SimpleQuizForm questions={[qWithOpts]} onChange={vi.fn()} />);
    // The optional button should be at full opacity (has optional values)
    const optBtn = screen.getByText(/▶ Opt\./);
    expect(optBtn).toBeInTheDocument();
  });

  it('renders answerList textarea in optional section', async () => {
    const user = userEvent.setup();
    render(<SimpleQuizForm questions={[q1]} onChange={vi.fn()} />);
    await user.click(screen.getByText(/▶ Opt\./));
    expect(screen.getByPlaceholderText(/Jede Zeile wird als eigene Zeile/)).toBeInTheDocument();
  });

  it('updates answerList from textarea', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SimpleQuizForm questions={[{ question: 'Q', answer: 'A' }]} onChange={onChange} />);
    await user.click(screen.getByText(/▶ Opt\./));
    const textarea = screen.getByPlaceholderText(/Jede Zeile wird als eigene Zeile/);
    fireEvent.change(textarea, { target: { value: 'Line 1\nLine 2' } });
    expect(onChange).toHaveBeenLastCalledWith([{ question: 'Q', answer: 'A', answerList: ['Line 1', 'Line 2'] }]);
  });

  it('renders drag handles for each question', () => {
    render(<SimpleQuizForm questions={[q1, q2]} onChange={vi.fn()} />);
    const handles = screen.getAllByTitle('Ziehen zum Sortieren');
    expect(handles).toHaveLength(2);
  });

  describe('questionColors', () => {
    it('shows Farben section in optional fields', async () => {
      const user = userEvent.setup();
      render(<SimpleQuizForm questions={[q1]} onChange={vi.fn()} />);
      await user.click(screen.getByText(/▶ Opt\./));
      expect(screen.getByText('Farben (Hex-Code)')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /\+ Farbe/ })).toBeInTheDocument();
    });

    it('adds a default color when + Farbe is clicked', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<SimpleQuizForm questions={[{ question: 'Q', answer: 'A' }]} onChange={onChange} />);
      await user.click(screen.getByText(/▶ Opt\./));
      await user.click(screen.getByRole('button', { name: /\+ Farbe/ }));
      expect(onChange).toHaveBeenLastCalledWith([{ question: 'Q', answer: 'A', questionColors: ['#ff0000'] }]);
    });

    it('removes a color when ✕ is clicked', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      const q: SimpleQuizQuestion = { question: 'Q', answer: 'A', questionColors: ['#ff0000', '#00ff00'] };
      render(<SimpleQuizForm questions={[q]} onChange={onChange} />);
      await user.click(screen.getByText(/▶ Opt\./));
      const removeButtons = screen.getAllByTitle('Farbe entfernen');
      await user.click(removeButtons[0]);
      expect(onChange).toHaveBeenLastCalledWith([{ question: 'Q', answer: 'A', questionColors: ['#00ff00'] }]);
    });

    it('removes questionColors entirely when last color is removed', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      const q: SimpleQuizQuestion = { question: 'Q', answer: 'A', questionColors: ['#ff0000'] };
      render(<SimpleQuizForm questions={[q]} onChange={onChange} />);
      await user.click(screen.getByText(/▶ Opt\./));
      await user.click(screen.getByTitle('Farbe entfernen'));
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      expect(lastCall[0].questionColors).toBeUndefined();
    });

    it('commits valid hex on blur', () => {
      const onChange = vi.fn();
      const q: SimpleQuizQuestion = { question: 'Q', answer: 'A', questionColors: ['#ff0000'] };
      render(<SimpleQuizForm questions={[q]} onChange={onChange} />);
      fireEvent.click(screen.getByText(/▶ Opt\./));
      const hexInput = screen.getByPlaceholderText('#000000');
      fireEvent.change(hexInput, { target: { value: '#00ff00' } });
      fireEvent.blur(hexInput);
      expect(onChange).toHaveBeenLastCalledWith([{ question: 'Q', answer: 'A', questionColors: ['#00ff00'] }]);
    });

    it('does not save and reverts on invalid hex blur', () => {
      const onChange = vi.fn();
      const q: SimpleQuizQuestion = { question: 'Q', answer: 'A', questionColors: ['#ff0000'] };
      render(<SimpleQuizForm questions={[q]} onChange={onChange} />);
      fireEvent.click(screen.getByText(/▶ Opt\./));
      const hexInput = screen.getByPlaceholderText('#000000');
      fireEvent.change(hexInput, { target: { value: 'bad' } });
      fireEvent.blur(hexInput);
      // onChange should NOT have been called with invalid value
      const calls = onChange.mock.calls.filter(c => c[0][0].questionColors?.includes('bad'));
      expect(calls).toHaveLength(0);
      // Input should revert to original value
      expect((hexInput as HTMLInputElement).value).toBe('#ff0000');
    });

    it('shows color badge in compact view when colors are set', () => {
      const q: SimpleQuizQuestion = { question: 'Q', answer: 'A', questionColors: ['#ff0000', '#00ff00'] };
      render(<SimpleQuizForm questions={[q]} onChange={vi.fn()} />);
      // Badges are visible in collapsed state
      const badges = document.querySelectorAll('[title="#ff0000"], [title="#00ff00"]');
      expect(badges.length).toBeGreaterThanOrEqual(2);
    });
  });
});
