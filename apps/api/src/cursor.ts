import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ApiError } from './errors.js';
import type { Key } from './data/store.js';
export class CursorCodec {
  private key: Buffer;
  constructor(secret: string) {
    this.key = createHash('sha256').update(secret).digest();
  }
  encode(binding: string, after: Key, now = Date.now()) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify({ binding, after, expires: now + 15 * 60_000 })),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  }
  decode(token: string, binding: string, now = Date.now()): Key {
    try {
      if (token.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error();
      const data = Buffer.from(token, 'base64url');
      const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      const result = JSON.parse(
        Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString(),
      ) as { binding: string; expires: number; after: Key };
      if (
        result.binding !== binding ||
        !(result.expires > now) ||
        typeof result.after.pk !== 'string' ||
        typeof result.after.sk !== 'string'
      )
        throw new Error();
      return result.after;
    } catch {
      throw new ApiError(422, 'INVALID_CURSOR', 'This page link has expired. Refresh the list.');
    }
  }
}
