import { test, expect, type Page } from '@playwright/test';
import { isolateShowWsState, waitForGameReady } from '../_helpers/setup';

// Spec: specs/crash-recovery.md — "Resume after reload".
//
// `GET /api/game/0` is mocked with a randomised simple-quiz so the test does not
// depend on the (encrypted) active gameshow. With ten questions the chance that a
// re-shuffle after the reload happens to reproduce the same order is negligible.
const QUESTIONS = [
  { question: 'Beispielfrage', answer: 'Beispiel' },
  ...Array.from({ length: 10 }, (_, i) => ({ question: `Frage ${String.fromCharCode(65 + i)}`, answer: `Antwort ${i + 1}` })),
];

const GAME = {
  gameId: 'e2e-crash-recovery/v1',
  currentIndex: 0,
  totalGames: 1,
  pointSystemEnabled: true,
  config: {
    type: 'simple-quiz',
    title: 'Wiederaufnahme-Test',
    rules: [],
    randomizeQuestions: true,
    questions: QUESTIONS,
  },
};

async function questionText(page: Page): Promise<string> {
  return (await page.locator('.quiz-question').first().innerText()).trim();
}

/** One question forward in simple-quiz: reveal the answer, then the next question. */
async function nextQuestion(page: Page): Promise<void> {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
}

test.describe('Crash recovery — resume after reload', () => {
  test.beforeEach(async ({ page }) => {
    await isolateShowWsState(page);
    await page.route('**/api/game/0', route => route.fulfill({ json: GAME }));
  });

  test('a reload reopens the same question, in the same shuffled order', async ({ page }) => {
    await page.goto('/show/game?index=0');
    await waitForGameReady(page);
    await expect(page.locator('#landingScreen')).toBeVisible();

    await page.keyboard.press('ArrowRight'); // landing → game (no rules)
    await expect(page.locator('.quiz-question')).toHaveText('Beispielfrage');

    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      await nextQuestion(page);
      seen.push(await questionText(page));
    }

    await page.reload();
    await waitForGameReady(page);

    // Same game, game phase (no title screen), same question.
    await expect(page.locator('#landingScreen')).toHaveCount(0);
    await expect(page.locator('.quiz-question')).toHaveText(seen[3]!);

    // Same order: stepping back shows the question that came before it.
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(250);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(250);
    await expect(page.locator('.quiz-question')).toHaveText(seen[2]!);
  });

  test('a reload on the title screen stays on the title screen', async ({ page }) => {
    await page.goto('/show/game?index=0');
    await waitForGameReady(page);
    await expect(page.locator('#landingScreen')).toBeVisible();
    await page.reload();
    await waitForGameReady(page);
    await expect(page.locator('#landingScreen')).toBeVisible();
  });
});
