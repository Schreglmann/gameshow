import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FourStatementsForm from '@/components/backend/questions/FourStatementsForm';
import type { FourStatementsQuestion } from '@/types/config';

const q1: FourStatementsQuestion = {
  Frage: 'About animals',
  trueStatements: ['Dogs bark', 'Cats meow', 'Fish swim'],
  wrongStatement: 'Birds bark',
};

const q2: FourStatementsQuestion = {
  Frage: 'About science',
  trueStatements: ['Water boils at 100°C', 'Earth orbits the Sun', 'Oxygen is O2'],
  wrongStatement: 'Water boils at 50°C',
  answer: 'Water boils at 100 degrees Celsius',
};

describe('FourStatementsForm', () => {
  it('renders empty state with only add button', () => {
    render(<FourStatementsForm questions={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Frage hinzufügen/ })).toBeInTheDocument();
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
  });

  it('renders question numbers', () => {
    render(<FourStatementsForm questions={[q1, q2]} onChange={vi.fn()} />);
    expect(screen.getByText('Beispiel')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('renders "Frage / Thema" label and input', () => {
    render(<FourStatementsForm questions={[q1]} onChange={vi.fn()} />);
    expect(screen.getByText('Frage / Thema')).toBeInTheDocument();
    expect(screen.getByDisplayValue('About animals')).toBeInTheDocument();
  });

  it('renders three true statement inputs', () => {
    render(<FourStatementsForm questions={[q1]} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('Dogs bark')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Cats meow')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Fish swim')).toBeInTheDocument();
  });

  it('renders the wrong statement input', () => {
    render(<FourStatementsForm questions={[q1]} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('Birds bark')).toBeInTheDocument();
  });

  it('renders "Falsche Aussage" label', () => {
    render(<FourStatementsForm questions={[q1]} onChange={vi.fn()} />);
    expect(screen.getByText(/Falsche Aussage/)).toBeInTheDocument();
  });

  it('renders "Wahre Aussage" labels for the three true statements', () => {
    render(<FourStatementsForm questions={[q1]} onChange={vi.fn()} />);
    expect(screen.getByText(/Wahre Aussage 1/)).toBeInTheDocument();
    expect(screen.getByText(/Wahre Aussage 2/)).toBeInTheDocument();
    expect(screen.getByText(/Wahre Aussage 3/)).toBeInTheDocument();
  });

  it('renders optional answer/explanation field', () => {
    render(<FourStatementsForm questions={[q1]} onChange={vi.fn()} />);
    expect(screen.getByText('Auflösungstext (optional)')).toBeInTheDocument();
  });

  it('shows existing answer value in explanation field', () => {
    render(<FourStatementsForm questions={[q2]} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('Water boils at 100 degrees Celsius')).toBeInTheDocument();
  });

  it('calls onChange with new empty question on add', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FourStatementsForm questions={[]} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Frage hinzufügen/ }));
    expect(onChange).toHaveBeenCalledWith([
      { Frage: '', trueStatements: ['', '', ''], wrongStatement: '' },
    ]);
  });

  it('calls onChange when Frage input changes', () => {
    const onChange = vi.fn();
    render(<FourStatementsForm questions={[{ Frage: '', trueStatements: ['', '', ''], wrongStatement: '' }]} onChange={onChange} />);
    const frageInput = screen.getByPlaceholderText('Worüber geht es?');
    fireEvent.change(frageInput, { target: { value: 'New topic' } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ Frage: 'New topic' }),
    ]);
  });

  it('calls onChange when a true statement changes', () => {
    const onChange = vi.fn();
    render(<FourStatementsForm questions={[q1]} onChange={onChange} />);
    const trueInput = screen.getByDisplayValue('Dogs bark');
    fireEvent.change(trueInput, { target: { value: 'Dogs woof' } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ trueStatements: ['Dogs woof', 'Cats meow', 'Fish swim'] }),
    ]);
  });

  it('calls onChange when wrong statement changes', () => {
    const onChange = vi.fn();
    render(<FourStatementsForm questions={[q1]} onChange={onChange} />);
    const wrongInput = screen.getByDisplayValue('Birds bark');
    fireEvent.change(wrongInput, { target: { value: 'Fish fly' } });
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ wrongStatement: 'Fish fly' }),
    ]);
  });

  it('calls onChange removing question on confirmed delete', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FourStatementsForm questions={[q1, q2]} onChange={onChange} />);
    const deleteButtons = screen.getAllByTitle('Löschen');
    await user.click(deleteButtons[0]);
    expect(onChange).toHaveBeenCalledWith([q2]);
  });

  it('does NOT delete when confirm is cancelled', async () => {
    window.confirm = vi.fn(() => false);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FourStatementsForm questions={[q1]} onChange={onChange} />);
    await user.click(screen.getByTitle('Löschen'));
    expect(onChange).not.toHaveBeenCalled();
    window.confirm = () => true;
  });

  it('renders drag handles', () => {
    render(<FourStatementsForm questions={[q1, q2]} onChange={vi.fn()} />);
    const handles = screen.getAllByText('⠿');
    expect(handles).toHaveLength(2);
  });
});
