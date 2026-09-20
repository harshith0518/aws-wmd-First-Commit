import { createRemoteJWKSet, jwtVerify } from 'jose';
export type AuthConfig = { domain: string; issuer: string; clientId: string; redirectUri: string };
type Transaction = { state: string; nonce: string; verifier: string; created: number };
type Session = { accessToken: string; expires: number };
const transactionKey = 'campusfix.login';
let session: Session | undefined;
let callbackTask: Promise<void> | undefined;
export function authConfig(env: Record<string, string | undefined>): AuthConfig | undefined {
  const domain = env.VITE_COGNITO_DOMAIN,
    issuer = env.VITE_COGNITO_ISSUER,
    clientId = env.VITE_COGNITO_CLIENT_ID,
    redirectUri = env.VITE_COGNITO_REDIRECT_URI;
  if (!domain || !issuer || !clientId || !redirectUri) return;
  try {
    const callback = new URL(redirectUri);
    if (
      new URL(domain).protocol !== 'https:' ||
      new URL(domain).origin !== domain ||
      !/^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/[A-Za-z0-9_-]+$/.test(issuer) ||
      (callback.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(callback.hostname)) ||
      callback.pathname !== '/auth/callback' ||
      callback.search ||
      callback.hash ||
      callback.username ||
      callback.password
    )
      return;
    return { domain, issuer, clientId, redirectUri };
  } catch {
    return;
  }
}
export function base64url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
export async function pkceChallenge(verifier: string) {
  return base64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
}
export async function beginSignIn(config: AuthConfig) {
  if (new URL(config.redirectUri).origin !== location.origin)
    throw new Error('Open the app at its configured callback hostname before signing in.');
  const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
  const transaction: Transaction = {
    state: random(),
    nonce: random(),
    verifier: random(),
    created: Date.now(),
  };
  sessionStorage.setItem(transactionKey, JSON.stringify(transaction));
  const url = new URL('/oauth2/authorize', config.domain);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    scope: 'openid email profile campusfix/api',
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge: await pkceChallenge(transaction.verifier),
    code_challenge_method: 'S256',
  }).toString();
  location.assign(url.toString());
}
export function validateTransaction(
  value: unknown,
  state: string | null,
  now = Date.now(),
): Transaction {
  const t = value as Partial<Transaction> | null;
  if (
    !t ||
    typeof t.state !== 'string' ||
    t.state !== state ||
    typeof t.nonce !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(t.nonce) ||
    typeof t.verifier !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(t.verifier) ||
    typeof t.created !== 'number' ||
    t.created > now ||
    now - t.created > 10 * 60_000
  )
    throw new Error('This sign-in attempt expired or could not be verified. Start again.');
  return t as Transaction;
}
export function completeSignIn(config: AuthConfig): Promise<void> {
  // React strict effects may mount twice. Exchange a one-use code only once.
  callbackTask ??= (async () => {
    const params = new URLSearchParams(location.search);
    history.replaceState(null, '', '/auth/callback');
    const saved = sessionStorage.getItem(transactionKey);
    sessionStorage.removeItem(transactionKey);
    const transaction = validateTransaction(saved ? JSON.parse(saved) : null, params.get('state'));
    if (params.has('error') || !params.get('code'))
      throw new Error('Sign-in was cancelled. You can try again.');
    const response = await fetch(`${config.domain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        code: params.get('code')!,
        code_verifier: transaction.verifier,
      }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Sign-in could not be completed. Start again.');
    const result = (await response.json()) as { id_token?: string; access_token?: string };
    if (!result.id_token || !result.access_token)
      throw new Error('The identity provider returned an incomplete session.');
    const jwks = createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`));
    const [id, access] = await Promise.all([
      jwtVerify(result.id_token, jwks, {
        issuer: config.issuer,
        audience: config.clientId,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'nonce'],
      }),
      jwtVerify(result.access_token, jwks, {
        issuer: config.issuer,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'token_use', 'client_id', 'scope'],
      }),
    ]);
    if (
      id.payload.nonce !== transaction.nonce ||
      id.payload.token_use !== 'id' ||
      id.payload.sub !== access.payload.sub ||
      access.payload.token_use !== 'access' ||
      access.payload.client_id !== config.clientId ||
      typeof access.payload.scope !== 'string' ||
      !access.payload.scope.split(' ').includes('campusfix/api')
    )
      throw new Error('The sign-in response could not be verified.');
    session = { accessToken: result.access_token, expires: access.payload.exp! * 1000 };
  })();
  return callbackTask;
}
export function accessToken(): string {
  if (!session || session.expires <= Date.now()) {
    session = undefined;
    throw new Error('Your session expired. Sign in again.');
  }
  return session.accessToken;
}
export function clearSession() {
  session = undefined;
  callbackTask = undefined;
  sessionStorage.removeItem(transactionKey);
}
export function signOut(config?: AuthConfig) {
  clearSession();
  if (!config) {
    location.replace('/');
    return;
  }
  const url = new URL('/logout', config.domain);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: new URL(config.redirectUri).origin + '/',
  }).toString();
  location.replace(url.toString());
}
