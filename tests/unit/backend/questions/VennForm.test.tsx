import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VennForm from '@/components/backend/questions/VennForm';
import type { VennQuestion } from '@/types/config';

vi.mock('@/services/backendApi', () => ({
  fetchAssets: vi.fn().mockResolvedValue({ files: [], subfolders: [] }),
}));

const mars: VennQuestion = { sets: ['Planet', 'Schokoriegel', 'Römischer Gott'], answer: 'Mars' };
const puma: VennQuestion = { sets: ['Raubkatze', 'Sportmarke'], answer: 'Puma' };

describe('VennForm', () => {
  it('renders empty state with only the ghost row', () => {
    render(<VennForm questions={[]} onChange={vi.fn()} />);
    expect(screen.getByText('Neu')).toBeInTheDocument();
    expect(screen.queryByText('Beispiel')).not.toBeInTheDocument();
  });

  it('labels the first question as the example and shows three category slots', () => {
    render(<VennForm questions={[mars]} onChange={vi.fn()} />);
    expect(screen.getByText('Beispiel')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Planet')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Schokoriegel')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Römischer Gott')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Mars')).toBeInTheDocument();
  });

  it('marks the empty hint slot of a two-category question', () => {
    render(<VennForm questions={[puma]} onChange={vi.fn()} />);
    // One in the real row, one in the ghost row.
    expect(screen.getAllByText(/\(leer\)/)).toHaveLength(2);
  });

  it('stores a typed hint as a third set', () => {
    const onChange = vi.fn();
    render(<VennForm questions={[puma]} onChange={onChange} />);
    const hint = screen.getAllByPlaceholderText('Dritter Kreis als Hinweis (optional)')[0]!;
    fireEvent.change(hint, { target: { value: 'Schützenpanzer' } });
    expect(onChange).toHaveBeenCalledWith([{ sets: ['Raubkatze', 'Sportmarke', 'Schützenpanzer'], answer: 'Puma' }]);
  });

  it('drops the third set again when the hint is cleared', () => {
    const onChange = vi.fn();
    render(<VennForm questions={[mars]} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Römischer Gott'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith([{ sets: ['Planet', 'Schokoriegel'], answer: 'Mars' }]);
  });

  it('keeps both puzzle slots when the first category is edited', () => {
    const onChange = vi.fn();
    render(<VennForm questions={[puma]} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Raubkatze'), { target: { value: 'Katze' } });
    expect(onChange).toHaveBeenCalledWith([{ sets: ['Katze', 'Sportmarke'], answer: 'Puma' }]);
  });

  it('creates a question when typing into the ghost row', () => {
    const onChange = vi.fn();
    render(<VennForm questions={[]} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText('Neue Frage – einfach hier tippen…'), { target: { value: 'Planet' } });
    expect(onChange).toHaveBeenCalledWith([{ sets: ['Planet', ''], answer: '' }]);
  });

  it('shows a preview diagram once two categories are filled in', () => {
    const { container, rerender } = render(<VennForm questions={[{ sets: ['Planet', ''], answer: '' }]} onChange={vi.fn()} />);
    expect(container.querySelector('.venn-diagram')).not.toBeInTheDocument();
    rerender(<VennForm questions={[mars]} onChange={vi.fn()} />);
    expect(container.querySelectorAll('.venn-diagram__circle')).toHaveLength(3);
    expect(container.querySelector('.venn-diagram__solution')?.textContent).toBe('Mars');
  });
});
