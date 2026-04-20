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
  it('renders empty state with only the add-question button', () => {
    render(<FourStatementsForm questions={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Frage hinzufügen/ })).toBeInTheDocument();
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
  });

  it('always shows all 4 statement inputs', () => {
    render(<FourStatementsForm questions={[sample]} onChange={vi.fn()} />);
    expect(screen.getByText(/Hinweis 1/)).toBeInTheDocument();
    expect(screen.getByText(/Hinweis 2/)).toBeInTheDocument();
    expect(screen.getByText(/Hinweis 3/)).toBeInTheDocument();
    expect(screen.getByText(/Hinweis 4/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hinweis 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hinweis 4')).toBeInTheDocument();
  });

  it('pads a short statements array to 4 slots with empty strings', () => {
    const short: FourStatementsQuestion = { topic: 't', statements: ['solo'] };
    render(<FourStatementsForm questions={[short]} onChange={vi.fn()} />);
    // All 4 labels present
    ['Hinweis 1', 'Hinweis 2', 'Hinweis 3', 'Hinweis 4'].forEach(lbl => {
      expect(screen.getByText(new RegExp(lbl))).toBeInTheDocument();
    });
    // Only 1 filled value
    expect(screen.getByDisplayValue('solo')).toBeInTheDocument();
    // 3 empty inputs with "(leer)" marker
    expect(screen.getAllByText(/\(leer\)/)).toHaveLength(3);
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
    const inputs = screen.getAllByPlaceholderText(/^Hinweis \d\.\.\.$/);
    fireEvent.change(inputs[2], { target: { value: 'clue3' } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ statements: ['one', '', 'clue3', ''] }),
    ]);
  });

  it('creates a new question with 4 empty slots on add', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FourStatementsForm questions={[]} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Frage hinzufügen/ }));
    expect(onChange).toHaveBeenCalledWith([{ topic: '', statements: ['', '', '', ''] }]);
  });

  it('updates topic on input change', () => {
    const onChange = vi.fn();
    render(<FourStatementsForm questions={[{ topic: '', statements: ['', '', '', ''] }]} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/Worüber geht es/), { target: { value: 'Mystery' } });
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
