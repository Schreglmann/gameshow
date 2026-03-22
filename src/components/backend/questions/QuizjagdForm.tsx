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
          <span className="diff-easy">Leicht: {easy}</span>
          <span className="diff-medium">Mittel: {medium}</span>
          <span className="diff-hard">Schwer: {hard}</span>
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
          className={`question-block ${drag.overIdx === i ? 'be-dragging' : ''}`}
          style={{ borderLeftWidth: 3, borderLeftStyle: 'solid', ...{ borderLeftColor: DIFF_STYLES[q.difficulty]?.borderColor ?? 'transparent' } }}
          draggable
          onDragStart={drag.onDragStart(i)}
          onDragOver={drag.onDragOver(i)}
          onDragEnd={drag.onDragEnd}
        >
          <div className="question-block-top">
            <span className="drag-handle">⠿</span>
            <span className="question-num">#{i + 1}</span>
            {/* Difficulty selector inline */}
            <div style={{ display: 'flex', gap: 3 }}>
              {([3, 5, 7] as const).map(d => (
                <button
                  key={d}
                  className="be-icon-btn"
                  style={{ padding: '3px 9px', fontSize: 11, ...(q.difficulty === d ? DIFF_STYLES[d] : {}) }}
                  onClick={() => update(i, { difficulty: d })}
                >
                  {DIFF_LABELS[d]}
                </button>
              ))}
            </div>
            <label className="be-checkbox-row" style={{ margin: 0, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={q.isExample ?? false}
                onChange={e => update(i, { isExample: e.target.checked || undefined })}
              />
              Beispiel
            </label>
            <button className="be-delete-btn" onClick={() => duplicate(i)} title="Duplizieren" style={{ width: 30, height: 30, borderRadius: 5, fontSize: 17, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}>⧉</button>
            <button className="be-delete-btn" onClick={() => remove(i)} title="Löschen" style={{ width: 30, height: 30, borderRadius: 5, fontSize: 17, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}>🗑</button>
          </div>
          <div className="question-fields">
            <div>
              <label className="be-label">Frage</label>
              <input className="be-input" value={q.question} onChange={e => update(i, { question: e.target.value })} />
            </div>
            <div>
              <label className="be-label">Antwort</label>
              <input className="be-input" value={q.answer} onChange={e => update(i, { answer: e.target.value })} />
            </div>
          </div>
        </div>
      ))}
      <button className="be-icon-btn" onClick={() => onChange([...questions, empty()])} style={{ marginTop: 4 }}>
        + Frage hinzufügen
      </button>
    </div>
  );
}
