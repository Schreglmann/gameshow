import { describe, it, expect } from 'vitest';
import { getSegments, segmentsForCurrentInstance, segmentsForGameFile, applyReplacement } from '@/utils/spellcheckFields';

describe('spellcheckFields — getSegments', () => {
  it('extracts prose from a single-instance simple-quiz, excluding non-prose', () => {
    const game = {
      type: 'simple-quiz',
      title: 'Allgemeinwissen',
      rules: ['Beantworte die Frage', 'Zwei Teams'],
      questions: [
        {
          question: 'Was ist die Hauptstadt von Frankreich?',
          answer: 'Paris',
          info: 'Eine Großstadt',
          questionImage: 'images/paris.jpg', // non-prose, excluded
          answerAudio: 'audio/x.mp3',          // non-prose
          timer: 30,                            // non-prose
          questionColors: ['#fff', '#000'],     // non-prose
        },
      ],
    };
    const segs = getSegments(game, null);
    const byKey = Object.fromEntries(segs.map(s => [s.key, s]));

    expect(byKey['title']).toMatchObject({ text: 'Allgemeinwissen', path: ['title'] });
    expect(byKey['rules.0']).toMatchObject({ text: 'Beantworte die Frage', path: ['rules', 0], label: 'Regel 1' });
    expect(byKey['rules.1'].path).toEqual(['rules', 1]);
    expect(byKey['q0.question']).toMatchObject({ path: ['questions', 0, 'question'], label: 'Frage 1 · Fragetext' });
    expect(byKey['q0.answer']).toMatchObject({ text: 'Paris', path: ['questions', 0, 'answer'] });
    expect(byKey['q0.info']).toMatchObject({ text: 'Eine Großstadt' });
    // Non-prose fields produce no segments.
    const keys = segs.map(s => s.key);
    expect(keys.some(k => k.includes('Image') || k.includes('Audio') || k.includes('timer') || k.includes('Colors'))).toBe(false);
  });

  it('excludes the numeric answer of guessing-game but keeps the question', () => {
    const game = { type: 'guessing-game', title: 'Schätzen', questions: [{ question: 'Wie hoch ist der Eiffelturm?', answer: 330 }] };
    const segs = getSegments(game, null);
    expect(segs.find(s => s.key === 'q0.question')).toBeTruthy();
    expect(segs.find(s => s.key === 'q0.answer')).toBeUndefined();
  });

  it('handles q1 arrays + scalars with correct paths and labels', () => {
    const game = {
      type: 'q1',
      title: 'Eins ist falsch',
      questions: [{
        Frage: 'Welche Aussage ist falsch?',
        trueStatements: ['Wahr eins', 'Wahr zwei'],
        wrongStatement: 'Falsch hier',
      }],
    };
    const segs = getSegments(game, null);
    const byKey = Object.fromEntries(segs.map(s => [s.key, s]));
    expect(byKey['q0.Frage'].path).toEqual(['questions', 0, 'Frage']);
    expect(byKey['q0.trueStatements.1']).toMatchObject({ path: ['questions', 0, 'trueStatements', 1], label: 'Frage 1 · Wahre Aussage 2' });
    expect(byKey['q0.wrongStatement'].text).toBe('Falsch hier');
  });

  it('extracts bandle nested track labels (objarray)', () => {
    const game = {
      type: 'bandle',
      title: 'Bandle',
      questions: [{ answer: 'Queen', hint: 'Britische Band', tracks: [{ label: 'Schlagzeug', audio: 'a.mp3' }, { label: 'Gitarre', audio: 'b.mp3' }] }],
    };
    const segs = getSegments(game, null);
    const byKey = Object.fromEntries(segs.map(s => [s.key, s]));
    expect(byKey['q0.answer'].text).toBe('Queen');
    expect(byKey['q0.hint'].text).toBe('Britische Band');
    expect(byKey['q0.tracks.0.label']).toMatchObject({ text: 'Schlagzeug', path: ['questions', 0, 'tracks', 0, 'label'] });
    expect(byKey['q0.tracks.1.label'].path).toEqual(['questions', 0, 'tracks', 1, 'label']);
  });

  it('reads quizjagd in its flat on-disk shape', () => {
    const game = { type: 'quizjagd', title: 'Jagd', questions: [{ question: 'Frage A', answer: 'Antwort A', difficulty: 3 }] };
    const segs = getSegments(game, null);
    expect(segs.find(s => s.key === 'q0.question')?.text).toBe('Frage A');
    expect(segs.find(s => s.key === 'q0.answer')?.text).toBe('Antwort A');
  });

  it('skips empty / whitespace-only strings', () => {
    const game = { type: 'simple-quiz', title: '   ', questions: [{ question: 'Echt', answer: '', info: '  ' }] };
    const segs = getSegments(game, null);
    expect(segs.find(s => s.key === 'title')).toBeUndefined();
    expect(segs.find(s => s.key === 'q0.answer')).toBeUndefined();
    expect(segs.find(s => s.key === 'q0.info')).toBeUndefined();
    expect(segs.find(s => s.key === 'q0.question')).toBeTruthy();
  });

  it('roots multi-instance paths under instances[key] and adds instance overrides', () => {
    const game = {
      type: 'simple-quiz',
      title: 'Basis',
      rules: ['Basisregel'],
      instances: {
        v1: { title: 'Variante 1', rules: ['Instanzregel'], questions: [{ question: 'F1', answer: 'A1' }] },
        v2: { questions: [{ question: 'F2', answer: 'A2' }] },
      },
    };
    const segs = getSegments(game, 'v1');
    const byKey = Object.fromEntries(segs.map(s => [s.key, s]));
    expect(byKey['title'].path).toEqual(['title']);                       // base
    expect(byKey['instanceTitle']).toMatchObject({ text: 'Variante 1', path: ['instances', 'v1', 'title'] });
    expect(byKey['instanceRules.0'].path).toEqual(['instances', 'v1', 'rules', 0]);
    expect(byKey['q0.answer'].path).toEqual(['instances', 'v1', 'questions', 0, 'answer']);
  });
});

