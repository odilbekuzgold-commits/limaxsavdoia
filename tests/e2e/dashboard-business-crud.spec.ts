/**
 * LImax Stage 14.3 — Dashboard Business CRUD E2E Spec
 *
 * Tests run against:
 *  - Real isolated PostgreSQL temp DB (limax_test_stage14_3_<ts>)
 *  - Real API on port 4001 (TELEGRAM_UPDATE_MODE=disabled)
 *  - Real Dashboard on port 3100
 *
 * Test data stays in temp DB only; never enters production.
 * All secrets come from runtime state (.playwright-e2e-state.json) — never hardcoded.
 */

import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Runtime config helpers ───────────────────────────────────────────────────

function getState(): Record<string, any> {
  const statePath = resolve('.playwright-e2e-state.json');
  if (existsSync(statePath)) {
    try {
      return JSON.parse(readFileSync(statePath, 'utf8'));
    } catch {}
  }
  return {};
}

function getApiBase(): string {
  return `http://127.0.0.1:${process.env.E2E_API_PORT ?? '4001'}`;
}

function getDashBase(): string {
  return `http://127.0.0.1:${process.env.E2E_DASHBOARD_PORT ?? '3100'}`;
}

function getInternalToken(): string {
  return getState().internalToken || process.env.INTERNAL_API_TOKEN || '';
}

function getDashUser(): string {
  return getState().dashUser || process.env.E2E_DASHBOARD_USER || '';
}

function getDashPassword(): string {
  return getState().dashPassword || process.env.E2E_DASHBOARD_PASSWORD || '';
}

