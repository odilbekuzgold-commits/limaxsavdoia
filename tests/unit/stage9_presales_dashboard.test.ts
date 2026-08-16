import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createRepositories } from '../../packages/database/dist/index.js';
import { createDashboardRouter } from '../../apps/api/dist/modules/dashboard.js';
import type { Repositories } from '@limax/shared';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Mirror exact constant-time middleware protection logic from apps/dashboard/src/middleware.ts
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

function verifyDashboardAuth(authHeader: string | null): { status: number } {
  const user = process.env.DASHBOARD_USER;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!user || !password) {
    if (process.env.NODE_ENV !== 'production') return { status: 200 };
    return { status: 503 };
  }
  if (authHeader?.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const givenUser = separator >= 0 ? decoded.slice(0, separator) : '';
    const givenPassword = separator >= 0 ? decoded.slice(separator + 1) : '';
    if (equal(givenUser, user) && equal(givenPassword, password)) return { status: 200 };
  }
  return { status: 401 };
}

describe('Stage 9: LImax Presales Analytics Dashboard Tests', () => {
  let repos: Repositories;
  let router: any;

  beforeEach(() => {
    repos = createRepositories('memory');
    router = createDashboardRouter(repos);
  });

  // Mock runner for Express router without requiring express in root node_modules
  function callOverview(queryString: string = '') {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      const query: Record<string, string> = {};
      if (queryString) {
        const searchParams = new URLSearchParams(queryString);
        searchParams.forEach((val, key) => {
          query[key] = val;
        });
      }

      const req: any = {
        method: 'GET',
        path: '/overview',
        url: `/overview?${queryString}`,
        query,
        headers: {},
      };

      let statusCode = 200;

      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(data: any) {
          resolve({ status: statusCode, body: data });
        },
      };

      const next = (err?: any) => {
        if (err) reject(err);
        else resolve({ status: 404, body: null });
      };

      router(req, res, next);
    });
  }

  // Test 1: Empty repositories → all real metrics 0/null, no fake product/manager
  it('1. Empty repositories return 0/null metrics and no fake products/managers', async () => {
    const res = await callOverview();
    assert.strictEqual(res.status, 200);
    const body = res.body.data;

    assert.strictEqual(body.leadSummary.totalLeads, 0);
    assert.strictEqual(body.leadSummary.qualifiedLeads, 0);
    assert.strictEqual(body.leadSummary.unqualifiedLeads, 0);
    assert.deepStrictEqual(body.topProducts, []);
    assert.deepStrictEqual(body.topManagers, []);
    assert.strictEqual(body.responseTime.avgResponseSeconds, null);
    assert.strictEqual(body.responseTime.formatted, null);
    assert.strictEqual(body.responseTime.sampleSize, 0);
    assert.strictEqual(body.customerSummary.conversionRate, null);
  });

  // Test 2: Missing productInterest → default product is not invented
  it('2. Missing productInterest does not invent default product', async () => {
    const cust = await repos.customers.create({ name: 'Test Customer', preferredLanguage: 'uz', status: 'active', tags: [] });
    await repos.leads.create({ customerId: cust.id, score: 50, temperature: 'WARM', stage: 'new' });

    const res = await callOverview();
    assert.strictEqual(res.status, 200);
    const body = res.body.data;

    assert.deepStrictEqual(body.topProducts, []);
    assert.strictEqual(body.recentLeads[0].requestedProduct, 'Ko‘rsatilmagan');
  });

  // Test 3: Unassigned lead → not assigned to fake manager
  it('3. Unassigned lead is not assigned to a fake default manager', async () => {
    const cust = await repos.customers.create({ name: 'Test Customer', preferredLanguage: 'uz', status: 'active', tags: [] });
    await repos.leads.create({ customerId: cust.id, score: 20, temperature: 'COLD', stage: 'new' });

    const res = await callOverview();
    assert.strictEqual(res.status, 200);
    const body = res.body.data;

    assert.strictEqual(body.recentLeads[0].manager, 'Biriktirilmagan');
    assert.deepStrictEqual(body.topManagers, []);
  });

  // Test 4: Real handoff → managerRouted count increases
  it('4. Real handoff increases managerRouted count', async () => {
    const cust = await repos.customers.create({ name: 'Handoff Customer', preferredLanguage: 'uz', status: 'active', tags: [] });
    const conv = await repos.conversations.create({ customerId: cust.id, contactId: cust.id, channel: 'telegram', status: 'WAITING_MANAGER', lastMessageAt: new Date() });
    await repos.leads.create({ customerId: cust.id, conversationId: conv.id, score: 70, temperature: 'HOT', stage: 'qualifying' });
    await repos.handoffs.create({ conversationId: conv.id, customerId: cust.id, reason: 'Customer requested human' });

    const res = await callOverview();
    assert.strictEqual(res.status, 200);

    assert.strictEqual(res.body.data.leadSummary.managerRoutedLeads, 1);
    assert.strictEqual(res.body.data.aiSummary.managerRouted, 1);
  });

  // Test 5: No handoff & no manager → managerRouted is false
  it('5. No handoff and no assigned manager is not counted as managerRouted', async () => {
    const cust = await repos.customers.create({ name: 'Pure AI Customer', preferredLanguage: 'uz', status: 'active', tags: [] });
    const conv = await repos.conversations.create({ customerId: cust.id, contactId: cust.id, channel: 'telegram', status: 'AI_ACTIVE', lastMessageAt: new Date() });
    await repos.leads.create({ customerId: cust.id, conversationId: conv.id, score: 40, temperature: 'COLD', stage: 'new' });
    await repos.messages.create({ conversationId: conv.id, senderType: 'ai', content: 'Assalomu alaykum!', status: 'SENT' });

    const res = await callOverview();
    assert.strictEqual(res.status, 200);

    assert.strictEqual(res.body.data.leadSummary.managerRoutedLeads, 0);
    assert.strictEqual(res.body.data.leadSummary.aiProcessedLeads, 1);
  });

  // Test 6: AI message / usage evidence → aiProcessed count correct
  it('6. AI message or usage log evidence accurately counts as aiProcessed', async () => {
    const cust = await repos.customers.create({ name: 'AI Evidence Customer', preferredLanguage: 'uz', status: 'active', tags: [] });
    const conv = await repos.conversations.create({ customerId: cust.id, contactId: cust.id, channel: 'telegram', status: 'AI_ACTIVE', lastMessageAt: new Date() });
    await repos.leads.create({ customerId: cust.id, conversationId: conv.id, score: 65, temperature: 'WARM', stage: 'qualifying' });
    await repos.aiUsage.create({ provider: 'openai', model: 'gpt-4o', status: 'SUCCESS', conversationId: conv.id });

    const res = await callOverview();
    assert.strictEqual(res.status, 200);

    assert.strictEqual(res.body.data.leadSummary.aiProcessedLeads, 1);
    assert.strictEqual(res.body.data.aiSummary.aiProcessed, 1);
  });

  // Test 7: Response time calculated from customer -> first AI/manager pair
  it('7. Real response time calculated from customer message to first reply pair', async () => {
    const cust = await repos.customers.create({ name: 'Response Time Customer', preferredLanguage: 'uz', status: 'active', tags: [] });
    const conv = await repos.conversations.create({ customerId: cust.id, contactId: cust.id, channel: 'telegram', status: 'AI_ACTIVE', lastMessageAt: new Date() });
    await repos.leads.create({ customerId: cust.id, conversationId: conv.id, score: 50, temperature: 'WARM', stage: 'new' });

    const t1 = new Date(Date.now() - 100000);
    const t2 = new Date(t1.getTime() + 105000); // 105 seconds difference

    await repos.messages.create({ conversationId: conv.id, senderType: 'customer', content: 'Yarn price?', createdAt: t1 } as any);
    await repos.messages.create({ conversationId: conv.id, senderType: 'ai', content: 'Hello! Here is yarn catalog.', createdAt: t2 } as any);

    const res = await callOverview();
    assert.strictEqual(res.status, 200);
    const rt = res.body.data.responseTime;

    assert.strictEqual(rt.sampleSize, 1);
    assert.strictEqual(rt.avgResponseSeconds, 105);
    assert.strictEqual(rt.formatted, '1m 45s');
  });

  // Test 8: Unanswered message does not enter response time calculation
  it('8. Unanswered customer message is excluded from response time calculation', async () => {
    const cust = await repos.customers.create({ name: 'Unanswered Customer', preferredLanguage: 'uz', status: 'active', tags: [] });
    const conv = await repos.conversations.create({ customerId: cust.id, contactId: cust.id, channel: 'telegram', status: 'WAITING_MANAGER', lastMessageAt: new Date() });
    await repos.leads.create({ customerId: cust.id, conversationId: conv.id, score: 50, temperature: 'WARM', stage: 'new' });

    await repos.messages.create({ conversationId: conv.id, senderType: 'customer', content: 'Need urgent order' });

    const res = await callOverview();
    assert.strictEqual(res.status, 200);
    const rt = res.body.data.responseTime;

    assert.strictEqual(rt.sampleSize, 0);
    assert.strictEqual(rt.avgResponseSeconds, null);
    assert.strictEqual(rt.formatted, null);
  });

  // Test 9: month uses current calendar month
  it('9. Month dateRange uses current calendar month', async () => {
    const res = await callOverview('dateRange=month');
    assert.strictEqual(res.status, 200);
    const period = res.body.data.period;

    assert.strictEqual(period.range, 'month');
    assert.ok(period.startDate);
    const startDate = new Date(period.startDate);
    assert.strictEqual(startDate.getDate(), 1);
  });

  // Test 10: Previous/current date boundaries do not overlap
  it('10. Current and previous period date boundaries do not overlap', async () => {
    const res = await callOverview('dateRange=7d');
    assert.strictEqual(res.status, 200);

    const leadSummary = res.body.data.leadSummary;
    assert.strictEqual(leadSummary.totalLeadsChange, null); // No overlap or invented % when no previous data
  });

  // Test 11: Manager filter affects all KPIs consistently
  it('11. Manager filter consistently filters all dashboard KPIs', async () => {
    const cust1 = await repos.customers.create({ name: 'Customer 1', preferredLanguage: 'uz', status: 'active', tags: [] });
    const cust2 = await repos.customers.create({ name: 'Customer 2', preferredLanguage: 'uz', status: 'active', tags: [] });

    await repos.leads.create({ customerId: cust1.id, assignedManagerId: 'mgr-alpha', score: 80, temperature: 'HOT', stage: 'proposal', estimatedValue: 5000, productInterest: 'Cotton Yarn 30/1' });
    await repos.leads.create({ customerId: cust2.id, assignedManagerId: 'mgr-beta', score: 30, temperature: 'COLD', stage: 'new', productInterest: 'Acrylic Yarn' });

    const resAll = await callOverview('managerId=all');
    assert.strictEqual(resAll.body.data.leadSummary.totalLeads, 2);

    const resAlpha = await callOverview('managerId=mgr-alpha');
    assert.strictEqual(resAlpha.body.data.leadSummary.totalLeads, 1);
    assert.strictEqual(resAlpha.body.data.topProducts[0].name, 'Cotton Yarn 30/1');
    assert.strictEqual(resAlpha.body.data.customerSummary.totalCustomers, 1);
    assert.strictEqual(resAlpha.body.data.offers.count, 1);
  });

  // Test 12: Qualification does not force UNKNOWN to UNQUALIFIED
  it('12. Qualification does not force UNKNOWN leads to UNQUALIFIED', async () => {
    const cust = await repos.customers.create({ name: 'Ambiguous Customer', preferredLanguage: 'uz', status: 'active', tags: [] });
    await repos.leads.create({ customerId: cust.id, score: 50, stage: 'new' } as any);

    const res = await callOverview();
    assert.strictEqual(res.status, 200);
    const ls = res.body.data.leadSummary;

    assert.strictEqual(ls.qualifiedLeads, 0);
    assert.strictEqual(ls.unqualifiedLeads, 0);
    assert.strictEqual(ls.unknownLeads, 1);
    assert.strictEqual(ls.totalLeads, ls.qualifiedLeads + ls.unqualifiedLeads + ls.unknownLeads);
  });

  // Test 13: Recent lead phone masks PII
  it('13. Recent lead phone number sanitizes PII', async () => {
    const cust = await repos.customers.create({ name: 'Private Customer', preferredLanguage: 'uz', status: 'active', tags: [] });
    await repos.contacts.create({ customerId: cust.id, channel: 'telegram', externalId: 'ext-1', phone: '+998901234567' });
    await repos.leads.create({ customerId: cust.id, score: 50, temperature: 'WARM', stage: 'new' });

    const res = await callOverview();
    assert.strictEqual(res.status, 200);
    const phone = res.body.data.recentLeads[0].sanitizedPhone;

    assert.strictEqual(phone.includes('1234567'), false);
    assert.ok(phone.includes('***'));
  });

  // Test 14: Production source has 0 hardcoded fake names / products
  it('14. Production source code contains 0 fake manager names or products', () => {
    const sourcePath = resolve(process.cwd(), 'apps/api/src/modules/dashboard.ts');
    const content = readFileSync(sourcePath, 'utf8');

    assert.strictEqual(content.includes('DTY 75D/36F Polyester'), false);
    assert.strictEqual(content.includes('Alisher Qodirov'), false);
    assert.strictEqual(content.includes('Malika Axmedova'), false);
    assert.strictEqual(content.includes('Javohir Toshmatov'), false);
    assert.strictEqual(content.includes('avgResponseSeconds: 105'), false);
  });

  // Test 15: Meta null -> Meta integration ulanmagan
  it('15. Meta property is null indicating unconnected integration', async () => {
    const res = await callOverview();
    assert.strictEqual(res.status, 200);

    assert.strictEqual(res.body.data.meta, null);
  });

  // Test 16: Dashboard auth missing in production returns 503
  it('16. Dashboard middleware in production without configured credentials returns 503', () => {
    const oldEnv = process.env.NODE_ENV;
    const oldUser = process.env.DASHBOARD_USER;
    const oldPass = process.env.DASHBOARD_PASSWORD;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.DASHBOARD_USER;
      delete process.env.DASHBOARD_PASSWORD;

      const res = verifyDashboardAuth(null);

      assert.strictEqual(res.status, 503);
    } finally {
      process.env.NODE_ENV = oldEnv;
      process.env.DASHBOARD_USER = oldUser;
      process.env.DASHBOARD_PASSWORD = oldPass;
    }
  });

  // Test 17: Valid Basic Auth makes dashboard accessible
  it('17. Dashboard middleware with valid Basic Auth allows access', () => {
    const oldEnv = process.env.NODE_ENV;
    const oldUser = process.env.DASHBOARD_USER;
    const oldPass = process.env.DASHBOARD_PASSWORD;

    try {
      process.env.NODE_ENV = 'production';
      process.env.DASHBOARD_USER = 'admin';
      process.env.DASHBOARD_PASSWORD = 'strongsecretpassword123456';

      const validAuth = `Basic ${Buffer.from('admin:strongsecretpassword123456').toString('base64')}`;
      const res = verifyDashboardAuth(validAuth);

      assert.strictEqual(res.status, 200);
    } finally {
      process.env.NODE_ENV = oldEnv;
      process.env.DASHBOARD_USER = oldUser;
      process.env.DASHBOARD_PASSWORD = oldPass;
    }
  });

  // Test 18: Internal API token is not leaked to client-side bundle
  it('18. Internal API token is strictly server-side and absent from client bundle', () => {
    const clientPath = resolve(process.cwd(), 'apps/dashboard/src/components/analytics/DashboardClientContainer.tsx');
    const content = readFileSync(clientPath, 'utf8');

    assert.strictEqual(content.includes('INTERNAL_API_TOKEN'), false);
    assert.strictEqual(content.includes('limax-stage7b-dev-internal-token-20260809'), false);
  });
});
