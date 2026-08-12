import type { UserRole, Permission } from '@limax/shared';

const ROLE_PERMISSIONS: Record<UserRole, Set<Permission>> = {
  SUPER_ADMIN: new Set([
    'products.read',
    'products.create',
    'products.update',
    'pricing.read',
    'pricing.create',
    'pricing.update',
    'inventory.read',
    'inventory.update',
    'knowledge.read',
    'knowledge.create',
    'knowledge.update',
    'knowledge.approve',
    'settings.read',
    'settings.update',
  ]),
  ADMIN: new Set([
    'products.read',
    'products.create',
    'products.update',
    'pricing.read',
    'pricing.create',
    'pricing.update',
    'inventory.read',
    'inventory.update',
    'knowledge.read',
    'knowledge.create',
    'knowledge.update',
    'knowledge.approve',
    'settings.read',
    'settings.update',
  ]),
  SALES_MANAGER: new Set([
    'products.read',
    'pricing.read',
    'pricing.create',
    'pricing.update',
    'inventory.read',
    'inventory.update',
    'knowledge.read',
    'settings.read',
  ]),
  CONTENT_MANAGER: new Set([
    'products.read',
    'products.create',
    'products.update',
    'pricing.read',
    'knowledge.read',
    'knowledge.create',
    'knowledge.update',
    'knowledge.approve',
  ]),
  VIEWER: new Set([
    'products.read',
    'pricing.read',
    'inventory.read',
    'knowledge.read',
    'settings.read',
  ]),
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role];
  return perms ? perms.has(permission) : false;
}

export function checkPermission(role: UserRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Forbidden: Role '${role}' lacks required permission '${permission}'`);
  }
}