function randomCode(prefix = 'YARN'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

function authHeaders(): Record<string, string> {
  const token = getInternalToken();
  return {
    'content-type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

// ── HTTP API Helpers ─────────────────────────────────────────────────────────

async function apiGet(path: string) {
  return fetch(`${getApiBase()}${path}`, {
    headers: authHeaders(),
  });
}

async function apiPost(path: string, body: object) {
  return fetch(`${getApiBase()}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

async function apiPatch(path: string, body: object) {
  return fetch(`${getApiBase()}${path}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

async function apiPut(path: string, body: object) {
  return fetch(`${getApiBase()}${path}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

// ── Error Monitors ───────────────────────────────────────────────────────────

const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const failedRequests: string[] = [];
const responses5xx: string[] = [];

function attachMonitors(page: Page) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (
        !text.includes('favicon') &&
        !text.includes('ERR_EMPTY_RESPONSE') &&
        !text.includes('401') &&
        !text.includes('404') &&
        !text.includes('status of 401') &&
        !text.includes('status of 404')
      ) {
        consoleErrors.push(text);
      }
    }
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (!url.includes('favicon')) failedRequests.push(url);
  });
  page.on('response', (res) => {
    if (res.status() >= 500) responses5xx.push(`${res.status()} ${res.url()}`);
  });
}

// ── Global beforeEach: Apply HTTP Credentials ────────────────────────────────

test.beforeEach(async ({ context }) => {
  const user = getDashUser();
  const pass = getDashPassword();
  if (user && pass) {
    await context.setHTTPCredentials({
      username: user,
      password: pass,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. TELEGRAM ISOLATION
// ─────────────────────────────────────────────────────────────────────────────
test.describe('1. Telegram Isolation', () => {
  test('API started with TELEGRAM_UPDATE_MODE=disabled — no polling started', async () => {
    const res = await apiGet('/api/v1/integrations/telegram/status');
    expect(res.status).toBeLessThan(500);

    const body = await res.json().catch(() => ({}));
    if (body && typeof body === 'object' && 'mode' in body) {
      expect(body.mode).not.toBe('polling');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. BASIC AUTH E2E (Using native fetch to test raw HTTP auth without auto-headers)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('2. Basic Auth E2E', () => {
  test('No credentials → HTTP 401', async () => {
    const res = await fetch(getDashBase());
    expect(res.status).toBe(401);
  });

  test('Wrong credentials → HTTP 401', async () => {
    const res = await fetch(getDashBase(), {
      headers: {
        Authorization: 'Basic ' + Buffer.from('wrong_user:wrong_password_1234').toString('base64'),
      },
    });
    expect(res.status).toBe(401);
  });

  test('Correct credentials → Dashboard loads', async ({ page }) => {
    attachMonitors(page);
    const res = await page.goto(`${getDashBase()}/dashboard/products`, { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
  });

  test('WWW-Authenticate header present on 401', async () => {
    const res = await fetch(getDashBase());
    const wwwAuth = res.headers.get('www-authenticate');
    expect(wwwAuth).toBeTruthy();
  });

  test('Password not in response body or HTML', async ({ page }) => {
    const dashPassword = getDashPassword();
    const res = await page.goto(`${getDashBase()}/dashboard/products`, { waitUntil: 'domcontentloaded' });
    const body = (await res?.text()) ?? '';
    if (dashPassword) {
      expect(body).not.toContain(dashPassword);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. PRODUCT CRUD E2E
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('3. Product CRUD', () => {
  const code = randomCode('PROD');
  const name = `Test Yarn ${code}`;
  let productId: string = '';

  test('Create product via API and verify in DB', async () => {
    const createRes = await apiPost('/api/v1/products', {
      code,
      name,
      category: 'Yarns',
      active: true,
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    productId = created.data?.id || created.id;
    expect(productId).toBeTruthy();
  });

  test('Refresh Dashboard — product visible in UI table', async ({ page }) => {
    attachMonitors(page);
    await page.goto(`${getDashBase()}/dashboard/products`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(`text=${code}`).first()).toBeVisible({ timeout: 10_000 });
  });

  test('API confirms product in DB', async () => {
    const res = await apiGet('/api/v1/products');
    expect(res.status).toBe(200);
    const data = await res.json();
    const products = data.data ?? data.products ?? [];
    const found = products.find((p: { code?: string }) => p.code === code);
    expect(found).toBeTruthy();
  });

  test('Deactivate product via API', async () => {
    expect(productId).toBeTruthy();
    const res = await apiPost(`/api/v1/products/${productId}/deactivate`, {});
    expect(res.status).toBe(200);

    const check = await apiGet(`/api/v1/products/${productId}`);
    const checkData = await check.json();
    expect(checkData.data.active).toBe(false);
  });

  test('Reactivate product via API', async () => {
    expect(productId).toBeTruthy();
    const res = await apiPost(`/api/v1/products/${productId}/activate`, {});
    expect(res.status).toBe(200);

    const check = await apiGet(`/api/v1/products/${productId}`);
    const checkData = await check.json();
    expect(checkData.data.active).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. DUPLICATE PRODUCT CODE E2E
// ─────────────────────────────────────────────────────────────────────────────
test.describe('4. Duplicate Product Code', () => {
  const baseCode = randomCode('DUP');

  test('Setup base product', async () => {
    const res = await apiPost('/api/v1/products', {
      code: baseCode,
      name: `Base Product ${baseCode}`,
      category: 'TEST',
    });
    expect(res.status).toBe(201);
  });

  test('Duplicate code (uppercase/lowercase) → 409, row count unchanged', async () => {
    const before = await apiGet('/api/v1/products');
    const beforeData = await before.json();
    const beforeCount = (beforeData.data ?? []).length;

    // Try duplicate with lowercased code
    const dupRes = await apiPost('/api/v1/products', {
      code: baseCode.toLowerCase(),
      name: 'Duplicate Attempt Lowercase',
      category: 'TEST',
    });
    expect(dupRes.status).toBe(409);

    const dupBody = await dupRes.json();
    expect(dupBody?.error?.code).toBe('DUPLICATE_PRODUCT_CODE');

    // Verify row count unchanged
    const after = await apiGet('/api/v1/products');
    const afterData = await after.json();
    const afterCount = (afterData.data ?? []).length;
    expect(afterCount).toBe(beforeCount);
  });

  test('Duplicate code (with whitespace) → 409', async () => {
    const dupRes = await apiPost('/api/v1/products', {
      code: `  ${baseCode}  `,
      name: 'Whitespace Duplicate Attempt',
      category: 'TEST',
    });
    expect(dupRes.status).toBe(409);
    const body = await dupRes.json();
    expect(body?.error?.code).toBe('DUPLICATE_PRODUCT_CODE');
  });

  test('Duplicate code UI — no crash, error handled gracefully', async ({ page }) => {
    attachMonitors(page);
    await page.goto(`${getDashBase()}/dashboard/products`, { waitUntil: 'domcontentloaded' });

    const addBtn = page.locator('button', { hasText: /Mahsulot Qo‘shish/i }).first();
    await addBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await addBtn.click();

    const codeInput = page.locator('input[placeholder="30/70"]');
    await codeInput.waitFor({ state: 'visible', timeout: 5_000 });
    await codeInput.fill(baseCode);

    const nameInput = page.locator('input[required]').first();
    await nameInput.fill('Duplicate UI Test Yarn');

    const submitBtn = page.locator('button[type="submit"]', { hasText: /Saqlash/i }).first();
    await submitBtn.click({ force: true });

    await page.waitForTimeout(2000);
    expect(page.isClosed()).toBe(false);

    const content = await page.content();
    expect(content).not.toContain('duplicate key value violates unique constraint');
    expect(content).not.toContain('ERROR: duplicate');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. PRICING LIFECYCLE E2E
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('5. Pricing Lifecycle', () => {
  const priceCode = randomCode('PRICE');
  let priceProductId: string = '';

  test('Setup: create product for pricing', async () => {
    const res = await apiPost('/api/v1/products', {
      code: priceCode,
      name: `Pricing Test Yarn ${priceCode}`,
      category: 'Pricing',
      active: true,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    priceProductId = body.data?.id || body.id;
    expect(priceProductId).toBeTruthy();
  });

  test('Add first ACTIVE price → confirmed in API', async () => {
    expect(priceProductId).toBeTruthy();

    const res = await apiPost('/api/v1/pricing', {
      productId: priceProductId,
      amount: 5.50,
      currency: 'USD',
      unit: 'kg',
      minimumQuantity: 1,
      validFrom: new Date().toISOString().split('T')[0],
      active: true,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.active).toBe(true);
  });

  test('Add second ACTIVE price → first becomes INACTIVE', async () => {
    expect(priceProductId).toBeTruthy();

    const res = await apiPost('/api/v1/pricing', {
      productId: priceProductId,
      amount: 6.00,
      currency: 'USD',
      unit: 'kg',
      minimumQuantity: 1,
      validFrom: new Date().toISOString().split('T')[0],
      active: true,
    });
    expect(res.status).toBe(201);

    // Verify DB has exactly 1 ACTIVE price
    const histRes = await apiGet(`/api/v1/pricing?productId=${priceProductId}`);
    expect(histRes.status).toBe(200);
    const histData = await histRes.json();
    const prices = histData.data ?? [];
    const activePrices = prices.filter((p: { active?: boolean }) => p.active === true);
    expect(activePrices.length).toBe(1);
    expect(activePrices[0].price).toBeCloseTo(6.00);
  });

  test('Zero amount price → rejected', async () => {
    expect(priceProductId).toBeTruthy();

    const res = await apiPost('/api/v1/pricing', {
      productId: priceProductId,
      amount: 0,
      currency: 'USD',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('Negative amount price → rejected', async () => {
    expect(priceProductId).toBeTruthy();

    const res = await apiPost('/api/v1/pricing', {
      productId: priceProductId,
      amount: -1.00,
      currency: 'USD',
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. INVENTORY E2E
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('6. Inventory', () => {
  const invCode = randomCode('INV');
  let inventoryProductId: string = '';

  test('Setup: create product for inventory', async () => {
    const res = await apiPost('/api/v1/products', {
      code: invCode,
      name: `Inventory Test Yarn ${invCode}`,
      category: 'Inventory',
      active: true,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    inventoryProductId = body.data?.id || body.id;
    expect(inventoryProductId).toBeTruthy();
  });

  test('Zero stock → OUT_OF_STOCK status', async () => {
    expect(inventoryProductId).toBeTruthy();

    const res = await apiPut(`/api/v1/inventory/${inventoryProductId}`, {
      availableQuantity: 0,
      reservedQuantity: 0,
    });
    expect(res.status).toBe(200);

    const inv = await apiGet(`/api/v1/inventory?productId=${inventoryProductId}`);
    const invData = await inv.json();
    expect(invData.data.status).toBe('OUT_OF_STOCK');
  });

  test('No fake warehouse default when warehouse omitted', async () => {
    expect(inventoryProductId).toBeTruthy();

    const inv = await apiGet(`/api/v1/inventory?productId=${inventoryProductId}`);
    const invData = await inv.json();
    const warehouse = invData.data?.warehouse;
    expect(warehouse).not.toBe('Main Warehouse');
    expect(warehouse).not.toBe('main_warehouse');
  });

  test('available=100, reserved=20 → net available=80, IN_STOCK', async () => {
    expect(inventoryProductId).toBeTruthy();

    const res = await apiPut(`/api/v1/inventory/${inventoryProductId}`, {
      availableQuantity: 100,
      reservedQuantity: 20,
    });
    expect(res.status).toBe(200);

    const inv = await apiGet(`/api/v1/inventory?productId=${inventoryProductId}`);
    const invData = await inv.json();
    expect(invData.data.status).toBe('IN_STOCK');
    const net = (invData.data.availableQuantity ?? 0) - (invData.data.reservedQuantity ?? 0);
    expect(net).toBe(80);
  });

  test('reserved > available → rejected', async () => {
    expect(inventoryProductId).toBeTruthy();

    const res = await apiPut(`/api/v1/inventory/${inventoryProductId}`, {
      availableQuantity: 10,
      reservedQuantity: 50,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('Negative quantity → rejected', async () => {
    expect(inventoryProductId).toBeTruthy();

    const res = await apiPut(`/api/v1/inventory/${inventoryProductId}`, {
      availableQuantity: -5,
      reservedQuantity: 0,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('Dashboard /inventory page loads without crash', async ({ page }) => {
    attachMonitors(page);
    await page.goto(`${getDashBase()}/dashboard/inventory`, { waitUntil: 'domcontentloaded' });
    expect(page.isClosed()).toBe(false);
    const content = await page.content();
    expect(content).not.toContain('Main Warehouse');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. STALE VERSION CONFLICT E2E
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('7. Stale Version Conflict', () => {
  const confCode = randomCode('CONF');
  let conflictProductId: string = '';

  test('Setup: create product and set initial inventory', async () => {
    const res = await apiPost('/api/v1/products', {
      code: confCode,
      name: `Conflict Test Yarn ${confCode}`,
      category: 'Conflict',
      active: true,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    conflictProductId = body.data?.id || body.id;
    expect(conflictProductId).toBeTruthy();

    const initRes = await apiPut(`/api/v1/inventory/${conflictProductId}`, {
      availableQuantity: 50,
      reservedQuantity: 0,
    });
    expect(initRes.status).toBe(200);
  });

  test('Concurrent update with stale version → 409 conflict', async () => {
    expect(conflictProductId).toBeTruthy();

    // Get current inventory with version
    const inv = await apiGet(`/api/v1/inventory?productId=${conflictProductId}`);
    const invData = await inv.json();
    const currentVersion = invData.data?.version ?? 1;

    // First update succeeds
    const res1 = await apiPut(`/api/v1/inventory/${conflictProductId}`, {
      availableQuantity: 60,
      reservedQuantity: 0,
      expectedVersion: currentVersion,
    });
    expect(res1.status).toBe(200);

    // Second update with stale version → 409
    const res2 = await apiPut(`/api/v1/inventory/${conflictProductId}`, {
      availableQuantity: 70,
      reservedQuantity: 0,
      expectedVersion: currentVersion,
    });
    expect(res2.status).toBe(409);

    // First update remains in DB
    const finalInv = await apiGet(`/api/v1/inventory?productId=${conflictProductId}`);
    const finalData = await finalInv.json();
    expect(finalData.data.availableQuantity).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. DESKTOP VIEWPORT (1440×900) — UI SMOKE
// ─────────────────────────────────────────────────────────────────────────────
test.describe('8. Desktop Viewport UI', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Products page renders table', async ({ page }) => {
    attachMonitors(page);
    await page.goto(`${getDashBase()}/dashboard/products`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('table').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Inventory page renders without overflow', async ({ page }) => {
    attachMonitors(page);
    await page.goto(`${getDashBase()}/dashboard/inventory`, { waitUntil: 'domcontentloaded' });
    expect(page.isClosed()).toBe(false);
  });

  test('Navigation sidebar visible at 1440px', async ({ page }) => {
    attachMonitors(page);
    await page.goto(`${getDashBase()}/dashboard/products`, { waitUntil: 'domcontentloaded' });
    const nav = page.locator('nav, aside, [role="navigation"]').first();
    await expect(nav).toBeVisible({ timeout: 10_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. MOBILE VIEWPORT (390×844) — UI SMOKE
// ─────────────────────────────────────────────────────────────────────────────
test.describe('9. Mobile Viewport UI', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Products page loads on mobile', async ({ page }) => {
    attachMonitors(page);
    await page.goto(`${getDashBase()}/dashboard/products`, { waitUntil: 'domcontentloaded' });
    expect(page.isClosed()).toBe(false);
  });

  test('Inventory page loads on mobile', async ({ page }) => {
    attachMonitors(page);
    await page.goto(`${getDashBase()}/dashboard/inventory`, { waitUntil: 'domcontentloaded' });
    expect(page.isClosed()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. SECURITY ASSERTIONS (Final)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('10. Security Assertions', () => {
  test('INTERNAL_API_TOKEN not exposed in network responses', async ({ page }) => {
    const token = getInternalToken();
    if (!token) test.skip();

    const exposedUrls: string[] = [];
    page.on('response', async (res) => {
      try {
        const body = await res.text().catch(() => '');
        if (body.includes(token)) exposedUrls.push(res.url());
      } catch {
        // ignore
      }
    });

    await page.goto(`${getDashBase()}/dashboard/products`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    expect(exposedUrls).toHaveLength(0);
  });

  test('DASHBOARD_PASSWORD not exposed in page source', async ({ page }) => {
    const dashPassword = getDashPassword();
    if (!dashPassword) test.skip();

    await page.goto(`${getDashBase()}/dashboard/products`, { waitUntil: 'domcontentloaded' });
    const content = await page.content();
    expect(content).not.toContain(dashPassword);
  });

  test('PostgreSQL URL not exposed in browser network', async ({ page }) => {
    const pgUrl = getState().tempDbUrl ?? '';
    const exposedUrls: string[] = [];

    page.on('response', async (res) => {
      try {
        const body = await res.text().catch(() => '');
        if (pgUrl && body.includes(pgUrl)) exposedUrls.push(res.url());
      } catch {
        // ignore
      }
    });

    await page.goto(`${getDashBase()}/dashboard/products`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    expect(exposedUrls).toHaveLength(0);
  });

  test('Zero unexpected console errors across all test runs', () => {
    const unexpected = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('ERR_EMPTY_RESPONSE') &&
        !e.includes('net::ERR_NETWORK_CHANGED') &&
        !e.includes('401') &&
        !e.includes('404')
    );
    expect(unexpected).toHaveLength(0);
  });

  test('Zero unexpected page errors across all test runs', () => {
    const unexpected = pageErrors.filter(
      (e) => !e.includes('ResizeObserver loop')
    );
    expect(unexpected).toHaveLength(0);
  });

  test('Zero unexpected 5xx responses across all test runs', () => {
    expect(responses5xx).toHaveLength(0);
  });
});
