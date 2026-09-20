export function apiBaseUrl(value?: string): string {
  if (!value) return '/api/v1';
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/api/v1'
  )
    throw new Error('VITE_API_BASE_URL must be an HTTPS API origin ending in /api/v1.');
  return url.toString();
}
export function workspacePath(location: { pathname: string; search: string }): string {
  return location.pathname + location.search;
}
