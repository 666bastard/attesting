import { createSign } from 'crypto';
import { fetchWithTimeout } from './fetch-with-timeout.js';

/**
 * Minimal Google service-account OAuth2 helper using a self-signed JWT.
 *
 * Reference: https://developers.google.com/identity/protocols/oauth2/service-account
 */

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** Build and RS256-sign a JWT assertion for the service account. */
export function buildAssertion(
  key: ServiceAccountKey,
  scope: string = DEFAULT_SCOPE,
  now: Date = new Date(),
): string {
  const aud = key.token_uri ?? DEFAULT_TOKEN_URI;
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + 3600;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: key.client_email,
    sub: key.client_email,
    scope,
    aud,
    iat,
    exp,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedClaims = base64url(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedClaims}`;

  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(key.private_key).toString('base64url');

  return `${signingInput}.${signature}`;
}

/** Exchange the JWT assertion for a bearer access token. */
export async function fetchAccessToken(
  key: ServiceAccountKey,
  scope: string = DEFAULT_SCOPE,
  now: Date = new Date(),
  timeoutMs?: number,
): Promise<TokenResponse> {
  const assertion = buildAssertion(key, scope, now);
  const tokenUri = key.token_uri ?? DEFAULT_TOKEN_URI;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const res = await fetchWithTimeout(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    timeoutMs,
    adapter: 'GCP OAuth',
  });

  if (!res.ok) {
    let text = '';
    try { text = (await res.text()).substring(0, 200); } catch { /* ignore */ }
    throw new Error(`Google OAuth2 token fetch failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<TokenResponse>;
}

function base64url(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64url');
}
