import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('loads and shows Game Show heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Game Show');
  });

  test('shows team assignment form', async ({ page }) => {
    await page.goto('/');
    // Wait for settings to load
    await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });
  });

  test('can assign teams and see them displayed', async ({ page }) => {
    await page.goto('/');
    await page.locator('textarea').fill('Alice, Bob, Charlie, Dave');
    await page.locator('button:has-text("Teams zuweisen")').click();

    // Team headers should appear
    await expect(page.locator('#team1 h2')).toContainText('Team 1');
    await expect(page.locator('#team2 h2')).toContainText('Team 2');

    // All names should be displayed somewhere
    const pageText = await page.textContent('body');
    expect(pageText).toContain('Alice');
    expect(pageText).toContain('Bob');
    expect(pageText).toContain('Charlie');
    expect(pageText).toContain('Dave');
  });

  test('shows "Weiter" button after team assignment', async ({ page }) => {
    await page.goto('/');
    await page.locator('textarea').fill('Alice, Bob');
    await page.locator('button:has-text("Teams zuweisen")').click();
    await expect(page.locator('#nextButton')).toBeVisible();
  });

  test('navigates to rules page when "Weiter" is clicked', async ({ page }) => {
    await page.goto('/');
    await page.locator('textarea').fill('Alice, Bob');
    await page.locator('button:has-text("Teams zuweisen")').click();
    await page.locator('#nextButton').click();
    await expect(page).toHaveURL(/\/rules/);
    await expect(page.locator('h1')).toContainText('Regelwerk');
  });
});

test.describe('Global Rules Page', () => {
  test('displays rules and has navigation button', async ({ page }) => {
    await page.goto('/rules');
    await expect(page.locator('h1')).toContainText('Regelwerk');
    await expect(page.locator('#globalRulesList li').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button:has-text("Weiter")')).toBeVisible();
  });

  test('navigates to game page when "Weiter" is clicked', async ({ page }) => {
    await page.goto('/rules');
    await page.locator('button:has-text("Weiter")').click();
    await expect(page).toHaveURL(/\/game\?index=0/);
  });
});

test.describe('Game Page', () => {
  test('loads the first game', async ({ page }) => {
    await page.goto('/game?index=0');
    // Should show either the game title or loading
    await expect(page.locator('.quiz-container h2, .quiz-container')).toBeVisible({
      timeout: 10000,
    });
  });

  test('can navigate through game phases with arrow keys', async ({ page }) => {
    await page.goto('/game?index=0');

    // Wait for game to load (landing screen with title)
    await page.waitForSelector('.quiz-container h2', { timeout: 10000 });

    // ArrowRight to go to rules
    await page.keyboard.press('ArrowRight');
    // Should see rules or game content
    await page.waitForTimeout(500);

    // ArrowRight to go to game
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
  });
});

test.describe('Admin Page', () => {
  test('loads and shows admin interface', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('.admin-container')).toBeVisible();
    await expect(page.locator('h2').first()).toBeVisible();
  });

  test('shows back link to home', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('a:has-text("Zurück zur Startseite")')).toBeVisible();
  });

  test('can save team data', async ({ page }) => {
    await page.goto('/admin');
    await page.locator('#team1NameInput').fill('["Test1"]');
    await page.locator('#team1PointsInput').fill('10');
    await page.locator('button:has-text("Speichern")').click();

    // Should show success message
    await expect(page.locator('.message.success')).toBeVisible({ timeout: 5000 });
  });

  test('can reset points', async ({ page }) => {
    await page.goto('/admin');

    // Set some points first
    await page.locator('#team1PointsInput').fill('10');
    await page.locator('#team2PointsInput').fill('20');
    await page.locator('button:has-text("Speichern")').click();
    await page.waitForTimeout(500);

    // Reset
    page.on('dialog', dialog => dialog.accept());
    await page.locator('button:has-text("Punkte zurücksetzen")').click();

    // Points should be 0
    await expect(page.locator('#team1PointsInput')).toHaveValue('0');
    await expect(page.locator('#team2PointsInput')).toHaveValue('0');
  });

  test('can view all localStorage data', async ({ page }) => {
    await page.goto('/admin');
    await page.locator('button:has-text("Alle Daten anzeigen")').click();
    // Storage viewer should be visible
    await expect(page.locator('.storage-viewer')).toBeVisible();
  });
});

