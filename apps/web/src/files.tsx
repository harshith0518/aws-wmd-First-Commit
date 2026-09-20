import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  attachmentListSchema,
  attachmentSchema,
  uploadReservationSchema,
  downloadLinkSchema,
  type Attachment,
  type FileVariant,
} from '@campusfix/contracts';
import { useApi, RequestError } from './api';
const removed = z.object({ id: z.string(), version: z.number(), removed: z.literal(true) });
const labels: Record<Attachment['state'], string> = {
  RESERVED: 'Waiting for upload',
  UPLOADED: 'Upload received',
  SCANNING: 'Checking file',
  CLEAN: 'Ready',
  REJECTED: 'Rejected',
  DELETED: 'Removed',
};
const reasons: Record<string, string> = {
  INVALID_TYPE: 'The contents are not a supported, passive JPEG, PNG or PDF.',
  OVERSIZE: 'The file or decoded image exceeds the supported size.',
  MALWARE: 'The malware scanner rejected this file.',
  SCAN_ERROR: 'A safe scan could not be completed. Remove the file and try again later.',
  EXPIRED: 'This upload reservation expired.',
};
export function FilePanel({
  apiPrefix,
  postId,
  canUpload = false,
  isHandler = false,
  disabled = false,
  onChange,
  onBusyChange,
}: {
  apiPrefix: string;
  postId: string;
  canUpload?: boolean;
  isHandler?: boolean;
  disabled?: boolean;
  onChange?: (files: Attachment[]) => Promise<void> | void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const api = useApi(),
    callbacks = useRef({ onChange, onBusyChange });
  callbacks.current = { onChange, onBusyChange };
  const [items, setItems] = useState<Attachment[]>([]),
    [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [scope, setScope] = useState('PUBLIC');
  const active = useRef(true),
    generation = useRef(0);
  const parent = `parentKind=POST&parentId=${encodeURIComponent(postId)}`;
  async function refresh(signal?: AbortSignal) {
    const current = generation.current;
    try {
      const result = await api(
        `${apiPrefix}/posts/${postId}/attachments`,
        attachmentListSchema,
        signal ? { signal } : {},
      );
      if (!active.current || current !== generation.current) return;
      setItems(result.items);
      setEnabled(result.uploadsEnabled);
      setLoaded(true);
      await callbacks.current.onChange?.(result.items);
      return result.items;
    } catch (e) {
      if (signal?.aborted) return;
      if (active.current && current === generation.current) {
        if (e instanceof RequestError && [401, 403, 404].includes(e.status)) {
          setItems([]);
          setEnabled(false);
        }
        setError(e instanceof Error ? e.message : 'Could not check file status.');
      }
      throw e;
    }
  }
  useEffect(() => {
    active.current = true;
    generation.current++;
    const controller = new AbortController();
    void refresh(controller.signal).catch(() => {});
    const focus = () => void refresh().catch(() => {});
    window.addEventListener('focus', focus);
    return () => {
      active.current = false;
      generation.current++;
      controller.abort();
      window.removeEventListener('focus', focus);
    };
  }, [apiPrefix, postId]);
  const pending = items.some((f) => ['RESERVED', 'UPLOADED', 'SCANNING'].includes(f.state));
  useEffect(() => {
    if (!pending) return;
    let runs = 0;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && runs++ < 90) void refresh().catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [pending, apiPrefix, postId]);
  function working(value: boolean) {
    setBusy(value);
    callbacks.current.onBusyChange?.(value);
  }
  async function mutate(task: () => Promise<void>) {
    working(true);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (e) {
      setNotice('');
      setError(
        e instanceof Error
          ? e.message
          : 'File operation failed. Refresh the state before retrying.',
      );
    } finally {
      await refresh().catch(() => {});
      if (active.current) working(false);
    }
  }
  async function upload(file: File) {
    await mutate(async () => {
      if (
        !['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) ||
        file.size < 1 ||
        file.size > 5242880
      )
        throw new Error('Choose a JPEG, PNG or passive PDF up to 5 MB.');
      setNotice('Preparing upload…');
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const checksum = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      const reservation = await api(`${apiPrefix}/attachments/reserve`, uploadReservationSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          parentKind: 'POST',
          parentId: postId,
          scope,
          originalName: file.name,
          mime: file.type,
          bytes: file.size,
          sha256: checksum,
        }),
      });
      const form = new FormData();
      for (const [k, v] of Object.entries(reservation.fields)) form.append(k, v);
      form.append('file', file);
      setNotice('Uploading evidence…');
      const response = await fetch(reservation.uploadUrl, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(60000),
        credentials: 'omit',
      });
      if (!response.ok)
        throw new Error(
          'Upload did not finish. Refresh its state, then remove an unused reservation before retrying.',
        );
      await api(
        `${apiPrefix}/attachments/${reservation.attachment.id}/complete?${parent}`,
        attachmentSchema,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            expectedVersion: reservation.attachment.version,
            sha256: checksum,
          }),
        },
      );
      setNotice('Upload received. Evidence stays private until its safety checks pass.');
    });
  }
  async function remove(file: Attachment) {
    await mutate(async () => {
      await api(`${apiPrefix}/attachments/${file.id}/remove?${parent}`, removed, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          expectedVersion: file.version,
          reason: 'Removed by the member from the evidence panel.',
        }),
      });
      setNotice('File removed. New download requests are blocked.');
    });
  }
  async function download(file: Attachment, variant: FileVariant) {
    await mutate(async () => {
      const link = await api(
        `${apiPrefix}/attachments/${file.id}/download?${parent}&variant=${variant}`,
        downloadLinkSchema,
      );
      const a = document.createElement('a');
      a.href = link.url;
      a.rel = 'noopener noreferrer';
      a.download = '';
      document.body.append(a);
      a.click();
      a.remove();
    });
  }
  return (
    <section className="evidence-panel" aria-label="Evidence files">
      <div className="section-heading">
        <h2>Evidence</h2>
        <button
          type="button"
          className="text-button"
          disabled={busy || disabled}
          onClick={() => void refresh().catch(() => {})}
        >
          Refresh files
        </button>
      </div>
      <p className="hint">
        Up to three files, 5 MB each. JPEG, PNG and passive PDF. Images shown to students have
        location and camera metadata removed.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!loaded && <p role="status">Checking evidence access…</p>}
      {items.length > 0 && (
        <ul className="evidence-list">
          {items.map((f) => (
            <li key={f.id}>
              <div>
                <strong>{f.originalName}</strong>
                <span className="status-label">{labels[f.state]}</span>
                <p className="hint">
                  {f.bytes < 1024 ? `${f.bytes} B` : `${(f.bytes / 1024).toFixed(0)} KB`} ·{' '}
                  {f.scope === 'PUBLIC'
                    ? 'Report audience'
                    : f.scope === 'HANDLERS'
                      ? 'Assigned handlers only'
                      : 'Reporter and assigned handlers'}
                </p>
                {f.rejectionCode && <p>{reasons[f.rejectionCode]}</p>}
              </div>
              <div className="actions">
                {f.state === 'CLEAN' && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || disabled}
                    onClick={() => void download(f, 'SANITIZED')}
                  >
                    Download safe copy
                  </button>
                )}
                {f.state === 'CLEAN' && isHandler && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy || disabled}
                    onClick={() => void download(f, 'ORIGINAL')}
                  >
                    Original (logged)
                  </button>
                )}
                {canUpload && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy || disabled}
                    onClick={() => void remove(f)}
                  >
                    Remove {f.originalName}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {loaded && !items.length && <p>No evidence shared here yet.</p>}
      {canUpload && enabled && (
        <div className="evidence-upload">
          <label htmlFor={`evidence-scope-${postId}`}>File audience</label>
          <select
            id={`evidence-scope-${postId}`}
            value={scope}
            disabled={busy || disabled}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="PUBLIC">Everyone who can read this report</option>
            <option value="REPORTER_HANDLERS">Reporter and assigned handlers</option>
            {isHandler && <option value="HANDLERS">Assigned handlers only</option>}
          </select>
          <label htmlFor={`evidence-input-${postId}`}>Add evidence file</label>
          <input
            id={`evidence-input-${postId}`}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            disabled={busy || disabled || items.length >= 3}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void upload(f);
            }}
          />
          {items.length >= 3 && <p>Remove an unused file to free a slot.</p>}
        </div>
      )}
      {canUpload && loaded && !enabled && (
        <p className="notice">
          Uploads are unavailable until secure storage and scanning are configured. Your report can
          still be submitted without evidence.
        </p>
      )}
    </section>
  );
}
