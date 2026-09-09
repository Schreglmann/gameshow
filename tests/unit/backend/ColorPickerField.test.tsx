import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ColorPickerField from '@/components/backend/ColorPickerField';

// See specs/team-colors.md — shared by the colorguess colour list and the
// per-team colours in the admin Konfiguration tab.
describe('ColorPickerField', () => {
  const textField = () => screen.getByRole('textbox');

  it('commits a valid hex on blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onError = vi.fn();
    render(<ColorPickerField value="#ff0000" onChange={onChange} onError={onError} />);
    await user.clear(textField());
    await user.type(textField(), '#00ff00');
    await user.tab();
    expect(onChange).toHaveBeenCalledWith('#00ff00');
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a German error and reverts an invalid hex', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onError = vi.fn();
    render(<ColorPickerField value="#ff0000" onChange={onChange} onError={onError} />);
    await user.clear(textField());
    await user.type(textField(), '#nope');
    await user.tab();
    expect(onError).toHaveBeenCalledWith(
      'Ungültiger Hex-Code "#nope" – bitte im Format #rrggbb eingeben.',
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(textField()).toHaveValue('#ff0000');
  });

  it('rejects an emptied field by default — the colorguess list contract', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onError = vi.fn();
    render(<ColorPickerField value="#ff0000" onChange={onChange} onError={onError} />);
    await user.clear(textField());
    await user.tab();
    expect(onError).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits an emptied field as "" with allowEmpty — the "use the theme" escape hatch', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onError = vi.fn();
    render(<ColorPickerField allowEmpty value="#ff0000" onChange={onChange} onError={onError} />);
    await user.clear(textField());
    await user.tab();
    expect(onChange).toHaveBeenCalledWith('');
    expect(onError).not.toHaveBeenCalled();
  });

  it('renders the remove button only when onRemove is given', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const { rerender } = render(
      <ColorPickerField value="#ff0000" onChange={vi.fn()} onError={vi.fn()} />,
    );
    expect(screen.queryByTitle('Farbe entfernen')).not.toBeInTheDocument();
    rerender(
      <ColorPickerField value="#ff0000" onChange={vi.fn()} onError={vi.fn()} onRemove={onRemove} />,
    );
    await user.click(screen.getByTitle('Farbe entfernen'));
    expect(onRemove).toHaveBeenCalled();
  });
});
