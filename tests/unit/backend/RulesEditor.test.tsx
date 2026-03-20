import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RulesEditor from '@/components/backend/RulesEditor';

describe('RulesEditor', () => {
  it('renders empty state with only add button when no rules', () => {
    render(<RulesEditor rules={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Hinzufügen/ })).toBeInTheDocument();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('renders all existing rules as inputs', () => {
    render(<RulesEditor rules={['Rule A', 'Rule B', 'Rule C']} onChange={vi.fn()} />);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(3);
    expect((inputs[0] as HTMLInputElement).value).toBe('Rule A');
    expect((inputs[1] as HTMLInputElement).value).toBe('Rule B');
    expect((inputs[2] as HTMLInputElement).value).toBe('Rule C');
  });

  it('calls onChange with new empty rule when add button clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RulesEditor rules={['Existing']} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Hinzufügen/ }));
    expect(onChange).toHaveBeenCalledWith(['Existing', '']);
  });

  it('adds first rule on empty list', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RulesEditor rules={[]} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Hinzufügen/ }));
    expect(onChange).toHaveBeenCalledWith(['']);
  });

  it('calls onChange with updated value when rule input changes', () => {
    const onChange = vi.fn();
    render(<RulesEditor rules={['Old rule']} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'New rule' } });
    expect(onChange).toHaveBeenLastCalledWith(['New rule']);
  });

  it('calls onChange removing rule when delete is confirmed', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RulesEditor rules={['Rule 1', 'Rule 2']} onChange={onChange} />);
    const deleteButtons = screen.getAllByTitle('Entfernen');
    await user.click(deleteButtons[0]);
    expect(onChange).toHaveBeenCalledWith(['Rule 2']);
  });

  it('does NOT remove rule when confirm is cancelled', async () => {
    window.confirm = vi.fn(() => false);
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RulesEditor rules={['Rule 1', 'Rule 2']} onChange={onChange} />);
    const deleteButtons = screen.getAllByTitle('Entfernen');
    await user.click(deleteButtons[0]);
    expect(onChange).not.toHaveBeenCalled();
    window.confirm = () => true;
  });

  it('renders custom placeholder when provided', () => {
    render(<RulesEditor rules={['']} onChange={vi.fn()} placeholder="Custom placeholder..." />);
    expect(screen.getByPlaceholderText('Custom placeholder...')).toBeInTheDocument();
  });

  it('renders default placeholder when not provided', () => {
    render(<RulesEditor rules={['']} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('Neue Regel...')).toBeInTheDocument();
  });

  it('renders drag handles for each rule', () => {
    render(<RulesEditor rules={['A', 'B', 'C']} onChange={vi.fn()} />);
    const handles = screen.getAllByText('⠿');
    expect(handles).toHaveLength(3);
  });

  it('renders delete button for each rule', () => {
    render(<RulesEditor rules={['A', 'B']} onChange={vi.fn()} />);
    const deleteButtons = screen.getAllByTitle('Entfernen');
    expect(deleteButtons).toHaveLength(2);
  });

  it('confirm dialog is shown before delete', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<RulesEditor rules={['Rule 1']} onChange={vi.fn()} />);
    await user.click(screen.getByTitle('Entfernen'));
    expect(confirmSpy).toHaveBeenCalledWith('Regel entfernen?');
    confirmSpy.mockRestore();
  });
});
