import { createHash } from 'node:crypto';
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { EvidenceStorage, ObjectRef, ObjectReceipt } from './storage.js';
export class S3EvidenceStorage implements EvidenceStorage {
  readonly kind = 'aws' as const;
  readonly client: S3Client;
  constructor(
    readonly region: string,
    readonly quarantineBucket: string,
    readonly evidenceBucket: string,
    client?: S3Client,
  ) {
    this.client = client ?? new S3Client({ region, maxAttempts: 2 });
  }
  async reserve(key: string, mime: string, bytes: number, sha256: string, expiresIn: number) {
    return createPresignedPost(this.client, {
      Bucket: this.quarantineBucket,
      Key: key,
      Expires: Math.min(300, expiresIn),
      Conditions: [['content-length-range', bytes, bytes]],
      Fields: {
        'Content-Type': mime,
        'x-amz-checksum-algorithm': 'SHA256',
        'x-amz-checksum-sha256': Buffer.from(sha256, 'hex').toString('base64'),
        success_action_status: '201',
      },
    });
  }
  async head(key: string, version?: string): Promise<ObjectReceipt> {
    const h = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.quarantineBucket,
        Key: key,
        ChecksumMode: 'ENABLED',
        ...(version ? { VersionId: version } : {}),
      }),
    );
    if (!h.VersionId || h.VersionId === 'null' || !h.ChecksumSHA256 || !h.LastModified)
      throw new Error('A versioned checksummed object is required.');
    return {
      key,
      version: h.VersionId,
      bytes: h.ContentLength ?? 0,
      mime: h.ContentType ?? '',
      sha256: Buffer.from(h.ChecksumSHA256, 'base64').toString('hex'),
      modifiedAt: h.LastModified.toISOString(),
    };
  }
  async read(ref: ObjectRef) {
    const r = await this.client.send(
      new GetObjectCommand({ Bucket: this.quarantineBucket, Key: ref.key, VersionId: ref.version }),
    );
    if (!r.Body || !r.ContentLength || r.ContentLength > 5242880)
      throw new Error('Invalid evidence length.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const part of r.Body as AsyncIterable<Uint8Array>) {
      size += part.length;
      if (size > 5242880) throw new Error('Evidence exceeds limit.');
      chunks.push(part);
    }
    return Buffer.concat(chunks);
  }
  async write(key: string, bytes: Uint8Array, mime: string) {
    try {
      const r = await this.client.send(
        new PutObjectCommand({
          Bucket: this.evidenceBucket,
          Key: key,
          Body: bytes,
          ContentType: mime,
          ChecksumSHA256: createHash('sha256').update(bytes).digest('base64'),
          IfNoneMatch: '*',
          ServerSideEncryption: 'AES256',
          CacheControl: 'private, no-store',
        }),
      );
      if (!r.VersionId || r.VersionId === 'null')
        throw new Error('Versioned evidence store required.');
      return { key, version: r.VersionId };
    } catch (e) {
      if (!(e instanceof Error) || e.name !== 'PreconditionFailed') throw e;
      const r = await this.client.send(
        new HeadObjectCommand({ Bucket: this.evidenceBucket, Key: key, ChecksumMode: 'ENABLED' }),
      );
      if (!r.VersionId || r.ChecksumSHA256 !== createHash('sha256').update(bytes).digest('base64'))
        throw new Error('Evidence content conflict.');
      return { key, version: r.VersionId };
    }
  }
  async download(ref: ObjectRef, mime: string, filename: string) {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'evidence';
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.evidenceBucket,
        Key: ref.key,
        VersionId: ref.version,
        ResponseContentType: mime,
        ResponseCacheControl: 'private, no-store',
        ResponseContentDisposition: `attachment; filename="${safe}"`,
      }),
      { expiresIn: 60 },
    );
  }
  async remove(quarantine: ObjectRef | undefined, clean: ObjectRef[]) {
    for (const ref of clean)
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.evidenceBucket,
          Key: ref.key,
          VersionId: ref.version,
        }),
      );
    if (quarantine)
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.quarantineBucket,
          Key: quarantine.key,
          VersionId: quarantine.version,
        }),
      );
  }
}
