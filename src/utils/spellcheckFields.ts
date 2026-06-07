/**
 * spellcheckFields — the single source of truth for "which text in a game is
 * German prose that should be spell/grammar-checked".
 *
 * Used by:
 *   - the per-game check button (current instance) — `segmentsForCurrentInstance`
 *   - the whole-show Lektorat tab (every instance) — `segmentsForGameFile`
 *   - the inline `<SpellField segKey>` underlines (Phase 2), which compute the
 *     same `key`s so matches line up with fields.
 *
 * A segment's `key` is an instance-relative UI id (e.g. `q3.answer`). A segment's
 * `path` is rooted at the whole game FILE object so `applyReplacement` can splice
 * a correction regardless of single- vs multi-instance layout.
 */

import type { GameType } from '@/types/config';

export interface SpellSegment {
  /** Instance-relative id, unique within one instance's segment list. Matches `<SpellField segKey>`. */
  key: string;
  /** German human label for the report, e.g. "Frage 4 · Antwort". */
  label: string;
  /** The prose text to check (never empty/whitespace — those are skipped). */
  text: string;
  /** Path into the game FILE object for applyReplacement (e.g. ['instances','v1','questions',3,'answer']). */
  path: (string | number)[];
}

// ── Per-question prose field descriptors ──

type ProseField =
  | { kind: 'scalar'; field: string; label: string }
  | { kind: 'array'; field: string; label: string }
  | { kind: 'objarray'; field: string; sub: string; label: string };

/** Prose fields per game type. Anything not listed (filenames, asset paths, numbers,
 *  hex colors, FAKT/FAKE, flags) is intentionally excluded and never checked. */
const QUESTION_FIELDS: Record<GameType, ProseField[]> = {
  'simple-quiz': [
    { kind: 'scalar', field: 'question', label: 'Fragetext' },
    { kind: 'scalar', field: 'answer', label: 'Antwort' },
    { kind: 'scalar', field: 'info', label: 'Zusatzinfo' },
    { kind: 'scalar', field: 'category', label: 'Kategorie' },
    { kind: 'array', field: 'answerList', label: 'Antwort' },
  ],
  'bet-quiz': [
    { kind: 'scalar', field: 'question', label: 'Fragetext' },
    { kind: 'scalar', field: 'answer', label: 'Antwort' },
    { kind: 'scalar', field: 'info', label: 'Zusatzinfo' },
    { kind: 'scalar', field: 'category', label: 'Kategorie' },
    { kind: 'array', field: 'answerList', label: 'Antwort' },
  ],
  'guessing-game': [
    { kind: 'scalar', field: 'question', label: 'Fragetext' },
    // answer is a number — excluded
  ],
  'final-quiz': [
    { kind: 'scalar', field: 'question', label: 'Fragetext' },
    { kind: 'scalar', field: 'answer', label: 'Antwort' },
  ],
  'audio-guess': [
    { kind: 'scalar', field: 'answer', label: 'Antwort' },
  ],
  'video-guess': [
    { kind: 'scalar', field: 'question', label: 'Fragetext' },
    { kind: 'scalar', field: 'answer', label: 'Antwort' },
  ],
  'image-guess': [
    { kind: 'scalar', field: 'answer', label: 'Antwort' },
  ],
  'colorguess': [
    { kind: 'scalar', field: 'answer', label: 'Antwort' },
  ],
  'bandle': [
    { kind: 'scalar', field: 'answer', label: 'Antwort' },
    { kind: 'scalar', field: 'hint', label: 'Hinweis' },
    { kind: 'objarray', field: 'tracks', sub: 'label', label: 'Spur' },
  ],
  'q1': [
    { kind: 'scalar', field: 'Frage', label: 'Fragetext' },
    { kind: 'array', field: 'trueStatements', label: 'Wahre Aussage' },
    { kind: 'scalar', field: 'wrongStatement', label: 'Falsche Aussage' },
    { kind: 'scalar', field: 'answer', label: 'Antwort' },
  ],
  'four-statements': [
    { kind: 'scalar', field: 'topic', label: 'Thema' },
    { kind: 'array', field: 'statements', label: 'Aussage' },
    { kind: 'scalar', field: 'answer', label: 'Antwort' },
  ],
  'ranking': [
    { kind: 'scalar', field: 'question', label: 'Fragetext' },
    { kind: 'scalar', field: 'topic', label: 'Thema' },
    { kind: 'array', field: 'answers', label: 'Antwort' },
  ],
  'wer-kennt-mehr': [
    { kind: 'scalar', field: 'question', label: 'Fragetext' },
    { kind: 'scalar', field: 'info', label: 'Zusatzinfo' },
    { kind: 'scalar', field: 'answer', label: 'Antwort' },
    { kind: 'array', field: 'answerList', label: 'Antwort' },
  ],
  'fact-or-fake': [
    { kind: 'scalar', field: 'statement', label: 'Aussage' },
    { kind: 'scalar', field: 'description', label: 'Beschreibung' },
  ],
  'quizjagd': [
    { kind: 'scalar', field: 'question', label: 'Fragetext' },
    { kind: 'scalar', field: 'answer', label: 'Antwort' },
  ],
  'random-frame': [
    { kind: 'scalar', field: 'question', label: 'Fragetext' },
    { kind: 'scalar', field: 'answer', label: 'Antwort' },
  ],
};

const INSTANCE_RESERVED_KEYS = new Set(['template', 'archive']);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function questionLabel(index: number): string {
  return `Frage ${index + 1}`;
}

