import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  issueSchema,
  accessEndedSchema,
  ownerCandidatesSchema,
  type Issue,
  type Membership,
  type PublicConfiguration,
} from '@campusfix/contracts';
import { useApi, RequestError } from './api';
const resultSchema = z.union([issueSchema, accessEndedSchema]);
const message = (e: unknown) => (e instanceof Error ? e.message : 'Unable to save. Please retry.');
export function OwnershipPanel({
  issue,
  apiPrefix,
  membership,
  configuration,
  onChange,
  onAccessEnded,
}: {
  issue: Issue;
  apiPrefix: string;
  membership: Membership;
  configuration: PublicConfiguration;
  onChange: (issue: Issue) => void;
  onAccessEnded: () => void;
}) {
  const canAssign = issue.capabilities.includes('ASSIGN'),
    canTransfer = issue.capabilities.includes('TRANSFER'),
    canRespond = issue.capabilities.includes('RESPOND_TRANSFER'),
    active = ['SUBMITTED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'WAITING', 'REOPENED'].includes(
      issue.detail.status,
    ),
    pending = issue.detail.pendingTransfer;
  const api = useApi(),
    [mode, setMode] = useState<'transfer' | 'collaborators'>('transfer'),
    [unit, setUnit] = useState(issue.detail.unitId),
    [owner, setOwner] = useState(''),
    [collaborators, setCollaborators] = useState(issue.detail.collaborators.map((p) => p.id)),
    [candidates, setCandidates] = useState<Array<{ id: string; displayName: string }>>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [confirm, setConfirm] = useState(false);
  const request = useRef<{ body: string; key: string } | undefined>(undefined),
    generation = useRef(0),
    destination = mode === 'collaborators' ? issue.detail.unitId : unit,
    prefix = `${apiPrefix}/issues/${issue.id}`;
  async function load(next?: string) {
    const g = generation.current;
    setLoading(true);
    try {
      const p = await api(
        `${prefix}/handler-candidates?unitId=${destination}&limit=25${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
        ownerCandidatesSchema,
      );
      if (g !== generation.current) return;
      setCandidates((old) =>
        next ? [...old, ...p.items.filter((i) => !old.some((o) => o.id === i.id))] : p.items,
      );
      setCursor(p.nextCursor);
    } catch (e) {
      if (g === generation.current) {
        setError(message(e));
        setCandidates([]);
        setCursor(null);
      }
    } finally {
      if (g === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    generation.current++;
    setCandidates([]);
    setCursor(null);
    if (active && (canAssign || canTransfer)) void load();
    return () => {
      generation.current++;
    };
  }, [prefix, destination, active, canAssign, canTransfer]);
  useEffect(() => setConfirm(false), [issue.version]);
  async function save(
    action: 'propose-transfer' | 'accept-transfer' | 'reject-transfer' | 'assign',
  ) {
    setError('');
    setNotice('');
    if (!confirm) {
      setError('Confirm the access and accountability change before saving.');
      return;
    }
    setBusy(true);
    const value = {
        expectedVersion: issue.version,
        ...(action === 'assign'
          ? { collaboratorIds: collaborators, reason }
          : action === 'propose-transfer'
            ? { action, toUnitId: unit, toOwnerId: owner, reason }
            : {
                action,
                transferId: pending?.transferId,
                ...(action === 'reject-transfer' ? { reason } : {}),
              }),
      },
      body = JSON.stringify(value),
      fingerprint = JSON.stringify([action, body]);
    if (request.current?.body !== fingerprint)
      request.current = { body: fingerprint, key: crypto.randomUUID() };
    try {
      const saved = await api(
        `${prefix}/${action === 'assign' ? 'assignment' : 'commands'}`,
        resultSchema,
        {
          method: action === 'assign' ? 'PUT' : 'POST',
          headers: { 'Idempotency-Key': request.current.key },
          body,
        },
      );
      if ('accessEnded' in saved) {
        onAccessEnded();
        return;
      }
      onChange(saved);
      setConfirm(false);
      setReason('');
      setNotice(
        action === 'propose-transfer'
          ? 'Handover proposed. The current owner remains accountable until acceptance.'
          : action === 'accept-transfer'
            ? 'You have accepted accountability for this report.'
            : action === 'reject-transfer'
              ? 'Handover declined. The current owner remains accountable.'
              : 'Collaborators updated.',
      );
    } catch (e) {
      setError(message(e));
      if (e instanceof RequestError) {
        if ([401, 403, 404].includes(e.status)) {
          onAccessEnded();
          return;
        }
        if (e.status === 409)
          try {
            onChange(await api(`${apiPrefix}/posts/${issue.id}`, issueSchema));
          } catch {
            onAccessEnded();
          }
      }
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void save(mode === 'collaborators' ? 'assign' : 'propose-transfer');
  }
  const choices = new Map(candidates.map((p) => [p.id, p]));
  for (const p of issue.detail.collaborators) if (mode === 'collaborators') choices.set(p.id, p);
  return (
    <section className="ownership-panel" aria-label="Ownership and collaboration">
      <h2>Ownership and collaboration</h2>
      <p>
        <strong>{issue.detail.primaryOwner.displayName}</strong> is accountable.{' '}
        {issue.detail.collaborators.length
          ? `Collaborators: ${issue.detail.collaborators.map((p) => p.displayName).join(', ')}.`
          : 'No additional collaborators.'}
      </p>
      {pending && (
        <div className="notice">
          <h3>Handover awaiting acceptance</h3>
          <p>
            Proposed for{' '}
            {configuration.units.find((u) => u.id === pending.toUnitId)?.name ??
              'the destination unit'}{' '}
            · Expires {new Date(pending.expiresAt).toLocaleString()}
          </p>
          <p className="post-body">{pending.reason}</p>
          <p>
            The current owner remains accountable. The proposed owner has temporary report access
            until this deadline.
          </p>
          {canRespond && active && (
            <fieldset disabled={busy}>
              <legend>Respond to handover</legend>
              <p>
                Accepting makes you the accountable owner. Rejecting removes the temporary access
                granted by this handover.
              </p>
              <label htmlFor="transfer-rejection">Reason if declining</label>
              <textarea
                id="transfer-rejection"
                value={reason}
                maxLength={1000}
                onChange={(e) => setReason(e.target.value)}
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                />
                I reviewed the accountability and access change.
              </label>
              <div className="actions">
                <button type="button" onClick={() => void save('accept-transfer')}>
                  Accept handover
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!reason.trim()}
                  onClick={() => void save('reject-transfer')}
                >
                  Decline handover
                </button>
              </div>
            </fieldset>
          )}
        </div>
      )}
      {active && (canAssign || canTransfer) && (
        <details>
          <summary>Manage assigned people</summary>
          <div className="actions" role="group" aria-label="Assignment action">
            {canTransfer && (
              <button
                type="button"
                className="secondary"
                aria-pressed={mode === 'transfer'}
                onClick={() => setMode('transfer')}
              >
                Transfer ownership
              </button>
            )}
            {canAssign && (
              <button
                type="button"
                className="secondary"
                aria-pressed={mode === 'collaborators'}
                onClick={() => setMode('collaborators')}
              >
                Set collaborators
              </button>
            )}
          </div>
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              <legend>
                {mode === 'transfer'
                  ? 'Propose an ownership handover'
                  : 'Assign supporting handlers'}
              </legend>
              {mode === 'transfer' ? (
                pending ? (
                  <p>
                    A handover is already pending. The recipient must respond or the 48-hour window
                    must expire.
                  </p>
                ) : (
                  <>
                    <label htmlFor="transfer-unit">Destination unit</label>
                    <select
                      id="transfer-unit"
                      value={unit}
                      onChange={(e) => {
                        setUnit(e.target.value);
                        setOwner('');
                      }}
                    >
                      {configuration.units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                    <label htmlFor="transfer-owner">Proposed owner</label>
                    <select
                      id="transfer-owner"
                      value={owner}
                      required
                      onChange={(e) => setOwner(e.target.value)}
                    >
                      <option value="">Choose an eligible handler</option>
                      {candidates
                        .filter((p) => p.id !== issue.detail.primaryOwner.id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.displayName}
                          </option>
                        ))}
                    </select>
                    <p className="hint">
                      The proposed owner gets temporary access to assess the report. Only their
                      acceptance changes ownership. A move to another unit clears the current
                      collaborator list.
                    </p>
                  </>
                )
              ) : (
                <>
                  <p>
                    Choose up to eight eligible handlers in the current unit. The primary owner
                    remains accountable.
                  </p>
                  {[...choices.values()]
                    .filter((p) => p.id !== issue.detail.primaryOwner.id)
                    .map((p) => (
                      <label key={p.id} className="check">
                        <input
                          type="checkbox"
                          checked={collaborators.includes(p.id)}
                          disabled={!collaborators.includes(p.id) && collaborators.length >= 8}
                          onChange={(e) =>
                            setCollaborators((ids) =>
                              e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id),
                            )
                          }
                        />
                        {p.displayName}
                      </label>
                    ))}
                </>
              )}
              {loading && <p role="status">Loading eligible handlers…</p>}
              {cursor && (
                <button
                  className="secondary"
                  type="button"
                  disabled={loading}
                  onClick={() => void load(cursor)}
                >
                  Load more handlers
                </button>
              )}
              {!loading && !candidates.length && !cursor && (
                <p>No eligible handlers found in this unit.</p>
              )}
              {!(mode === 'transfer' && pending) && (
                <>
                  <label htmlFor="ownership-reason">Reason for this change</label>
                  <textarea
                    id="ownership-reason"
                    required
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={confirm}
                      onChange={(e) => setConfirm(e.target.checked)}
                    />
                    I reviewed the accountability and access change.
                  </label>
                  <button
                    type="submit"
                    disabled={mode === 'transfer' ? !canTransfer || !owner : !canAssign}
                  >
                    {busy
                      ? 'Saving…'
                      : mode === 'transfer'
                        ? 'Propose handover'
                        : 'Save collaborators'}
                  </button>
                </>
              )}
            </fieldset>
          </form>
        </details>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
