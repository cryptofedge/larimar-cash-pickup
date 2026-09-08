import { test, expect, type Page } from '@playwright/test';

/**
 * The journey the product exists for: a traveler arrives, sees a price, pays,
 * and gets a pickup code.
 *
 * Each test registers its own account. The demo customer has finite daily and
 * velocity limits, and sharing it across runs would produce failures that look
 * like bugs but are the risk engine working.
 */

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

const PASSWORD = 'E2ETestPassword123!';

async function register(page: Page, email: string): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel(/first name/i).fill('Test');
  await page.getByLabel(/last name/i).fill('Traveler');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password$/i).fill(PASSWORD);
  await page.getByLabel(/confirm password/i).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /create your account/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
}

test.describe('public site', () => {
  test('test_landing_page_states_the_core_promise_and_the_demo_disclaimer', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: /get dominican pesos without using your card/i }),
    ).toBeVisible();

    await expect(page.getByRole('link', { name: /get dominican pesos/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /how it works/i }).first()).toBeVisible();

    // The demo banner must be present on every page and must not be dismissible.
    await expect(page.getByText(/demonstration environment/i).first()).toBeVisible();
    await expect(page.getByText(/no real money moves/i).first()).toBeVisible();
  });

  test('test_the_calculator_prices_a_request_server_side_and_itemises_every_fee', async ({ page }) => {
    await page.goto('/');

    const amountField = page.getByLabel(/amount you want to receive/i);
    await amountField.fill('20000');

    // Wait for the debounced server round-trip.
    await expect(page.getByText(/you will receive exactly/i)).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText(/RD\$20,000\.00/).first()).toBeVisible();
    await expect(page.getByText(/platform fee/i).first()).toBeVisible();
    await expect(page.getByText(/payment processing fee/i).first()).toBeVisible();
    // The spread is disclosed as its own line, not buried in the rate.
    await expect(page.getByText(/exchange rate margin/i).first()).toBeVisible();
    await expect(page.getByText(/demonstration rate/i).first()).toBeVisible();
  });

  test('test_locations_are_all_marked_as_demo_never_as_real_partners', async ({ page }) => {
    await page.goto('/locations');
    await expect(page.getByRole('heading', { name: /pickup locations/i })).toBeVisible();

    const banners = page.getByText(/DEMO LOCATION — NOT A REAL PARTNER/i);
    expect(await banners.count()).toBeGreaterThan(0);
  });

  test('test_the_trust_page_refuses_to_claim_authorisation', async ({ page }) => {
    await page.goto('/trust');
    await expect(page.getByText(/what we do not claim/i)).toBeVisible();
    await expect(
      page.getByText(/we do not claim to be authorized, licensed, or supervised/i),
    ).toBeVisible();
  });

  test('test_switches_to_spanish_and_back', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('combobox').first().selectOption('es');

    await expect(
      page.getByRole('heading', { name: /obtén pesos dominicanos sin usar tu tarjeta/i }),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole('combobox').first().selectOption('en');
    await expect(
      page.getByRole('heading', { name: /get dominican pesos without using your card/i }),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('account and transaction', () => {
  test('test_registers_requests_pesos_verifies_identity_pays_and_receives_a_code', async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);

    await expect(page.getByRole('heading', { name: /hello, test/i })).toBeVisible();

    // --- Amount ---------------------------------------------------------
    await page.goto('/new');
    await page.getByLabel(/amount you want to receive/i).fill('20000');
    await expect(page.getByText(/you will receive exactly/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^continue$/i }).click();

    // --- Location -------------------------------------------------------
    await expect(page.getByText(/choose a pickup location/i)).toBeVisible();
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: /^continue$/i }).click();

    // --- Review ---------------------------------------------------------
    await expect(page.getByText(/demonstration payment/i)).toBeVisible();
    await expect(page.getByText(/RD\$20,000\.00/).first()).toBeVisible();
    await page.getByRole('button', { name: /confirm & pay/i }).click();

    // RD$20,000 is above the KYC threshold, so the server routes to
    // verification. The client cannot skip this.
    await page.waitForURL('**/verify-identity**', { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /verify your identity/i })).toBeVisible();

    await page.getByLabel(/date of birth/i).fill('1985-04-12');
    await page.getByLabel(/document number/i).fill('X1234567');
    await page.getByLabel(/issuing country/i).fill('US');
    await page.getByLabel(/country of residence/i).fill('US');
    await page.getByRole('button', { name: /submit for verification/i }).click();

    // Verification approved -> back to the transaction, now payable.
    await page.waitForURL('**/transactions/**', { timeout: 30_000 });
    await expect(page.getByText(/awaiting payment/i).first()).toBeVisible();
  });

  test('test_a_declined_card_fails_cleanly_and_issues_no_pickup_code', async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);

    await page.goto('/new');
    // Below the KYC threshold so the flow reaches payment directly.
    await page.getByLabel(/amount you want to receive/i).fill('5000');
    await expect(page.getByText(/you will receive exactly/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^continue$/i }).click();

    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: /^continue$/i }).click();

    // Select by value rather than label so the test is independent of locale.
    await page.getByRole('combobox').last().selectOption('tok_demo_decline_insufficient_funds');
    await page.getByRole('button', { name: /confirm & pay/i }).click();

    // Scope to the alert: the scenario <option> label also contains this text.
    await expect(page.getByRole('alert').filter({ hasText: /insufficient funds/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('PICKUP CODE')).toHaveCount(0);
    await expect(page.locator('.pickup-code')).toHaveCount(0);
  });

  test('test_completes_a_small_transaction_and_shows_the_pickup_code_exactly_once', async ({ page }) => {
    const email = uniqueEmail();
    await register(page, email);

    await page.goto('/new');
    await page.getByLabel(/amount you want to receive/i).fill('5000');
    await expect(page.getByText(/you will receive exactly/i)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^continue$/i }).click();

    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: /^continue$/i }).click();
    await page.getByRole('button', { name: /confirm & pay/i }).click();

    await expect(page.getByText('PICKUP CODE')).toBeVisible({ timeout: 30_000 });

    const code = await page.locator('.pickup-code').first().textContent();
    expect(code?.trim()).toMatch(/^DR-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    await expect(page.getByText(/treat this code like cash/i)).toBeVisible();

    // Navigating away and back must NOT show the code again — it is not stored
    // in a recoverable form.
    await page.getByRole('link', { name: /view details/i }).click();
    await page.waitForURL('**/transactions/**');
    await expect(page.getByText(/ready for pickup/i).first()).toBeVisible();
    await expect(page.locator('.pickup-code')).toHaveCount(0);
  });

  test('test_requires_authentication_for_the_dashboard', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/dashboard');
    await page.waitForURL('**/signin**', { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });
});
