import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GamemasterButtonDef } from '@/types/game';

interface Props {
  /** The button the popover belongs to; it is positioned next to it. */
  anchor: HTMLElement;
  /** Heading of the popover, usually the tapped button's label. */
  title: string;
  items: GamemasterButtonDef[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

const GAP = 6;
const EDGE = 8;

/**
 * Popover for a gamemaster button that carries a `menu` (e.g. a player on the
 * start screen: "Zu Team 2" / "Entfernen"). See specs/team-management.md
 * ("GM button menu").
 *
 * Portalled to `document.body`: the GM panel is a scrolling/transformed
 * ancestor, which on iOS Safari becomes the containing block for
 * `position: fixed` and would clip the popover to it. Both the popover and its
 * transparent backdrop carry `data-gm-no-nav`, so dismissing it with a tap on
 * empty space never advances the show behind it. Closes on Escape and on any
 * scroll, since it is positioned from the anchor's rect.
 */
export default function GmButtonMenu({ anchor, title, items, onSelect, onClose }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const a = anchor.getBoundingClientRect();
    const { width, height } = box.getBoundingClientRect();
    const below = a.bottom + GAP;
    const top = below + height > window.innerHeight - EDGE && a.top - GAP - height >= EDGE
      ? a.top - GAP - height
      : below;
    const centred = a.left + a.width / 2 - width / 2;
    const left = Math.max(EDGE, Math.min(centred, window.innerWidth - width - EDGE));
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Capture phase: any scrolling container moves the anchor out from under us.
    const onScroll = (e: Event) => {
      if (boxRef.current && e.target instanceof Node && boxRef.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  useEffect(() => {
    boxRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, []);

  return createPortal(
    <>
      <div className="gm-menu-backdrop" onClick={onClose} data-gm-no-nav />
      <div
        ref={boxRef}
        className="gm-menu-popover"
        role="menu"
        aria-label={title}
        data-gm-no-nav
        style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
      >
        <div className="gm-menu-title">{title}</div>
        {items.map(item => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`gm-btn gm-menu-item${item.variant ? ` gm-btn--${item.variant}` : ''}`}
            disabled={item.disabled}
            onClick={() => {
              onSelect(item.id);
              onClose();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}
