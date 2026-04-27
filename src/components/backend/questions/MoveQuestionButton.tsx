import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  otherInstances: string[];
  onMove: (targetInstance: string) => void;
}

export default function MoveQuestionButton({ otherInstances, onMove }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // The parent `.question-block` establishes a stacking context (via `contain: layout style`),
  // which traps absolute-positioned children behind sibling blocks. Render through a portal
  // and compute viewport-relative coords so the dropdown floats above any later ghost rows.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 2, right: window.innerWidth - r.right });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  if (otherInstances.length === 0) return null;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        className="be-delete-btn"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        title="Zu anderer Instanz verschieben"
        style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(var(--glass-rgb),0.12)', background: open ? 'rgba(var(--admin-accent-deep-rgb),0.2)' : 'rgba(var(--glass-rgb),0.06)', color: open ? 'var(--admin-accent-light)' : 'rgba(var(--text-rgb),0.6)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 17l9.2-9.2M17 17V7H7" />
        </svg>
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 10000, background: 'var(--admin-select-bg)', border: '1px solid rgba(var(--glass-rgb),0.18)', borderRadius: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.55)', minWidth: 120, overflow: 'hidden' }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ padding: '4px 10px', fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(var(--text-rgb),0.4)', borderBottom: '1px solid rgba(var(--glass-rgb),0.08)' }}>
            Verschieben nach
          </div>
          {otherInstances.map(inst => (
            <button
              key={inst}
              onClick={() => { onMove(inst); setOpen(false); }}
              style={{ display: 'block', width: '100%', padding: '6px 10px', margin: 0, textAlign: 'left', border: 'none', borderRadius: 0, background: 'transparent', color: 'rgba(var(--text-rgb),0.85)', cursor: 'pointer', fontSize: 'var(--admin-sz-14, 14px)', fontFamily: 'inherit', textTransform: 'none', letterSpacing: 'normal', fontWeight: 'normal', boxShadow: 'none' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(var(--glass-rgb),0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              → {inst}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