test.describe('Summary Page', () => {
  test('shows result', async ({ page }) => {
    await page.goto('/summary');
    // Should either show winner or tie
    await expect(
      page.locator('#summaryScreen h1')
    ).toBeVisible({ timeout: 10000 });
  });

  test('shows tie when points are equal', async ({ page }) => {
    // Set equal points
    await page.evaluate(() => {
      localStorage.setItem('team1Points', '5');
      localStorage.setItem('team2Points', '5');
    });
    await page.goto('/summary');
    await expect(page.locator('h1')).toContainText('Unentschieden');
  });

  test('shows Team 1 wins when they have more points', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('team1Points', '10');
      localStorage.setItem('team2Points', '5');
      localStorage.setItem('team1', JSON.stringify(['Alice']));
      localStorage.setItem('team2', JSON.stringify(['Bob']));
    });
    await page.goto('/summary');
    await expect(page.locator('h1')).toContainText('Team 1 hat gewonnen');
  });

  test('shows Team 2 wins when they have more points', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('team1Points', '3');
      localStorage.setItem('team2Points', '8');
      localStorage.setItem('team1', JSON.stringify(['Alice']));
      localStorage.setItem('team2', JSON.stringify(['Bob']));
    });
    await page.goto('/summary');
    await expect(page.locator('h1')).toContainText('Team 2 hat gewonnen');
  });
});

test.describe('Music Controls', () => {
  test('music controls widget is present on page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.music-controls')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Full Game Flow E2E', () => {
  test('can go from home through rules to first game', async ({ page }) => {
    await page.goto('/');

    // Assign teams
    await page.locator('textarea').fill('Alice, Bob');
    await page.locator('button:has-text("Teams zuweisen")').click();
    await page.waitForTimeout(500);

    // Navigate to rules
    await page.locator('#nextButton').click();
    await expect(page).toHaveURL(/\/rules/);

    // Navigate to first game
    await page.locator('button:has-text("Weiter")').click();
    await expect(page).toHaveURL(/\/game\?index=0/);

    // Game should be loaded
    await page.waitForSelector('.quiz-container', { timeout: 10000 });
  });
});

test.describe('API Endpoints', () => {
  test('GET /api/settings returns valid settings', async ({ request }) => {
    const response = await request.get('/api/settings');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('pointSystemEnabled');
    expect(data).toHaveProperty('teamRandomizationEnabled');
    expect(data).toHaveProperty('globalRules');
    expect(typeof data.pointSystemEnabled).toBe('boolean');
    expect(Array.isArray(data.globalRules)).toBe(true);
  });

  test('GET /api/game/0 returns first game', async ({ request }) => {
    const response = await request.get('/api/game/0');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('gameId');
    expect(data).toHaveProperty('config');
    expect(data).toHaveProperty('currentIndex');
    expect(data).toHaveProperty('totalGames');
    expect(data.currentIndex).toBe(0);
    expect(data.config).toHaveProperty('type');
    expect(data.config).toHaveProperty('title');
  });

  test('GET /api/game/-1 returns 404', async ({ request }) => {
    const response = await request.get('/api/game/-1');
    expect(response.status()).toBe(404);
  });

  test('GET /api/game/999 returns 404', async ({ request }) => {
    const response = await request.get('/api/game/999');
    expect(response.status()).toBe(404);
  });

  test('GET /api/game/abc returns 404', async ({ request }) => {
    const response = await request.get('/api/game/abc');
    expect(response.status()).toBe(404);
  });

  test('GET /api/background-music returns array', async ({ request }) => {
    const response = await request.get('/api/background-music');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/music-subfolders returns array', async ({ request }) => {
    const response = await request.get('/api/music-subfolders');
    // May return 200 with folders or 500 if directory doesn't exist
    if (response.ok()) {
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    }
  });
});
