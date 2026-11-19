import { expect, test } from '@playwright/test';

// Start a game, build something, turn the view, open the menu: no errors along the way.
test('the game starts, builds and runs without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await page.getByRole('button', { name: 'Break ground' }).click();
  await expect(page.locator('#topbar')).toContainText('$9.00M');
  await expect(page.locator('#coach')).toBeVisible(); // the tutorial greets a new player

  // build a runway with the mouse
  await page.locator('[data-build="runway"]').click();
  // the middle of the map area between the palette and the side panel
  const palette = (await page.locator('#palette').boundingBox())!;
  const panel = (await page.locator('#panel').boundingBox())!;
  const x = (palette.x + palette.width + panel.x) / 2, y = panel.y + panel.height * 0.45;
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await expect(page.locator('#topbar')).not.toContainText('$9.00M'); // money was spent

  // turn the view, run the clock, open and close the menu
  await page.locator('#topbar [data-act="menu"]').click();
  await expect(page.locator('.modal.menu')).toBeVisible();
  await page.keyboard.press('Escape'); // Esc closes the menu again
  await expect(page.locator('.modal.menu')).toHaveCount(0);
  await page.keyboard.press('e');
  await page.keyboard.press('4');
  await page.waitForTimeout(3000);

  // every panel renders
  for (const tab of ['Airlines', 'Flights', 'Ops', 'Money', 'Airport']) await page.locator('#tabs button', { hasText: tab }).click();
  expect(errors).toEqual([]);
});

test('a scenario starts with a working airport', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('input[name="ng-scenario"][value="regional"]').check({ force: true });
  await page.getByRole('button', { name: 'Break ground' }).click();
  await expect(page.locator('.goal')).toContainText('20,000');
  await page.keyboard.press('4');
  await page.waitForTimeout(4000);
  await expect(page.locator('#topbar')).not.toContainText('Day 1 06:00');
  expect(errors).toEqual([]);
});
