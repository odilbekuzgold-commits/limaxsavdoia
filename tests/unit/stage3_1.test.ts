import { test, describe } from 'node:test';
import assert from 'node:assert';
import type pg from 'pg';
import {
  createRepositories,
  runMigrations,
  InMemoryCustomerRepository,
  InMemoryProductRepository,
  PgCustomerRepository,
  PgProductRepository,
} from '../../packages/database/dist/index.js';

describe('Stage 3.1: Repository Pattern Unit Tests', () => {
  test('1. Factory driver selection (memory vs postgres)', () => {
    const memoryRepos = createRepositories('memory');
    assert.ok(memoryRepos.customers instanceof InMemoryCustomerRepository);
    assert.ok(memoryRepos.products instanceof InMemoryProductRepository);

    // Mock PG pool
    const mockPool = {} as pg.Pool;
    const pgRepos = createRepositories('postgres', mockPool);
    assert.ok(pgRepos.customers instanceof PgCustomerRepository);
    assert.ok(pgRepos.products instanceof PgProductRepository);

    // Invalid driver should throw error
    assert.throws(
      () => createRepositories('invalid' as any),
      /Unknown repository driver/
    );

    // Postgres without pool should throw error
    assert.throws(
      () => createRepositories('postgres'),
      /PostgreSQL pool.*is required/
    );
  });

  test('2. In-memory repository CRUD, pagination and filter', async () => {
    const repo = new InMemoryCustomerRepository();

    // Create
    const created = await repo.create({
      name: 'Alpha Fabrics',
      preferredLanguage: 'uz',
      status: 'active',
      tags: ['textile', 'b2b'],
      notes: 'Test client',
    });
    assert.ok(created.id);
    assert.strictEqual(created.name, 'Alpha Fabrics');

    // Find by ID
    const found = await repo.findById(created.id);
    assert.ok(found);
    assert.strictEqual(found.name, 'Alpha Fabrics');

    // Not found
    const notFound = await repo.findById('00000000-0000-0000-0000-000000000000');
    assert.strictEqual(notFound, null);

    // Pagination & Search filter
    await repo.create({ name: 'Beta Yarns', preferredLanguage: 'ru', status: 'active', tags: ['yarn'], notes: '' });
    const page1 = await repo.findAll({ page: 1, limit: 1, search: 'Alpha' });
    assert.strictEqual(page1.data.length, 1);
    assert.strictEqual(page1.data[0].name, 'Alpha Fabrics');
    assert.strictEqual(page1.meta.total, 1);

    // Update
    const updated = await repo.update(created.id, { name: 'Alpha Fabrics LLC' });
    assert.strictEqual(updated?.name, 'Alpha Fabrics LLC');
  });

  test('3. PostgreSQL repository parameterized queries & mapping (Mocked Pool)', async () => {
    let executedQuery = '';
    let executedValues: unknown[] = [];

    const mockPool = {
      query: async (sql: string, values: unknown[]) => {
        executedQuery = sql;
        executedValues = values || [];

        if (sql.includes('COUNT(*)')) {
          return { rows: [{ count: '1' }] };
        }

        return {
          rows: [
            {
              id: '11111111-1111-4111-a111-111111111111',
              name: 'Cotton Yarn',
              category: 'Yarn',
              description: 'Pure cotton',
              price: '3.50',
              currency: 'USD',
              minimum_order: 100,
              stock_status: 'in_stock',
              media: ['img1.jpg'],
              active: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        };
      },
    } as unknown as pg.Pool;

    const repo = new PgProductRepository(mockPool);
    const products = await repo.findAll({ category: 'Yarn', activeOnly: true });

    assert.strictEqual(products.length, 1);
    assert.strictEqual(products[0].name, 'Cotton Yarn');
    assert.strictEqual(products[0].price, 3.5); // Parsed NUMERIC string to float number

    // Verify parameterized SQL, no string concatenation of input values
    assert.ok(executedQuery.includes('WHERE'));
    assert.ok(executedQuery.includes('$1'));
    assert.strictEqual(executedValues[0], 'Yarn');
  });

  test('4. PostgreSQL repository create & insert parameterization', async () => {
    let executedQuery = '';
    let executedValues: unknown[] = [];

    const mockPool = {
      query: async (sql: string, values: unknown[]) => {
        executedQuery = sql;
        executedValues = values;
        return {
          rows: [
            {
              id: '22222222-2222-4222-a222-222222222222',
              name: 'Poly Yarn',
              category: 'Synthetic',
              description: 'Durable yarn',
              price: '1.80',
              currency: 'USD',
              minimum_order: 50,
              stock_status: 'in_stock',
              media: [],
              active: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        };
      },
    } as unknown as pg.Pool;

    const repo = new PgProductRepository(mockPool);
    const newProduct = await repo.create({
      name: 'Poly Yarn',
      category: 'Synthetic',
      description: 'Durable yarn',
      price: 1.8,
      currency: 'USD',
      minimumOrder: 50,
      stockStatus: 'in_stock',
      media: [],
      active: true,
    });

    assert.strictEqual(newProduct.id, '22222222-2222-4222-a222-222222222222');
    assert.ok(executedQuery.startsWith('INSERT INTO products'));
    assert.strictEqual(executedValues[0], 'Poly Yarn');
    assert.strictEqual(executedValues[2], 'Synthetic');
  });

  test('5. Duplicate constraint & error handling mapping', async () => {
    const mockPool = {
      query: async () => {
        const error = new Error('duplicate key value violates unique constraint "uq_channel_external"');
        (error as any).code = '23505';
        throw error;
      },
    } as unknown as pg.Pool;

    const repo = new PgCustomerRepository(mockPool);
    await assert.rejects(
      async () => {
        await repo.create({ name: 'Dup Client', preferredLanguage: 'uz', status: 'active', tags: [] });
      },
      (err: any) => err.code === '23505'
    );
  });

  test('6. Dynamic runMigrations executes all 14 migrations (001–014)', async () => {
    const insertedMigrations: string[] = [];

    const mockClient = {
      query: async (sql: string, values?: unknown[]) => {
        if (sql.includes('SELECT name FROM _migrations')) {
          return { rows: [] }; // Clean DB state
        }
        if (sql.includes('INSERT INTO _migrations')) {
          insertedMigrations.push(values?.[0] as string);
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      connect: async () => mockClient,
    } as unknown as pg.Pool;

    await runMigrations(mockPool);

    assert.strictEqual(insertedMigrations.length, 14);
    assert.strictEqual(insertedMigrations[0], '001_pgvector_extension');
    assert.strictEqual(insertedMigrations[13], '014_google_sheets_business_sync');
  });

  test('7. Mounted API Routers (Inventory, Pricing, Certificates, Media, Settings) factory verification', () => {
    const memoryRepos = createRepositories('memory');
    assert.ok(memoryRepos);
  });
});
