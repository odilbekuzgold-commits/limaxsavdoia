const API_URL = process.env.DASHBOARD_API_URL ?? 'http://127.0.0.1:4000';

export async function apiGet<T>(path: string): Promise<T> {
  const token = process.env.INTERNAL_API_TOKEN;
  const response = await fetch(`${API_URL}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`API request failed (${response.status})`);
  return response.json() as Promise<T>;
}
