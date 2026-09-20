import { createContext, useContext } from 'react';
import { errorSchema } from '@campusfix/contracts';
import { accessToken, clearSession } from './auth';
export class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export type ApiClient = <T>(
  path: string,
  schema: { parse: (data: unknown) => T },
  init?: RequestInit,
) => Promise<T>;
export function createApi(getToken: () => string, base = '/api/v1'): ApiClient {
  return async function request<T>(
    path: string,
    schema: { parse: (data: unknown) => T },
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${getToken()}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      signal: init.signal ?? AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const parsed = errorSchema.safeParse(await response.json().catch(() => null));
      if (response.status === 401) {
        clearSession();
        window.dispatchEvent(new Event('campusfix:session-ended'));
      }
      throw new RequestError(
        parsed.success ? parsed.data.code : 'REQUEST_FAILED',
        parsed.success ? parsed.data.message : 'The request failed. Please retry.',
        response.status,
      );
    }
    return schema.parse(await response.json());
  };
}
export const api = createApi(accessToken);
export const ApiContext = createContext<ApiClient>(api);
export const useApi = () => useContext(ApiContext);
