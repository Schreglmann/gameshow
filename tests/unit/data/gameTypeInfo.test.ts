import { describe, it, expect } from 'vitest';
import { gameTypesShareQuestionShape } from '@/data/gameTypeInfo';

describe('gameTypesShareQuestionShape', () => {
  it('treats a type as compatible with itself', () => {
    expect(gameTypesShareQuestionShape('simple-quiz', 'simple-quiz')).toBe(true);
    expect(gameTypesShareQuestionShape('quizjagd', 'quizjagd')).toBe(true);
  });

  it('treats simple-quiz and bet-quiz as compatible in both directions', () => {
    expect(gameTypesShareQuestionShape('simple-quiz', 'bet-quiz')).toBe(true);
    expect(gameTypesShareQuestionShape('bet-quiz', 'simple-quiz')).toBe(true);
  });

  it('treats types with distinct question shapes as incompatible', () => {
    expect(gameTypesShareQuestionShape('simple-quiz', 'q1')).toBe(false);
    expect(gameTypesShareQuestionShape('bet-quiz', 'guessing-game')).toBe(false);
    expect(gameTypesShareQuestionShape('audio-guess', 'video-guess')).toBe(false);
    expect(gameTypesShareQuestionShape('quizjagd', 'simple-quiz')).toBe(false);
  });
});
