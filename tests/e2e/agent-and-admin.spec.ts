import { test, expect, type Page } from '@playwright/test';

/**
 * The staff side of the demo: an agent pays cash against a code, and an admin
 * sees the result. Also asserts the access boundaries — a customer must not be
 * able to reach either surface.
 */

const PASSWORD = process.env.DEMO_PASSWORD ?? 'DemoPass123!';

async function signIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/signin');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
}

/** Creates a funded transaction as a fresh customer and returns its pickup code. */
async function createFundedTransaction(page: Page): Promise<string> {
  const email = `e2e-agent-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
  const password = 'E2ETestPassword123!';

  await page.context().clearCookies();
  await page.goto('/signup');
  await page.getByLabel(/first name/i).fill('Cash');
  await page.getByLabel(/last name/i).fill('Collector');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
  await page.getByLabel(/confirm password/i).fill(password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /create your account/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });

  await page.goto('/new');
  await page.getByLabel(/amount you want to receive/i).fill('5000');
  await expect(page.getByText(/you will receive exactly/i)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /^continue$/i }).click();

  // The agent account is assigned to Punta Cana — Plaza Turística, so route the
  // transaction there.
  await page.getByText(/Punta Cana — Plaza Turística/i).click();
  await page.getByRole('button', { name: /^continue$/i }).click();
  await page.getByRole('button', { name: /confirm & pay/i }).click();

  await expect(page.getByText('PICKUP CODE')).toBeVisible({ timeout: 30_000 });
  const code = await page.locator('.pickup-code').first().textContent();
  if (!code) throw new Error('No pickup code was issued');
  return code.trim();
}

test.describe('access boundaries', () => {
  test('test_a_customer_cannot_reach_the_agent_portal', async ({ page }) => {
    await signIn(page, 'customer@example.com');
    await page.waitForURL('**/dashboard', { timeout: 20_000 });

    await page.goto('/agent');
    // Redirected away: the layout refuses without `pickup.verify`.
    await expect(page).not.toHaveURL(/\/agent$/);
  });

  test('test_a_customer_cannot_reach_the_admin_console', async ({ page }) => {
    await signIn(page, 'customer@example.com');
    await page.waitForURL('**/dashboard', { timeout: 20_000 });

    await page.goto('/admin');
    await expect(page).not.toHaveURL(/\/admin$/);
  });

  test('test_a_customer_is_refused_by_the_admin_api_not_just_the_ui', async ({ page }) => {
    await signIn(page, 'customer@example.com');
    await page.waitForURL('**/dashboard', { timeout: 20_000 });

    const response = await page.request.get('/api/admin/metrics');
    expect(response.status()).toBe(403);
  });

  test('test_a_customer_is_refused_by_the_payout_api', async ({ page }) => {
    await signIn(page, 'customer@example.com');
    await page.waitForURL('**/dashboard', { timeout: 20_000 });

    const response = await page.request.post('/api/pickup/verify', {
      data: { code: 'DR-1111-2222', locationId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(response.status()).toBe(403);
  });
});

test.describe('payout window', () => {
  test('test_an_agent_verifies_a_code_and_disburses_cash', async ({ page }) => {
    const code = await createFundedTransaction(page);

    await signIn(page, 'agent@example.com');
    await page.waitForURL('**/agent', { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /payout verification portal/i })).toBeVisible();

    await page.getByLabel(/pickup code/i).fill(code);
    await page.getByRole('button', { name: /verify code/i }).click();

    await expect(page.getByText(/transaction verified/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/amount to pay/i)).toBeVisible();
    // The figure also appears in the agent's recent-events list, so scope to the
    // headline amount rather than matching every occurrence.
    await expect(page.locator('.amount-hero')).toHaveText(/RD\$5,000\.00/);

    // The agent must not see customer identity details.
    await expect(page.getByText(/@example\.test/)).toHaveCount(0);

    await page.getByLabel(/last 4 of document number/i).fill('4567');
    await page.getByRole('checkbox').check();

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: /approve pickup/i }).click();

    await expect(page.getByText(/pickup completed/i)).toBeVisible({ timeout: 20_000 });
  });

  test('test_an_invalid_code_is_rejected', async ({ page }) => {
    await signIn(page, 'agent@example.com');
    await page.waitForURL('**/agent', { timeout: 20_000 });

    await page.getByLabel(/pickup code/i).fill('DR-0000-0000');
    await page.getByRole('button', { name: /verify code/i }).click();

    await expect(page.getByText(/that code is not valid/i)).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('admin console', () => {
  test('test_shows_metrics_and_confirms_the_ledger_balances', async ({ page }) => {
    await signIn(page, 'admin@example.com');
    await page.waitForURL('**/admin', { timeout: 20_000 });

    await expect(page.getByRole('heading', { name: /overview/i })).toBeVisible();
    await expect(page.getByText(/total transactions/i)).toBeVisible();

    // The ledger invariant is surfaced at the top of the dashboard.
    await expect(page.getByText(/^balanced$/i)).toBeVisible();
  });

  test('test_searches_transactions', async ({ page }) => {
    await signIn(page, 'admin@example.com');
    await page.waitForURL('**/admin', { timeout: 20_000 });

    await page.goto('/admin/transactions');
    await expect(page.getByRole('heading', { name: /transactions/i })).toBeVisible();
    await page.getByPlaceholder(/transaction id, reference/i).fill('LRM');
    await page.getByRole('button', { name: /search/i }).click();
    await expect(page).toHaveURL(/q=LRM/);
  });

  test('test_shows_the_double_entry_ledger', async ({ page }) => {
    await signIn(page, 'admin@example.com');
    await page.waitForURL('**/admin', { timeout: 20_000 });

    await page.goto('/admin/ledger');
    await expect(page.getByRole('heading', { name: /ledger/i }).first()).toBeVisible();
    await expect(page.getByText(/customer funds in suspense/i)).toBeVisible();
  });

  test('test_shows_the_append_only_audit_log', async ({ page }) => {
    await signIn(page, 'admin@example.com');
    await page.waitForURL('**/admin', { timeout: 20_000 });

    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: /audit log/i }).first()).toBeVisible();
    await expect(page.getByText(/secrets are redacted before write/i)).toBeVisible();
  });
});
