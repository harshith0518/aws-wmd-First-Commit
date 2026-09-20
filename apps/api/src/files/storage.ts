export type ObjectRef = { key: string; version: string };
export type ObjectReceipt = ObjectRef & {
  bytes: number;
  mime: string;
  sha256: string;
  modifiedAt: string;
};
export interface EvidenceStorage {
  readonly kind: 'aws' | 'test';
  reserve(
    key: string,
    mime: string,
    bytes: number,
    sha256: string,
    expiresIn: number,
  ): Promise<{ url: string; fields: Record<string, string> }>;
  head(key: string, version?: string): Promise<ObjectReceipt>;
  read(ref: ObjectRef): Promise<Uint8Array>;
  write(key: string, bytes: Uint8Array, mime: string): Promise<ObjectRef>;
  download(ref: ObjectRef, mime: string, filename: string): Promise<string>;
  remove(quarantine: ObjectRef | undefined, clean: ObjectRef[]): Promise<void>;
}