describe('spellcheckFields — variants', () => {
  it('segmentsForCurrentInstance uses single layout for __single__', () => {
    const game = { type: 'simple-quiz', title: 'T', questions: [{ question: 'F', answer: 'A' }] };
    const segs = segmentsForCurrentInstance(game, '__single__');
    expect(segs.find(s => s.key === 'q0.answer')?.path).toEqual(['questions', 0, 'answer']);
  });

  it('segmentsForGameFile returns one entry per instance and attaches base only once', () => {
    const game = {
      type: 'simple-quiz', title: 'Basis', rules: ['R'],
      instances: { v1: { questions: [{ answer: 'A1', question: 'Q1' }] }, v2: { questions: [{ answer: 'A2', question: 'Q2' }] } },
    };
    const out = segmentsForGameFile(game);
    expect(out.map(o => o.instanceKey)).toEqual(['v1', 'v2']);
    const baseCount = out.flatMap(o => o.segments).filter(s => s.key === 'title').length;
    expect(baseCount).toBe(1); // base title attached to first instance only
  });

  it('segmentsForGameFile excludes template/archive instances', () => {
    const game = {
      type: 'simple-quiz', title: 'B',
      instances: { template: { questions: [] }, Archive: { questions: [] }, real: { questions: [{ answer: 'A', question: 'Q' }] } },
    };
    const out = segmentsForGameFile(game);
    expect(out.map(o => o.instanceKey)).toEqual(['real']);
  });
});

describe('spellcheckFields — applyReplacement', () => {
  const base = {
    title: 'Hauptstdat',
    rules: ['eine Regel'],
    questions: [{ answer: 'Pariss', statements: ['eins', 'zwei'], tracks: [{ label: 'Gitarre' }] }],
  };

  it('splices a scalar field at the given offset/length', () => {
    const next = applyReplacement(base, ['title'], 0, 'Hauptstdat'.length, 'Hauptstadt');
    expect(next.title).toBe('Hauptstadt');
    expect(base.title).toBe('Hauptstdat'); // immutable
  });

  it('replaces inside an array element via nested path', () => {
    const next = applyReplacement(base, ['questions', 0, 'statements', 1], 0, 4, 'drei');
    expect(next.questions[0].statements[1]).toBe('drei');
    expect(next.questions[0].statements[0]).toBe('eins');
    expect(base.questions[0].statements[1]).toBe('zwei'); // immutable
  });

  it('replaces inside a nested object-array (tracks[].label)', () => {
    const next = applyReplacement(base, ['questions', 0, 'tracks', 0, 'label'], 0, 7, 'Bass');
    expect(next.questions[0].tracks[0].label).toBe('Bass');
  });

  it('handles mid-string splices and preserves surrounding text', () => {
    const obj = { questions: [{ answer: 'Pariss' }] };
    const next = applyReplacement(obj, ['questions', 0, 'answer'], 0, 6, 'Paris');
    expect(next.questions[0].answer).toBe('Paris');
  });
});
