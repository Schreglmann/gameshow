import { Fragment, useRef, useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { RulesPreset } from '@/types/config';
import { useDragReorder } from './useDragReorder';
import { PLACEHOLDER_TASK_LINE } from '@/utils/rulesPreset';
import { useConfirm } from './ConfirmContext';

interface Props {
  rules: string[];
  onChange: (rules: string[]) => void;
  placeholder?: string;
  /** Extra controls pinned to the right of the bottom row. */
  extra?: ReactNode;
  /** Extra controls placed in the middle of the bottom row (between left controls and right controls). */
  extraCenter?: ReactNode;
  /** When true, row 0 is rendered as the game-specific "Aufgabe" task line (special badge, placeholder, non-deletable). */
  taskLine?: boolean;
  /** When provided, the bottom row gains a "Vorlage" toggle button and (when expanded) a preset-buttons row below. */
  presets?: RulesPreset[];
  /** Controlled — the id of the currently linked preset (or undefined for free-form mode). */
  activePresetId?: string;
  /** Click handler for preset buttons. Called with `undefined` when the active preset is clicked again. */
  onPresetChange?: (id: string | undefined) => void;
}

export default function RulesEditor({
  rules,
  onChange,
  placeholder = 'Neue Regel...',
  extra,
  extraCenter,
  taskLine = false,
  presets,
  activePresetId,
  onPresetChange,
}: Props) {
  const confirmDialog = useConfirm();
  const drag = useDragReorder(rules, onChange);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const cursorRef = useRef<{ index: number; pos: number } | null>(null);

  // Whether the preset-button row is expanded. On mount, expanded iff a preset is already
  // linked (so the user can see/deselect it); afterwards the user controls it explicitly.
  const [presetsExpanded, setPresetsExpanded] = useState<boolean>(!!activePresetId);

  useLayoutEffect(() => {
    if (cursorRef.current) {
      const { index, pos } = cursorRef.current;
      inputRefs.current[index]?.setSelectionRange(pos, pos);
      cursorRef.current = null;
    }
  });

  const update = (i: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const next = [...rules];
    next[i] = e.target.value;
    cursorRef.current = { index: i, pos: e.target.selectionStart ?? e.target.value.length };
    onChange(next);
  };

  const remove = async (i: number) => { if (await confirmDialog({ title: 'Regel entfernen?', confirmLabel: 'Entfernen' })) onChange(rules.filter((_, idx) => idx !== i)); };

  const activePreset = activePresetId && presets ? presets.find(p => p.id === activePresetId) : undefined;
  const hasPresets = presets && presets.length > 0;

  const visibleTaskLine = taskLine && activePreset ? (rules[0] ?? PLACEHOLDER_TASK_LINE) : null;

  // Spacers only appear in linked mode, and only when the linked rows are fewer than the
  // user's underlying custom rules. In free-form mode, the row count tracks `rules` exactly
  // so adding/removing rules leaves no residual space.
  const linkedRowCount = activePreset ? 1 + activePreset.rules.length : 0;
  const spacerCount = activePreset ? Math.max(0, rules.length - linkedRowCount) : 0;

  return (
    <div>
      {activePreset ? (
        <>
          {/* Row 0 — the task line, still editable */}
          <div className="be-list-row be-task-row">
            <span className="be-aufgabe-badge">Aufgabe</span>
            <input
              ref={el => { inputRefs.current[0] = el; }}
              className="be-input"
              value={visibleTaskLine ?? ''}
              placeholder={PLACEHOLDER_TASK_LINE}
              onChange={e => {
                const next = rules.length > 0 ? [...rules] : [''];
                next[0] = e.target.value;
                cursorRef.current = { index: 0, pos: e.target.selectionStart ?? e.target.value.length };
                onChange(next);
              }}
            />
            <span className="be-delete-btn-spacer" aria-hidden="true" />
          </div>
          <div className="be-rules-divider" />
          {/* Locked preset rows */}
          {activePreset.rules.map((rule, i) => (
            <div key={`preset-${i}`} className="be-list-row be-rule-locked">
              <span className="drag-handle be-drag-disabled" aria-hidden="true">⠿</span>
              <div className="be-input be-rule-locked-text">{rule}</div>
              <span className="be-delete-btn-spacer" aria-hidden="true" />
            </div>
          ))}
        </>
      ) : (
        <>
          {rules.map((rule, i) => {
            const isTaskRow = taskLine && i === 0;
            return (
              <Fragment key={i}>
                <div
                  className={`be-list-row${drag.overIdx === i ? ' be-dragging' : ''}${isTaskRow ? ' be-task-row' : ''}`}
                  onDragOver={drag.onDragOver(i)}
                >
                  {isTaskRow ? (
                    <span className="be-aufgabe-badge">Aufgabe</span>
                  ) : (
                    <span
                      className="drag-handle"
                      style={{ fontSize: 'var(--admin-sz-14, 14px)' }}
                      draggable
                      onDragStart={drag.onDragStart(i)}
                      onDragEnd={drag.onDragEnd}
                    >⠿</span>
                  )}
                  <input
                    ref={el => { inputRefs.current[i] = el; }}
                    className="be-input"
                    value={rule}
                    placeholder={isTaskRow ? PLACEHOLDER_TASK_LINE : placeholder}
                    onChange={e => update(i, e)}
                  />
                  {isTaskRow ? (
                    <span className="be-delete-btn-spacer" aria-hidden="true" />
                  ) : (
                    <button className="be-delete-btn" onClick={() => remove(i)} title="Entfernen">🗑</button>
                  )}
                </div>
                {isTaskRow && rules.length > 1 && <div className="be-rules-divider" />}
              </Fragment>
            );
          })}
          {/* When the editor has only the task row (no other rules yet), show the divider
              anyway so the layout matches linked-mode and doesn't shift on first rule add. */}
          {taskLine && rules.length === 1 && <div className="be-rules-divider" />}
        </>
      )}
      {/* Invisible spacer rows: preserve the editor height when in linked mode AND the
          preset has fewer rows than the user's underlying custom rules. Mirrors a real
          row's DOM so the spacer height is exactly one row tall. */}
      {Array.from({ length: spacerCount }).map((_, i) => (
        <div key={`spacer-${i}`} className="be-list-row be-rule-spacer" aria-hidden="true">
          <span className="drag-handle">⠿</span>
          <input className="be-input" tabIndex={-1} readOnly value="" />
          <span className="be-delete-btn-spacer" />
        </div>
      ))}
      <div className="be-rules-bottom-row">
        <div className="be-rules-bottom-left">
          <button
            className="be-icon-btn"
            onClick={() => onChange([...rules, ''])}
            disabled={!!activePreset}
            title={activePreset ? 'Vorlage entfernen, um eigene Regeln hinzuzufügen' : undefined}
          >
            + Hinzufügen
          </button>
          {hasPresets && (
            <button
              type="button"
              className={`be-icon-btn be-presets-toggle${presetsExpanded ? ' is-active' : ''}`}
              onClick={() => setPresetsExpanded(e => !e)}
              aria-expanded={presetsExpanded}
              title={presetsExpanded ? 'Vorlagen ausblenden' : 'Vorlagen einblenden'}
            >
              <span>Vorlage</span>
              <span className="be-presets-toggle-arrow" aria-hidden="true">▾</span>
            </button>
          )}
        </div>
        {extraCenter && <div className="be-rules-bottom-center">{extraCenter}</div>}
        <div className="be-rules-bottom-right">{extra}</div>
      </div>
      {hasPresets && presetsExpanded && (
        <div className="be-preset-buttons">
          {presets!.map(preset => {
            const isActive = preset.id === activePresetId;
            return (
              <button
                key={preset.id}
                type="button"
                className={`be-icon-btn${isActive ? ' is-active' : ''}`}
                onClick={() => onPresetChange?.(isActive ? undefined : preset.id)}
                title={preset.rules.join(' • ')}
              >
                {preset.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
