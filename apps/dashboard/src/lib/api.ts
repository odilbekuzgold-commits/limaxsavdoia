import 'server-only';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let rootEnv: Record<string, string> | undefined;

function serverEnv(): Record<string, string> {
  if (rootEnv) return rootEnv;
  rootEnv = {};
  try {
    const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
    let content = '';
    for (const candidate of candidates) {
      try { content = readFileSync(candidate, 'utf8'); break; } catch { /* try monorepo root */ }
    }
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      rootEnv[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch { /* API fallback reports offline without exposing secrets. */ }
  return rootEnv;
}

export async function apiGet<T>(path: string): Promise<T> {
  const env = serverEnv();
  const apiUrl = process.env.DASHBOARD_API_URL ?? env.DASHBOARD_API_URL ?? 'http://127.0.0.1:4000';
  const token = process.env.INTERNAL_API_TOKEN ?? env.INTERNAL_API_TOKEN;
  const response = await fetch(`${apiUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`API request failed (${response.status})`);
  return response.json() as Promise<T>;
}
