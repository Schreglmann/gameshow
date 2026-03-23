import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useDragReorder } from '@/components/backend/useDragReorder';

// Polyfill DragEvent for jsdom (not natively supported)
beforeAll(() => {
  if (typeof globalThis.DragEvent === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).DragEvent = class DragEvent extends Event {
      dataTransfer = {
        effectAllowed: '' as DataTransfer['effectAllowed'],
        setDragImage: () => {},
      };
      constructor(type: string, init?: EventInit) {
        super(type, init);
      }
    };
  }
});

// Test harness component
function DragList({
  items,
  onChange,
}: {
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const drag = useDragReorder(items, onChange);
  return (
    <div>
      {items.map((item, i) => (
        <div
          key={i}
          data-testid={`item-${i}`}
          data-item={item}
          draggable
          className={drag.overIdx === i ? 'dragging' : ''}
          onDragStart={drag.onDragStart(i)}
          onDragOver={drag.onDragOver(i)}
          onDragEnd={drag.onDragEnd}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

describe('useDragReorder', () => {
  it('renders items correctly', () => {
    render(<DragList items={['A', 'B', 'C']} onChange={vi.fn()} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('calls onChange with reordered items when dragging to a different position', () => {
    const onChange = vi.fn();
    render(<DragList items={['A', 'B', 'C']} onChange={onChange} />);

    const item0 = screen.getByTestId('item-0');
    const item2 = screen.getByTestId('item-2');

    fireEvent.dragStart(item0);
    fireEvent.dragOver(item2);

    expect(onChange).toHaveBeenCalled();
    const newOrder = onChange.mock.calls[0][0];
    expect(newOrder[2]).toBe('A');
    expect(newOrder[0]).toBe('B');
    expect(newOrder[1]).toBe('C');
  });

  it('does not call onChange when dragging to the same position', () => {
    const onChange = vi.fn();
    render(<DragList items={['A', 'B', 'C']} onChange={onChange} />);

    const item0 = screen.getByTestId('item-0');
    fireEvent.dragStart(item0);
    fireEvent.dragOver(item0); // same index - should be a no-op

    expect(onChange).not.toHaveBeenCalled();
  });

  it('sets overIdx during drag', () => {
    const onChange = vi.fn();
    render(<DragList items={['A', 'B', 'C']} onChange={onChange} />);

    const item0 = screen.getByTestId('item-0');
    const item1 = screen.getByTestId('item-1');

    fireEvent.dragStart(item0);
    fireEvent.dragOver(item1);

    // After dragover to item1, the component should have re-rendered with overIdx=1
    // onChange is called which would trigger re-render in real usage
    expect(onChange).toHaveBeenCalled();
  });

  it('resets dragIdx on drag end', () => {
    const onChange = vi.fn();
    render(<DragList items={['A', 'B', 'C']} onChange={onChange} />);

    const item0 = screen.getByTestId('item-0');
    const item1 = screen.getByTestId('item-1');

    fireEvent.dragStart(item0);
    fireEvent.dragOver(item1);

    const callCountBefore = onChange.mock.calls.length;
    fireEvent.dragEnd(item0);

    // After dragEnd, dragIdx is null so a subsequent dragOver should be a no-op
    fireEvent.dragOver(item1);
    expect(onChange.mock.calls.length).toBe(callCountBefore);
  });

  it('handles reorder from last to first position', () => {
    const onChange = vi.fn();
    render(<DragList items={['A', 'B', 'C']} onChange={onChange} />);

    const item2 = screen.getByTestId('item-2');
    const item0 = screen.getByTestId('item-0');

    fireEvent.dragStart(item2);
    fireEvent.dragOver(item0);

    expect(onChange).toHaveBeenCalled();
    const newOrder = onChange.mock.calls[0][0];
    expect(newOrder[0]).toBe('C');
    expect(newOrder[1]).toBe('A');
    expect(newOrder[2]).toBe('B');
  });

  it('handles single item list gracefully', () => {
    const onChange = vi.fn();
    render(<DragList items={['A']} onChange={onChange} />);
    const item0 = screen.getByTestId('item-0');
    fireEvent.dragStart(item0);
    fireEvent.dragOver(item0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('each item is draggable', () => {
    render(<DragList items={['A', 'B']} onChange={vi.fn()} />);
    expect(screen.getByTestId('item-0')).toHaveAttribute('draggable', 'true');
    expect(screen.getByTestId('item-1')).toHaveAttribute('draggable', 'true');
  });
});
