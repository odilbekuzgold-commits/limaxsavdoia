import type { Repositories, UserRole } from '@limax/shared';

export interface AuditContext {
  userId: string;
  userRole: UserRole;
}

export async function logAudit(
  repos: Repositories,
  ctx: AuditContext,
  action: string,
  entity: string,
  entityId?: string,
  details?: Record<string, unknown>
): Promise<void> {
  await repos.auditLogs.create({
    userId: ctx.userId,
    userRole: ctx.userRole,
    action,
    entity,
    entityId,
    details,
  });
}
