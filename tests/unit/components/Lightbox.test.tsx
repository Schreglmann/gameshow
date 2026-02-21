import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Lightbox, useLightbox } from '@/components/layout/Lightbox';
import { act } from '@testing-library/react';

describe('Lightbox', () => {
  it('renders nothing when src is null', () => {
    const { container } = render(<Lightbox src={null} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders overlay with image when src is provided', () => {
    render(<Lightbox src="/test-image.jpg" onClose={vi.fn()} />);
    const overlay = document.getElementById('imageLightbox');
    expect(overlay).toBeInTheDocument();

    const img = overlay!.querySelector('img');
    expect(img).toHaveAttribute('src', '/test-image.jpg');
  });

  it('calls onClose when overlay is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Lightbox src="/test.jpg" onClose={onClose} />);

    const overlay = document.getElementById('imageLightbox')!;
    await user.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(<Lightbox src="/test.jpg" onClose={onClose} />);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });

    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when ArrowRight key is pressed (to prevent nav)', () => {
    const onClose = vi.fn();
    render(<Lightbox src="/test.jpg" onClose={onClose} />);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
    });

    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when ArrowLeft key is pressed', () => {
    const onClose = vi.fn();
    render(<Lightbox src="/test.jpg" onClose={onClose} />);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
      );
    });

    expect(onClose).toHaveBeenCalled();
  });

  it('does not listen for keys when src is null', () => {
    const onClose = vi.fn();
    render(<Lightbox src={null} onClose={onClose} />);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('useLightbox', () => {
  function TestComponent() {
    const { lightboxSrc, openLightbox, closeLightbox } = useLightbox();
    return (
      <div>
        <div data-testid="src">{lightboxSrc ?? 'null'}</div>
        <button onClick={() => openLightbox('/test.jpg')}>Open</button>
        <button onClick={() => closeLightbox()}>Close</button>
      </div>
    );
  }

  it('starts with null lightboxSrc', () => {
    render(<TestComponent />);
    expect(screen.getByTestId('src').textContent).toBe('null');
  });

  it('sets lightboxSrc when openLightbox is called', async () => {
    const user = userEvent.setup();
    render(<TestComponent />);

    await user.click(screen.getByText('Open'));
    expect(screen.getByTestId('src').textContent).toBe('/test.jpg');
  });

  it('clears lightboxSrc when closeLightbox is called', async () => {
    const user = userEvent.setup();
    render(<TestComponent />);

    await user.click(screen.getByText('Open'));
    await user.click(screen.getByText('Close'));
    expect(screen.getByTestId('src').textContent).toBe('null');
  });
});
