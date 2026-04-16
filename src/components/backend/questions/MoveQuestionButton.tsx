import { useState, useRef, useEffect } from 'react';

interface Props {
  otherInstances: string[];
  onMove: (targetInstance: string) => void;
}

export default function MoveQuestionButton({ otherInstances, onMove }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (otherInstances.length === 0) return null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="be-delete-btn"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        title="Zu anderer Instanz verschieben"
        style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(var(--glass-rgb),0.12)', background: open ? 'rgba(var(--admin-accent-deep-rgb),0.2)' : 'rgba(var(--glass-rgb),0.06)', color: open ? 'var(--admin-accent-light)' : 'rgba(var(--text-rgb),0.6)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 17l9.2-9.2M17 17V7H7" />
        </svg>
      </button>
      {open && (
        <div
          style={{ position: 'absolute', top: 'calc(100% + 2px)', right: 0, zIndex: 150, background: 'var(--admin-select-bg)', border: '1px solid rgba(var(--glass-rgb),0.18)', borderRadius: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.55)', minWidth: 120, overflow: 'hidden' }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ padding: '4px 10px', fontSize: 11, color: 'rgba(var(--text-rgb),0.4)', borderBottom: '1px solid rgba(var(--glass-rgb),0.08)' }}>
            Verschieben nach
          </div>
          {otherInstances.map(inst => (
            <button
              key={inst}
              onClick={() => { onMove(inst); setOpen(false); }}
              style={{ display: 'block', width: '100%', padding: '6px 10px', margin: 0, textAlign: 'left', border: 'none', borderRadius: 0, background: 'transparent', color: 'rgba(var(--text-rgb),0.85)', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', textTransform: 'none', letterSpacing: 'normal', fontWeight: 'normal', boxShadow: 'none' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(var(--glass-rgb),0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              → {inst}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