/**
 * Build segments for one instance of a game file.
 * @param gameFile  the full file object (single-instance config, or multi-instance file)
 * @param instanceKey  null for single-instance; otherwise the instance key
 * @param includeBase  whether to emit the file-level title/rules (set false to avoid duplicates
 *                      when scanning multiple instances of the same file)
 */
export function getSegments(
  gameFile: Record<string, any>,
  instanceKey: string | null,
  includeBase = true,
): SpellSegment[] {
  const segments: SpellSegment[] = [];
  const gameType = gameFile?.type as GameType | undefined;
  const fields = (gameType && QUESTION_FIELDS[gameType]) || [];

  const container = instanceKey === null ? gameFile : gameFile?.instances?.[instanceKey];
  if (!container) return segments;
  const questionsPath: (string | number)[] =
    instanceKey === null ? ['questions'] : ['instances', instanceKey, 'questions'];

  // File-level title + rules (once per file).
  if (includeBase) {
    if (isNonEmptyString(gameFile.title)) {
      segments.push({ key: 'title', label: 'Titel', text: gameFile.title, path: ['title'] });
    }
    if (Array.isArray(gameFile.rules)) {
      gameFile.rules.forEach((r: unknown, n: number) => {
        if (isNonEmptyString(r)) {
          segments.push({ key: `rules.${n}`, label: `Regel ${n + 1}`, text: r, path: ['rules', n] });
        }
      });
    }
  }

  // Per-instance title/rules overrides (multi-instance only).
  if (instanceKey !== null) {
    if (isNonEmptyString(container.title)) {
      segments.push({
        key: 'instanceTitle', label: 'Instanz-Titel', text: container.title,
        path: ['instances', instanceKey, 'title'],
      });
    }
    if (Array.isArray(container.rules)) {
      container.rules.forEach((r: unknown, n: number) => {
        if (isNonEmptyString(r)) {
          segments.push({
            key: `instanceRules.${n}`, label: `Instanz-Regel ${n + 1}`, text: r,
            path: ['instances', instanceKey, 'rules', n],
          });
        }
      });
    }
  }

  // Per-question prose.
  const questions = container.questions;
  if (Array.isArray(questions)) {
    questions.forEach((q: any, i: number) => {
      if (!q || typeof q !== 'object') return;
      for (const spec of fields) {
        if (spec.kind === 'scalar') {
          const v = q[spec.field];
          if (isNonEmptyString(v)) {
            segments.push({
              key: `q${i}.${spec.field}`,
              label: `${questionLabel(i)} · ${spec.label}`,
              text: v,
              path: [...questionsPath, i, spec.field],
            });
          }
        } else if (spec.kind === 'array') {
          const arr = q[spec.field];
          if (Array.isArray(arr)) {
            arr.forEach((v: unknown, n: number) => {
              if (isNonEmptyString(v)) {
                segments.push({
                  key: `q${i}.${spec.field}.${n}`,
                  label: `${questionLabel(i)} · ${spec.label} ${n + 1}`,
                  text: v,
                  path: [...questionsPath, i, spec.field, n],
                });
              }
            });
          }
        } else {
          // objarray, e.g. bandle tracks[].label
          const arr = q[spec.field];
          if (Array.isArray(arr)) {
            arr.forEach((obj: any, n: number) => {
              const v = obj?.[spec.sub];
              if (isNonEmptyString(v)) {
                segments.push({
                  key: `q${i}.${spec.field}.${n}.${spec.sub}`,
                  label: `${questionLabel(i)} · ${spec.label} ${n + 1}`,
                  text: v,
                  path: [...questionsPath, i, spec.field, n, spec.sub],
                });
              }
            });
          }
        }
      }
    });
  }

  return segments;
}

/** Segments for the instance currently open in the editor. `activeInstance` is
 *  `'__single__'` for single-instance games (see GameEditor). */
export function segmentsForCurrentInstance(
  gameFile: Record<string, any>,
  activeInstance: string,
): SpellSegment[] {
  const isMulti = !!gameFile?.instances && activeInstance !== '__single__';
  return getSegments(gameFile, isMulti ? activeInstance : null, true);
}

/** Segments for every instance of a game file, for the whole-show scan. Base
 *  title/rules are attached to the first instance only (no duplicate flagging). */
export function segmentsForGameFile(
  gameFile: Record<string, any>,
): { instanceKey: string | null; segments: SpellSegment[] }[] {
  if (gameFile?.instances && typeof gameFile.instances === 'object') {
    const keys = Object.keys(gameFile.instances).filter(k => !INSTANCE_RESERVED_KEYS.has(k.toLowerCase()));
    return keys.map((key, idx) => ({
      instanceKey: key,
      segments: getSegments(gameFile, key, idx === 0),
    }));
  }
  return [{ instanceKey: null, segments: getSegments(gameFile, null, true) }];
}

/**
 * Immutably apply a replacement to the string at `path`, splicing
 * [offset, offset+length) with `replacement`. Returns a new root with structural
 * sharing; the original is untouched. Offsets are UTF-16 units (JS string units),
 * matching LanguageTool's offsets for BMP text.
 */
export function applyReplacement(
  root: any,
  path: (string | number)[],
  offset: number,
  length: number,
  replacement: string,
): any {
  if (path.length === 0) return root;
  const [head, ...rest] = path;
  const clone: any = Array.isArray(root) ? [...root] : { ...root };
  if (rest.length === 0) {
    const s = clone[head];
    if (typeof s === 'string') {
      clone[head] = s.slice(0, offset) + replacement + s.slice(offset + length);
    }
  } else {
    clone[head] = applyReplacement(clone[head], rest, offset, length, replacement);
  }
  return clone;
}

/* eslint-enable @typescript-eslint/no-explicit-any */
