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

  describe('task line mode', () => {
    it('renders Aufgabe badge on row 0 and the task-line placeholder', () => {
      render(<RulesEditor rules={['']} onChange={vi.fn()} taskLine />);
      expect(screen.getByText('Aufgabe')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Beschreibe die Aufgabe der Runde.')).toBeInTheDocument();
    });

    it('hides the delete button on row 0 only', () => {
      render(<RulesEditor rules={['Task', 'Other']} onChange={vi.fn()} taskLine />);
      expect(screen.getAllByTitle('Entfernen')).toHaveLength(1);
    });

    it('uses the regular placeholder for rows >= 1', () => {
      render(<RulesEditor rules={['Task', '']} onChange={vi.fn()} taskLine />);
      expect(screen.getByPlaceholderText('Neue Regel...')).toBeInTheDocument();
    });
  });

  describe('preset buttons', () => {
    const presets = [
      { id: 'a', name: 'Preset A', rules: ['A1', 'A2'] },
      { id: 'b', name: 'Preset B', rules: ['B1'] },
    ];

    it('renders no preset buttons and no toggle when presets prop is empty', () => {
      render(<RulesEditor rules={[]} onChange={vi.fn()} presets={[]} />);
      expect(screen.queryByRole('button', { name: 'Preset A' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Vorlage/ })).not.toBeInTheDocument();
    });

    it('preset buttons are hidden by default and the toggle button is shown', () => {
      render(<RulesEditor rules={[]} onChange={vi.fn()} presets={presets} />);
      expect(screen.queryByRole('button', { name: 'Preset A' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Preset B' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Vorlage/ })).toBeInTheDocument();
    });

    it('clicking the toggle expands the preset buttons', async () => {
      const user = userEvent.setup();
      render(<RulesEditor rules={[]} onChange={vi.fn()} presets={presets} />);
      await user.click(screen.getByRole('button', { name: /Vorlage/ }));
      expect(screen.getByRole('button', { name: 'Preset A' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Preset B' })).toBeInTheDocument();
    });

    it('preset buttons are expanded by default when a preset is active on mount', () => {
      render(
        <RulesEditor
          rules={['Task']}
          onChange={vi.fn()}
          taskLine
          presets={presets}
          activePresetId="a"
          onPresetChange={vi.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: 'Preset A' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Preset B' })).toBeInTheDocument();
    });

    it('clicking an inactive preset calls onPresetChange with its id', async () => {
      const onPresetChange = vi.fn();
      const user = userEvent.setup();
      render(
        <RulesEditor
          rules={['Task']}
          onChange={vi.fn()}
          taskLine
          presets={presets}
          onPresetChange={onPresetChange}
        />,
      );
      // Expand first since presets are collapsed by default when no activePresetId.
      await user.click(screen.getByRole('button', { name: /Vorlage/ }));
      await user.click(screen.getByRole('button', { name: 'Preset A' }));
      expect(onPresetChange).toHaveBeenCalledWith('a');
    });

    it('clicking the active preset calls onPresetChange with undefined', async () => {
      const onPresetChange = vi.fn();
      const user = userEvent.setup();
      render(
        <RulesEditor
          rules={['Task']}
          onChange={vi.fn()}
          taskLine
          presets={presets}
          activePresetId="a"
          onPresetChange={onPresetChange}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Preset A' }));
      expect(onPresetChange).toHaveBeenCalledWith(undefined);
    });

    it('clicking a different preset while one is active switches without an undefined call', async () => {
      const onPresetChange = vi.fn();
      const user = userEvent.setup();
      render(
        <RulesEditor
          rules={['Task']}
          onChange={vi.fn()}
          taskLine
          presets={presets}
          activePresetId="a"
          onPresetChange={onPresetChange}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Preset B' }));
      expect(onPresetChange).toHaveBeenCalledWith('b');
      expect(onPresetChange).not.toHaveBeenCalledWith(undefined);
    });

    it('active preset button gets the is-active class', () => {
      render(
        <RulesEditor
          rules={['Task']}
          onChange={vi.fn()}
          taskLine
          presets={presets}
          activePresetId="b"
          onPresetChange={vi.fn()}
        />,
      );
      const activeBtn = screen.getByRole('button', { name: 'Preset B' });
      const inactiveBtn = screen.getByRole('button', { name: 'Preset A' });
      expect(activeBtn.className).toContain('is-active');
      expect(inactiveBtn.className).not.toContain('is-active');
    });

    it('in linked mode disables "+ Hinzufügen" and renders preset rules as plain text', () => {
      render(
        <RulesEditor
          rules={['Task line']}
          onChange={vi.fn()}
          taskLine
          presets={presets}
          activePresetId="a"
          onPresetChange={vi.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: /Hinzufügen/ })).toBeDisabled();
      expect(screen.getByText('A1')).toBeInTheDocument();
      expect(screen.getByText('A2')).toBeInTheDocument();
      // Only the task line is editable in linked mode.
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
    });

  });
});
