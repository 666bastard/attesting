import { createHash, createHmac } from 'crypto';

/**
 * Minimal AWS Signature V4 signer for POST JSON requests.
 * Implements the subset needed by the Security Hub adapter.
 *
 * Reference: https://docs.aws.amazon.com/general/latest/gr/sigv4-signed-request-examples.html
 */

export interface SignInput {
  method: 'POST' | 'GET';
  url: string;
  region: string;
  service: string;
  body: string;
  headers?: Record<string, string>;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** Override clock (for deterministic tests). Defaults to `new Date()`. */
  now?: Date;
}

export interface SignedRequest {
  headers: Record<string, string>;
}

export function signRequest(input: SignInput): SignedRequest {
  const now = input.now ?? new Date();
  const amzDate = toAmzDate(now); // 20260405T100000Z
  const dateStamp = amzDate.slice(0, 8); // 20260405

  const parsed = new URL(input.url);
  const host = parsed.host;
  const canonicalUri = parsed.pathname || '/';
  const canonicalQueryString = canonicalizeQuery(parsed.searchParams);

  const headers: Record<string, string> = {
    'content-type': 'application/x-amz-json-1.0',
    host,
    'x-amz-date': amzDate,
    ...lowercaseKeys(input.headers ?? {}),
  };
  if (input.sessionToken) headers['x-amz-security-token'] = input.sessionToken;

  const payloadHash = sha256Hex(input.body);
  headers['x-amz-content-sha256'] = payloadHash;

  const sortedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderNames.map(k => `${k}:${trimWs(headers[k])}\n`).join('');
  const signedHeaders = sortedHeaderNames.join(';');

  const canonicalRequest = [
    input.method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = deriveSigningKey(input.secretAccessKey, dateStamp, input.region, input.service);
  const signature = hmacHex(signingKey, stringToSign);

  const authorization =
    `AWS4-HMAC-SHA256 ` +
    `Credential=${input.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`;

  return {
    headers: {
      ...withOriginalCasing(input.headers ?? {}),
      'Content-Type': 'application/x-amz-json-1.0',
      Host: host,
      'X-Amz-Date': amzDate,
      'X-Amz-Content-Sha256': payloadHash,
      ...(input.sessionToken ? { 'X-Amz-Security-Token': input.sessionToken } : {}),
      Authorization: authorization,
    },
  };
}

// ── internals ───────────────────────────────────────────

function toAmzDate(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function hmacHex(key: Buffer, data: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

function deriveSigningKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate = hmac('AWS4' + secret, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function canonicalizeQuery(params: URLSearchParams): string {
  const pairs: Array<[string, string]> = [];
  params.forEach((v, k) => pairs.push([encodeRfc3986(k), encodeRfc3986(v)]));
  pairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

function encodeRfc3986(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    c => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function trimWs(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

function lowercaseKeys(o: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) out[k.toLowerCase()] = v;
  return out;
}

function withOriginalCasing(o: Record<string, string>): Record<string, string> {
  return { ...o };
}
