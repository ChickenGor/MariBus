const { test, expect } = require('@playwright/test');

test('production readiness reports all required services operational', async ({ request }) => {
  const response = await request.get('/api/readiness');
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.success).toBe(true);
  expect(payload.operational).toBe(true);
  expect(payload.ready).toBe(true);
  for (const service of Object.values(payload.services)) {
    if (service.required) expect(service.configured).toBe(true);
  }
});

test('home page renders core journey controls without application errors', async ({ page }) => {
  const applicationErrors = [];
  page.on('pageerror', error => applicationErrors.push(error.message));
  page.on('console', message => {
    const text = message.text();
    const isHeadlessMapFallback = text.startsWith(
      'Attempted to load a Vector Map, but failed. Falling back to Raster.'
    );
    if (message.type() === 'error' && !isHeadlessMapFallback) applicationErrors.push(text);
  });

  await page.goto('/');
  await expect(page).toHaveTitle(/MariBus Malaysia/);
  await expect(page.getByRole('textbox', { name: 'Destination' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Map view' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Active Service' })).toBeVisible();
  await expect.poll(() => applicationErrors, { timeout: 3_000 }).toEqual([]);
});

for (const pageCase of [
  { path: '/saved-routes', heading: 'Saved places and routes' },
  { path: '/notifications', heading: 'Notifications' },
  { path: '/feedback', heading: 'User feedback' },
  { path: '/sign-in', heading: 'Welcome aboard.' },
  { path: '/privacy-policy', heading: 'Privacy Policy' },
]) {
  test(`${pageCase.path} renders its primary content`, async ({ page }) => {
    const response = await page.goto(pageCase.path);
    expect(response?.ok()).toBeTruthy();
    await expect(page.getByRole('heading', { name: pageCase.heading, exact: true })).toBeVisible();
  });
}

test('mobile navigation and theme control remain accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const menuButton = page.getByRole('button', { name: 'Open menu' });
  await menuButton.click();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('complementary', { name: 'Main menu' })).toBeVisible();

  const darkMode = page.getByRole('button', { name: 'Dark mode' });
  await darkMode.click();
  await expect(page.getByRole('button', { name: 'Light mode' })).toHaveAttribute('aria-pressed', 'true');
});

test('reduced motion disables repeating loader animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('body').evaluate(body => {
    body.insertAdjacentHTML('beforeend', `
      <div id="wifi-loader" data-smoke-fixture>
        <svg><circle class="front"></circle></svg>
        <div class="text" data-text="Searching routes"></div>
      </div>
    `);
  });
  const loaderCircle = page.locator('#wifi-loader circle.front').first();
  const loaderTextOverlay = page.locator('#wifi-loader .text').first();
  await expect(loaderCircle).toHaveCSS('animation-name', 'none');
  await expect(loaderTextOverlay).toHaveAttribute('data-text', 'Searching routes');
});
