import { useState } from 'react';
import type { QuizjagdFlatQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';

interface Props {
  questions: QuizjagdFlatQuestion[];
  questionsPerTeam: number;
  onChange: (questions: QuizjagdFlatQuestion[]) => void;
  onChangeQuestionsPerTeam: (n: number) => void;
}

const empty = (): QuizjagdFlatQuestion => ({ question: '', answer: '', difficulty: 5 });

const DIFF_STYLES: Record<number, React.CSSProperties> = {
  3: { background: 'rgba(34,197,94,0.2)', color: '#86efac', borderColor: 'rgba(34,197,94,0.4)' },
  5: { background: 'rgba(234,179,8,0.2)', color: '#fde047', borderColor: 'rgba(234,179,8,0.4)' },
  7: { background: 'rgba(239,68,68,0.2)', color: '#fca5a5', borderColor: 'rgba(239,68,68,0.4)' },
};

const DIFF_LABELS: Record<number, string> = { 3: 'Leicht', 5: 'Mittel', 7: 'Schwer' };

export default function QuizjagdForm({ questions, questionsPerTeam, onChange, onChangeQuestionsPerTeam }: Props) {
  const drag = useDragReorder(questions, onChange);
  const [diffFilter, setDiffFilter] = useState<number | null>(null);

  const easy = questions.filter(q => q.difficulty === 3).length;
  const medium = questions.filter(q => q.difficulty === 5).length;
  const hard = questions.filter(q => q.difficulty === 7).length;

  const update = (i: number, patch: Partial<QuizjagdFlatQuestion>) => {
    const next = [...questions];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => { if (confirm('Frage löschen?')) onChange(questions.filter((_, idx) => idx !== i)); };
  const duplicate = (i: number) => { const next = [...questions]; next.splice(i + 1, 0, { ...questions[i] }); onChange(next); };

  return (
    <div>
      {/* Stats + settings */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <div className="difficulty-summary" style={{ margin: 0 }}>
          {([
            { key: 3, cls: 'diff-easy', label: 'Leicht', count: easy },
            { key: 5, cls: 'diff-medium', label: 'Mittel', count: medium },
            { key: 7, cls: 'diff-hard', label: 'Schwer', count: hard },
          ] as const).map(d => (
            <span
              key={d.key}
              className={d.cls}
              style={{ cursor: 'pointer', opacity: diffFilter !== null && diffFilter !== d.key ? 0.4 : 1 }}
              onClick={() => setDiffFilter(prev => prev === d.key ? null : d.key)}
            >
              {d.label}: {d.count}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label className="be-label" style={{ margin: 0 }}>Fragen/Team:</label>
          <input
            className="be-input"
            type="number"
            style={{ width: 70 }}
            value={questionsPerTeam}
            onChange={e => onChangeQuestionsPerTeam(parseInt(e.target.value, 10) || 10)}
          />
        </div>
      </div>

      {questions.map((q, i) => (
        <div
          key={i}
          className={`question-block ${drag.overIdx === i ? 'be-dragging' : ''} ${q.disabled ? 'question-disabled' : ''}`}
          style={{ borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: DIFF_STYLES[q.difficulty]?.borderColor ?? 'transparent', display: diffFilter !== null && q.difficulty !== diffFilter ? 'none' : undefined }}
          draggable
          onDragStart={drag.onDragStart(i)}
          onDragOver={drag.onDragOver(i)}
          onDragEnd={drag.onDragEnd}
        >
          <div className="question-block-row">
            <span className="drag-handle">⠿</span>
            <span className="question-num">#{i + 1}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {([3, 5, 7] as const).map(d => (
                <button
                  key={d}
                  className="be-icon-btn quizjagd-diff-btn"
                  style={{ padding: '2px 9px', fontSize: 10, lineHeight: 1.2, ...(q.difficulty === d ? DIFF_STYLES[d] : {}) }}
                  onClick={() => update(i, { difficulty: d })}
                >
                  {DIFF_LABELS[d]}
                </button>
              ))}
            </div>
            <div className="question-block-inputs">
              <input className="be-input" value={q.question} placeholder="Frage" onChange={e => update(i, { question: e.target.value })} />
              <input className="be-input" value={q.answer} placeholder="Antwort" onChange={e => update(i, { answer: e.target.value })} />
            </div>
            <button className="be-delete-btn" onClick={() => update(i, { disabled: !q.disabled || undefined })} title={q.disabled ? 'Aktivieren' : 'Deaktivieren'} style={{ width: 30, height: 30, borderRadius: 5, fontSize: 17, border: '1px solid rgba(255,255,255,0.12)', background: q.disabled ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)', color: q.disabled ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.6)' }}>{q.disabled ? (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>) : (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>)}</button>
            <button className="be-delete-btn" onClick={() => duplicate(i)} title="Duplizieren" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
            <button className="be-delete-btn" onClick={() => remove(i)} title="Löschen" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg></button>
          </div>
        </div>
      ))}
      <button className="be-icon-btn" onClick={() => onChange([...questions, empty()])} style={{ marginTop: 4 }}>
        + Frage hinzufügen
      </button>
    </div>
  );
}
