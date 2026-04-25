import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FactOrFakeForm from '@/components/backend/questions/FactOrFakeForm';
import type { FactOrFakeQuestion } from '@/types/config';

const q1: FactOrFakeQuestion = { statement: 'The Earth is round', isFact: true, description: 'Proven by science' };
const q2: FactOrFakeQuestion = { statement: 'The moon is made of cheese', isFact: false, description: 'Just a joke' };

describe('FactOrFakeForm', () => {
  it('renders empty state with only the ghost row', () => {
    render(<FactOrFakeForm questions={[]} onChange={vi.fn()} />);
    expect(screen.getByText('Neu')).toBeInTheDocument();
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
    expect(screen.queryByText('Beispiel')).not.toBeInTheDocument();
  });

  it('renders statement textarea for each question', () => {
    render(<FactOrFakeForm questions={[q1]} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('The Earth is round')).toBeInTheDocument();
  });

  it('renders description textarea for each question', () => {
    render(<FactOrFakeForm questions={[q1]} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('Proven by science')).toBeInTheDocument();
  });

  it('renders question numbers', () => {
    render(<FactOrFakeForm questions={[q1, q2]} onChange={vi.fn()} />);
    expect(screen.getByText('Beispiel')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('renders FAKT and FAKE toggle buttons', () => {
    render(<FactOrFakeForm questions={[q1]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'FAKT' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'FAKE' })).toBeInTheDocument();
  });

  it('creates a new question by typing into the ghost row', () => {
    const onChange = vi.fn();
    render(<FactOrFakeForm questions={[]} onChange={onChange} />);
    const ghost = screen.getByPlaceholderText(/Neue Aussage – einfach hier tippen/);
    fireEvent.change(ghost, { target: { value: 'Brand new claim' } });
    expect(onChange).toHaveBeenCalledWith([{ statement: 'Brand new claim', isFact: true, description: '' }]);
  });

  it('calls onChange setting isFact=true and answer="FAKT" when FAKT button clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FactOrFakeForm questions={[{ statement: 'S', isFact: false, description: '' }]} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'FAKT' }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ isFact: true, answer: 'FAKT' }),
    ]);
  });

  it('calls onChange setting isFact=false and answer="FAKE" when FAKE button clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FactOrFakeForm questions={[q1]} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'FAKE' }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ isFact: false, answer: 'FAKE' }),
    ]);
  });

  it('calls onChange with updated statement', () => {
    const onChange = vi.fn();
    render(<FactOrFakeForm questions={[{ statement: 'Old', isFact: true, description: '' }]} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Old'), { target: { value: 'New statement' } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ statement: 'New statement' }),
    ]);
  });

  it('calls onChange with updated description', () => {
    const onChange = vi.fn();
    render(<FactOrFakeForm questions={[{ statement: 'S', isFact: true, description: '' }]} onChange={onChange} />);
    const textarea = screen.getByPlaceholderText('Erklärung / Hintergrundinfo...');
    fireEvent.change(textarea, { target: { value: 'Background info' } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ description: 'Background info' }),
    ]);
  });

  it('renders "Aussage" label', () => {
    render(<FactOrFakeForm questions={[q1]} onChange={vi.fn()} />);
    expect(screen.getAllByText('Aussage').length).toBeGreaterThan(0);
  });

  it('renders "Beschreibung" label', () => {
    render(<FactOrFakeForm questions={[q1]} onChange={vi.fn()} />);
    expect(screen.getByText('Beschreibung (nach Auflösung)')).toBeInTheDocument();
  });

  it('calls onChange removing question on confirmed delete', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FactOrFakeForm questions={[q1, q2]} onChange={onChange} />);
    const deleteButtons = screen.getAllByTitle('Löschen');
    await user.click(deleteButtons[0]);
    expect(onChange).toHaveBeenCalledWith([q2]);
  });

  it('does NOT delete when confirm is cancelled', async () => {
    window.confirm = vi.fn(() => false);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FactOrFakeForm questions={[q1]} onChange={onChange} />);
    await user.click(screen.getByTitle('Löschen'));
    expect(onChange).not.toHaveBeenCalled();
    window.confirm = () => true;
  });

  it('renders draggable handles only for real questions', () => {
    render(<FactOrFakeForm questions={[q1, q2]} onChange={vi.fn()} />);
    const draggable = screen.getAllByText('⠿').filter(h => h.getAttribute('draggable') === 'true');
    expect(draggable).toHaveLength(2);
  });
});
