import type pg from 'pg';
import type {
  Manager,
  CreateManager,
  UpdateManager,
  ManagerStatus,
  IManagerRepository,
} from '@limax/shared';

export class PgManagerRepository implements IManagerRepository {
  constructor(private pool: pg.Pool | pg.PoolClient) {}

  async findAll(params?: { status?: ManagerStatus; onDutyOnly?: boolean }): Promise<Manager[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (params?.status) {
      conditions.push(`status = $${paramIdx++}`);
      values.push(params.status);
    }

    if (params?.onDutyOnly) {
      conditions.push(`is_on_duty = TRUE`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT id, name, role, phone, telegram_username, telegram_chat_id, status, is_on_duty, specialties, max_active_leads, created_at, updated_at
       FROM managers
       ${where}
       ORDER BY is_on_duty DESC, name ASC`,
      values
    );

    return result.rows.map(this.mapRow);
  }

  async findById(id: string): Promise<Manager | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT id, name, role, phone, telegram_username, telegram_chat_id, status, is_on_duty, specialties, max_active_leads, created_at, updated_at
       FROM managers
       WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async create(data: CreateManager): Promise<Manager> {
    const result = await this.pool.query<Record<string, unknown>>(
      `INSERT INTO managers (name, role, phone, telegram_username, telegram_chat_id, status, is_on_duty, specialties, max_active_leads)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, role, phone, telegram_username, telegram_chat_id, status, is_on_duty, specialties, max_active_leads, created_at, updated_at`,
      [
        data.name,
        data.role || 'Sotuv menejeri',
        data.phone || null,
        data.telegramUsername ? data.telegramUsername.replace(/^@/, '') : null,
        data.telegramChatId || null,
        data.status || 'ACTIVE',
        data.isOnDuty ?? false,
        data.specialties || [],
        data.maxActiveLeads || 20,
      ]
    );
    return this.mapRow(result.rows[0]);
  }

  async update(id: string, data: UpdateManager): Promise<Manager | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) { sets.push(`name = $${idx++}`); values.push(data.name); }
    if (data.role !== undefined) { sets.push(`role = $${idx++}`); values.push(data.role); }
    if (data.phone !== undefined) { sets.push(`phone = $${idx++}`); values.push(data.phone); }
    if (data.telegramUsername !== undefined) {
      sets.push(`telegram_username = $${idx++}`);
      values.push(data.telegramUsername ? data.telegramUsername.replace(/^@/, '') : null);
    }
    if (data.telegramChatId !== undefined) { sets.push(`telegram_chat_id = $${idx++}`); values.push(data.telegramChatId); }
    if (data.status !== undefined) { sets.push(`status = $${idx++}`); values.push(data.status); }
    if (data.isOnDuty !== undefined) { sets.push(`is_on_duty = $${idx++}`); values.push(data.isOnDuty); }
    if (data.specialties !== undefined) { sets.push(`specialties = $${idx++}`); values.push(data.specialties); }
    if (data.maxActiveLeads !== undefined) { sets.push(`max_active_leads = $${idx++}`); values.push(data.maxActiveLeads); }

    if (sets.length === 0) {
      return this.findById(id);
    }

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE managers
       SET ${sets.join(', ')}
       WHERE id = $${idx}
       RETURNING id, name, role, phone, telegram_username, telegram_chat_id, status, is_on_duty, specialties, max_active_leads, created_at, updated_at`,
      values
    );

    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM managers WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async setOnDuty(id: string, isOnDuty: boolean): Promise<Manager | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      `UPDATE managers
       SET is_on_duty = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, role, phone, telegram_username, telegram_chat_id, status, is_on_duty, specialties, max_active_leads, created_at, updated_at`,
      [isOnDuty, id]
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  private mapRow(row: Record<string, unknown>): Manager {
    return {
      id: String(row.id),
      name: String(row.name),
      role: String(row.role || 'Sotuv menejeri'),
      phone: row.phone ? String(row.phone) : undefined,
      telegramUsername: row.telegram_username ? String(row.telegram_username) : undefined,
      telegramChatId: row.telegram_chat_id ? String(row.telegram_chat_id) : undefined,
      status: (row.status as ManagerStatus) || 'ACTIVE',
      isOnDuty: Boolean(row.is_on_duty),
      specialties: Array.isArray(row.specialties) ? (row.specialties as string[]) : [],
      maxActiveLeads: typeof row.max_active_leads === 'number' ? row.max_active_leads : 20,
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at)),
    };
  }
}
