import { test, expect } from '@playwright/test';

/**
 * PWA installability, and the cache-hygiene property the service worker exists
 * to uphold.
 *
 * The second group matters more than the first. Standard PWA advice is to cache
 * API responses for offline speed; here that would put transaction data — and in
 * one case a live pickup code — into durable client-side storage readable by any
 * later script on this origin. These tests assert that never happens.
 */

test.describe('installability', () => {
  test('test_pwa_serves_a_valid_web_app_manifest', async ({ page, request }) => {
    // Arrange / Act
    await page.goto('/');
    const response = await request.get('/manifest.webmanifest');
    const manifest = (await response.json()) as {
      name: string;
      start_url: string;
      scope: string;
      display: string;
      theme_color: string;
      background_color: string;
      icons: { sizes: string; purpose?: string; type: string }[];
    };

    // Assert — the criteria Chrome checks before offering installation.
    expect(response.status()).toBe(200);
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#0A1F33');
    expect(manifest.background_color).toBe('#0A1F33');

    // A 192px and a 512px PNG are the minimum for installability.
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.every((icon) => icon.type === 'image/png')).toBe(true);

    // Maskable icons keep the mark inside Android's crop safe zone.
    expect(manifest.icons.filter((icon) => icon.purpose === 'maskable').length).toBeGreaterThan(0);
  });

  test('test_pwa_links_the_manifest_and_platform_icons_from_the_document', async ({ page }) => {
    // Arrange / Act
    await page.goto('/');

    // Assert
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
  });

  test('test_pwa_serves_every_declared_icon_as_a_real_png', async ({ request }) => {
    // Arrange
    const manifest = (await (await request.get('/manifest.webmanifest')).json()) as {
      icons: { src: string }[];
    };

    // Act / Assert
    for (const icon of manifest.icons) {
      const response = await request.get(icon.src);
      expect(response.status(), `${icon.src} should be served`).toBe(200);
      expect(response.headers()['content-type']).toContain('image/png');

      // Verify the PNG signature rather than trusting the content type header.
      const body = await response.body();
      expect(body.subarray(1, 4).toString('ascii')).toBe('PNG');
    }
  });

  test('test_pwa_serves_an_offline_fallback_page', async ({ request }) => {
    // Arrange / Act
    const response = await request.get('/offline.html');
    const html = await response.text();

    // Assert — and it still states what this is, because an installed app has no
    // browser chrome to signal it.
    expect(response.status()).toBe(200);
    expect(html).toMatch(/offline/i);
    expect(html).toMatch(/Demonstration environment/i);
  });

  test('test_pwa_serves_the_service_worker_without_a_blocking_csp', async ({ request }) => {
    // Arrange / Act
    const response = await request.get('/sw.js');

    // Assert — the CSP on a worker script's own response governs the worker's
    // execution context. A nonce-based policy here blocks it outright, and the
    // browser reports only "an unknown error occurred when fetching the script".
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('javascript');
    expect(response.headers()['content-security-policy']).toBeUndefined();
  });

  test('test_pwa_asset_links_are_absent_until_android_is_configured', async ({ request }) => {
    // Arrange / Act
    const response = await request.get('/.well-known/assetlinks.json');

    // Assert — a placeholder would be served in production and fail TWA
    // verification while looking configured. 404 is the honest unconfigured state.
    expect([200, 404]).toContain(response.status());
    if (response.status() === 200) {
      const links = (await response.json()) as { target: { package_name: string } }[];
      expect(links[0]?.target.package_name).toBeTruthy();
    }
  });
});

test.describe('service worker cache hygiene', () => {
  test('test_service_worker_caches_only_static_assets_and_never_api_responses', async ({
    page,
    context,
  }) => {
    // Arrange — register and let the worker activate.
    await page.goto('/');
    await page.waitForFunction(
      () => navigator.serviceWorker.getRegistration('/').then((r) => Boolean(r?.active)),
      undefined,
      { timeout: 20_000 },
    );

    // Act — exercise the public API so any over-eager caching would show up.
    await page.evaluate(async () => {
      await fetch('/api/exchange-rates?base=USD&country=DO');
      await fetch('/api/pickup/locations?countryCode=DO&limit=5');
    });
    await page.goto('/locations');
    await page.goto('/fees');
    await page.waitForTimeout(1500);

    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls: string[] = [];
      for (const name of names) {
        const requests = await (await caches.open(name)).keys();
        urls.push(...requests.map((request) => new URL(request.url).pathname));
      }
      return urls;
    });

    // Assert — nothing under /api/, ever.
    expect(cached.filter((url) => url.startsWith('/api/'))).toEqual([]);

    // And no HTML document: a cached dashboard on a shared device is a leak.
    expect(cached.filter((url) => url.endsWith('.html') && url !== '/offline.html')).toEqual([]);
    for (const page of ['/', '/locations', '/fees', '/dashboard']) {
      expect(cached).not.toContain(page);
    }

    // What it does cache is the offline shell and immutable build output only.
    expect(cached).toContain('/offline.html');
    expect(
      cached.every(
        (url) =>
          url === '/offline.html' ||
          url.startsWith('/icons/') ||
          url.startsWith('/_next/static/') ||
          url === '/manifest.webmanifest',
      ),
      `unexpected cache entries: ${cached.join(', ')}`,
    ).toBe(true);

    await context.close();
  });

  test('test_service_worker_never_caches_an_authenticated_page_or_a_pickup_code', async ({
    page,
    context,
  }) => {
    // Arrange — a real account, taken through to an issued pickup code.
    const email = `pwa-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
    const password = 'E2ETestPassword123!';

    await page.goto('/signup');
    await page.getByLabel(/first name/i).fill('Cache');
    await page.getByLabel(/last name/i).fill('Check');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByLabel(/confirm password/i).fill(password);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /create your account/i }).click();
    await page.waitForURL('**/dashboard', { timeout: 20_000 });

    await page.waitForFunction(
      () => navigator.serviceWorker.getRegistration('/').then((r) => Boolean(r?.active)),
      undefined,
      { timeout: 20_000 },
    );

    await page.goto('/new');
    await page.getByLabel(/amount you want to receive/i).fill('5000');
    await expect(page.getByText(/you will receive exactly/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^continue$/i }).click();
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: /^continue$/i }).click();
    await page.getByRole('button', { name: /confirm & pay/i }).click();

    await expect(page.getByText('PICKUP CODE')).toBeVisible({ timeout: 30_000 });
    const code = (await page.locator('.pickup-code').first().textContent())?.trim() ?? '';
    expect(code).toMatch(/^DR-/);

    await page.waitForTimeout(1500);

    // Act — read back everything the worker has stored.
    const cachedBodies = await page.evaluate(async () => {
      const names = await caches.keys();
      const bodies: string[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const response = await cache.match(request);
          if (response) bodies.push(await response.text());
        }
      }
      return bodies;
    });

    // Assert — the live pickup code must appear nowhere in durable storage.
    const haystack = cachedBodies.join('\n');
    expect(haystack).not.toContain(code);
    expect(haystack).not.toContain(email);
    expect(haystack).not.toMatch(/DR-[0-9A-Z]{4}-[0-9A-Z]{4}/);

    await context.close();
  });
});
