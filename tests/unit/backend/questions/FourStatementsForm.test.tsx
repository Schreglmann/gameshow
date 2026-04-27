import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FourStatementsForm from '@/components/backend/questions/FourStatementsForm';
import type { FourStatementsQuestion } from '@/types/config';

vi.mock('@/services/backendApi', () => ({
  fetchAssets: vi.fn().mockResolvedValue({ files: [], subfolders: [] }),
}));

const sample: FourStatementsQuestion = {
  topic: 'Gesucht ist ein Erfinder',
  statements: ['Hinweis 1', 'Hinweis 2', 'Hinweis 3', 'Hinweis 4'],
  answer: 'Edison',
};

describe('FourStatementsForm', () => {
  it('renders empty state with only the ghost row', () => {
    render(<FourStatementsForm questions={[]} onChange={vi.fn()} />);
    expect(screen.getByText('Neu')).toBeInTheDocument();
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
    expect(screen.queryByText('Beispiel')).not.toBeInTheDocument();
  });

  it('always shows all 4 statement inputs', () => {
    render(<FourStatementsForm questions={[sample]} onChange={vi.fn()} />);
    // Real and ghost rows both render Hinweis 1..4 — assert at least one of each label.
    [1, 2, 3, 4].forEach(n => {
      expect(screen.getAllByText(new RegExp(`Hinweis ${n}`)).length).toBeGreaterThan(0);
    });
    expect(screen.getByDisplayValue('Hinweis 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hinweis 4')).toBeInTheDocument();
  });

  it('pads a short statements array to 4 slots with empty strings', () => {
    const short: FourStatementsQuestion = { topic: 't', statements: ['solo'] };
    render(<FourStatementsForm questions={[short]} onChange={vi.fn()} />);
    // All 4 labels present (real + ghost row both show them)
    ['Hinweis 1', 'Hinweis 2', 'Hinweis 3', 'Hinweis 4'].forEach(lbl => {
      expect(screen.getAllByText(new RegExp(lbl)).length).toBeGreaterThan(0);
    });
    // Only 1 filled value in the real row
    expect(screen.getByDisplayValue('solo')).toBeInTheDocument();
    // (leer) markers: 3 in the real row + 4 in the ghost row = 7
    expect(screen.getAllByText(/\(leer\)/)).toHaveLength(7);
  });

  it('does NOT render an add-hint button', () => {
    render(<FourStatementsForm questions={[sample]} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Hinweis hinzufügen/ })).not.toBeInTheDocument();
  });

  it('does NOT render per-hint remove buttons', () => {
    render(<FourStatementsForm questions={[sample]} onChange={vi.fn()} />);
    expect(screen.queryByTitle(/Hinweis entfernen/)).not.toBeInTheDocument();
  });

  it('writes to the correct slot and keeps the others unchanged', () => {
    const onChange = vi.fn();
    render(<FourStatementsForm questions={[sample]} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Hinweis 2'), { target: { value: 'Neu 2' } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ statements: ['Hinweis 1', 'Neu 2', 'Hinweis 3', 'Hinweis 4'] }),
    ]);
  });

  it('pads when writing into an empty slot', () => {
    const onChange = vi.fn();
    const short: FourStatementsQuestion = { topic: 't', statements: ['one'] };
    render(<FourStatementsForm questions={[short]} onChange={onChange} />);
    // Index into the real row's hint inputs (first 4 of the placeholder list — ghost row's hints come after)
    const inputs = screen.getAllByPlaceholderText(/^Hinweis \d\.\.\.$/);
    fireEvent.change(inputs[2], { target: { value: 'clue3' } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ statements: ['one', '', 'clue3', ''] }),
    ]);
  });

  it('creates a new question by typing into the ghost row', () => {
    const onChange = vi.fn();
    render(<FourStatementsForm questions={[]} onChange={onChange} />);
    const ghost = screen.getByPlaceholderText(/Neue Frage – einfach hier tippen/);
    fireEvent.change(ghost, { target: { value: 'Topic' } });
    expect(onChange).toHaveBeenCalledWith([{ topic: 'Topic', statements: ['', '', '', ''] }]);
  });

  it('updates topic on input change', () => {
    const onChange = vi.fn();
    render(<FourStatementsForm questions={[{ topic: 'Old', statements: ['', '', '', ''] }]} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Old'), { target: { value: 'Mystery' } });
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ topic: 'Mystery' })]);
  });

  it('updates answer text', () => {
    const onChange = vi.fn();
    render(<FourStatementsForm questions={[{ ...sample, answer: undefined }]} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/Lösung als Text/), { target: { value: 'Tesla' } });
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ answer: 'Tesla' })]);
  });

  it('renders question numbers', () => {
    render(<FourStatementsForm questions={[sample, { ...sample, topic: 'Q2' }]} onChange={vi.fn()} />);
    expect(screen.getByText('Beispiel')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('removes a question on confirmed delete', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    window.confirm = vi.fn(() => true);
    const two = [sample, { ...sample, topic: 'Q2' }];
    render(<FourStatementsForm questions={two} onChange={onChange} />);
    const deleteButtons = screen.getAllByTitle('Löschen');
    await user.click(deleteButtons[0]);
    expect(onChange).toHaveBeenCalledWith([two[1]]);
  });
});
