import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GmInfoField from '@/components/backend/questions/GmInfoField';

describe('GmInfoField', () => {
  it('renders the label and the current value', () => {
    render(<GmInfoField segKey="q0.gmInfo" value="Aussprache: Pa-ris" onChange={vi.fn()} />);
    expect(screen.getByText('Info für Gamemaster (nur GM-Ansicht)')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Aussprache: Pa-ris')).toBeInTheDocument();
  });

  it('calls onChange with the typed text', () => {
    const onChange = vi.fn();
    render(<GmInfoField segKey="q0.gmInfo" value={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/Nur für den Gamemaster sichtbar/), { target: { value: 'Notiz' } });
    expect(onChange).toHaveBeenCalledWith('Notiz');
  });

  it('calls onChange(undefined) when cleared', () => {
    const onChange = vi.fn();
    render(<GmInfoField segKey="q0.gmInfo" value="Notiz" onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue('Notiz'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('is a multi-line textarea', () => {
    render(<GmInfoField segKey="q0.gmInfo" value="a" onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('a').tagName).toBe('TEXTAREA');
  });
});
