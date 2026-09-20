import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  eventPageSchema,
  attachmentListSchema,
  type Attachment,
  issueSchema,
  issuePageSchema,
  resolutionPageSchema,
  issueCommandSchema,
  type Issue,
  type Membership,
  type PublicConfiguration,
  type IssueEvent,
  type Resolution,
  type QueueQuery,
} from '@campusfix/contracts';
import { useApi, RequestError } from './api';
const labels: Record<string, string> = {
  acknowledge: 'Acknowledge report',
  start: 'Start work',
  progress: 'Add progress update',
  wait: 'Record a dependency',
  resume: 'Resume work',
  'propose-resolution': 'Propose a resolution',
  confirm: 'Confirm the issue is resolved',
  reopen: 'Reopen this issue',
};
const states: Record<string, string[]> = {
  SUBMITTED: ['acknowledge', 'progress'],
  ACKNOWLEDGED: ['start', 'progress', 'wait'],
  IN_PROGRESS: ['progress', 'wait', 'propose-resolution'],
  WAITING: ['progress', 'resume', 'propose-resolution'],
  REOPENED: ['start', 'progress', 'wait', 'propose-resolution'],
};
function displayError(e: unknown) {
  return e instanceof Error ? e.message : 'The request failed. Please retry.';
}
function when(value: string) {
  return new Date(value).toLocaleString();
}
export function WorkflowPanel({
  issue,
  apiPrefix,
  membership,
  onChange,
}: {
  issue: Issue;
  apiPrefix: string;
  membership: Membership;
  onChange: (issue: Issue) => void;
}) {
  const api = useApi();
  const actions = [
    ...(issue.capabilities.includes('MANAGE_ISSUE')
      ? (states[issue.detail.status] ?? []).filter(
          (a) => a === 'progress' || membership.user.id === issue.detail.primaryOwner.id,
        )
      : []),
    ...(issue.capabilities.includes('CONFIRM') ? ['confirm'] : []),
    ...(issue.capabilities.includes('REOPEN') ? ['reopen'] : []),
  ];
  const [action, setAction] = useState(actions[0] ?? ''),
    [nextAction, setNextAction] = useState(''),
    [nextAt, setNextAt] = useState(''),
    [update, setUpdate] = useState(''),
    [reason, setReason] = useState(''),
    [symptom, setSymptom] = useState(''),
    [cause, setCause] = useState(''),
    [work, setWork] = useState(''),
    [outcome, setOutcome] = useState(''),
    [omission, setOmission] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [evidence, setEvidence] = useState<Attachment[]>([]),
    [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    api(`${apiPrefix}/posts/${issue.id}/attachments`, attachmentListSchema, {
      signal: controller.signal,
    })
      .then((p) => {
        setEvidence(p.items.filter((f) => f.state === 'CLEAN' && f.scope !== 'HANDLERS'));
        setEvidenceIds((ids) =>
          ids.filter((id) =>
            p.items.some((f) => f.id === id && f.state === 'CLEAN' && f.scope !== 'HANDLERS'),
          ),
        );
      })
      .catch(() => setEvidence([]));
    return () => controller.abort();
  }, [issue.id, issue.version, apiPrefix]);
  const request = useRef<{ body: string; key: string } | undefined>(undefined);
  const actionSignature = actions.join('|');
  useEffect(() => {
    if (!actions.includes(action)) setAction(actions[0] ?? '');
    setConfirmed(false);
  }, [actionSignature, issue.version]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!confirmed) {
      setError('Confirm that you have reviewed this action and the report audience.');
      return;
    }
    setBusy(true);
    try {
      const value: Record<string, unknown> = { expectedVersion: issue.version, action };
      if (['acknowledge', 'start', 'progress', 'resume'].includes(action))
        value.nextAction = nextAction;
      if (['acknowledge', 'start', 'progress', 'wait', 'resume'].includes(action))
        value.nextUpdateAt = new Date(nextAt).toISOString();
      if (action === 'progress') value.update = update;
      if (action === 'wait' || action === 'reopen') value.reason = reason;
      if (action === 'propose-resolution')
        value.resolution = {
          symptom,
          ...(cause ? { cause } : {}),
          action: work,
          outcome,
          evidenceIds,
          ...(omission ? { evidenceOmissionReason: omission } : {}),
        };
      if (action === 'confirm') value.resolutionId = issue.detail.currentResolution?.id;
      const parsed = issueCommandSchema.safeParse(value);
      if (!parsed.success)
        throw new Error('Complete the required fields and choose a valid next-update time.');
      const body = JSON.stringify(parsed.data);
      if (request.current?.body !== body) request.current = { body, key: crypto.randomUUID() };
      const saved = await api(`${apiPrefix}/issues/${issue.id}/commands`, issueSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': request.current.key },
        body,
      });
      onChange(saved);
      setConfirmed(false);
      setNotice('Action recorded in the issue history.');
    } catch (e) {
      setError(displayError(e));
      if (e instanceof RequestError && e.status === 409) {
        try {
          onChange(await api(`${apiPrefix}/posts/${issue.id}`, issueSchema));
          setNotice(
            'The latest issue is shown. Your text is retained; review the current state before submitting again.',
          );
        } catch (latest) {
          setError(displayError(latest));
        }
      }
    } finally {
      setBusy(false);
    }
  }
  const current = issue.detail.currentResolution;
  return (
    <section className="workflow-section" aria-label="Issue workflow">
      {issue.detail.nextAction && (
        <div className="notice">
          <strong>Next action</strong>
          <p className="post-body">{issue.detail.nextAction}</p>
          {issue.detail.nextUpdateAt && <p>Next update: {when(issue.detail.nextUpdateAt)}</p>}
          {issue.detail.waitingReason && <p>Waiting on: {issue.detail.waitingReason}</p>}
        </div>
      )}
      {current && (
        <article className="card resolution">
          <p className="eyebrow">
            {current.state === 'CONFIRMED'
              ? 'Reporter confirmed'
              : current.state === 'INVALIDATED'
                ? 'Previous attempt invalidated'
                : 'Awaiting reporter confirmation'}
          </p>
          <h2>Resolution proposal</h2>
          <ResolutionContent value={current} />
          {current.state === 'PROPOSED' && (
            <p className="hint">
              A proposal remains open until the reporter explicitly confirms. Silence does not close
              it.
            </p>
          )}
        </article>
      )}
      {actions.length > 0 && (
        <form className="card workflow-form" onSubmit={submit}>
          <h2>Record the next step.</h2>
          <p>Updates are visible to the people who can read this report.</p>
          <fieldset disabled={busy}>
            <legend className="sr-only">Workflow action</legend>
            <label htmlFor="workflow-action">Action</label>
            <select
              id="workflow-action"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setConfirmed(false);
                setError('');
              }}
            >
              {actions.map((a) => (
                <option key={a} value={a}>
                  {labels[a]}
                </option>
              ))}
            </select>
            {action === 'progress' && (
              <>
                <label htmlFor="progress-update">Progress update</label>
                <textarea
                  id="progress-update"
                  required
                  maxLength={2000}
                  value={update}
                  onChange={(e) => setUpdate(e.target.value)}
                />
              </>
            )}
            {['acknowledge', 'start', 'progress', 'resume'].includes(action) && (
              <>
                <label htmlFor="next-action">Next action</label>
                <textarea
                  id="next-action"
                  required
                  maxLength={1000}
                  value={nextAction}
                  onChange={(e) => setNextAction(e.target.value)}
                />
              </>
            )}
            {['wait', 'reopen'].includes(action) && (
              <>
                <label htmlFor="workflow-reason">
                  {action === 'wait'
                    ? 'Dependency and reason'
                    : 'Why should this issue be reopened?'}
                </label>
                <textarea
                  id="workflow-reason"
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </>
            )}
            {['acknowledge', 'start', 'progress', 'wait', 'resume'].includes(action) && (
              <>
                <label htmlFor="next-update">Next update (your local time)</label>
                <input
                  type="datetime-local"
                  id="next-update"
                  required
                  value={nextAt}
                  onChange={(e) => setNextAt(e.target.value)}
                />
              </>
            )}
            {action === 'propose-resolution' && (
              <>
                <label htmlFor="resolution-symptom">Problem addressed</label>
                <textarea
                  id="resolution-symptom"
                  required
                  maxLength={1000}
                  value={symptom}
                  onChange={(e) => setSymptom(e.target.value)}
                />
                <label htmlFor="resolution-cause">Cause (optional)</label>
                <textarea
                  id="resolution-cause"
                  maxLength={1000}
                  value={cause}
                  onChange={(e) => setCause(e.target.value)}
                />
                <label htmlFor="resolution-work">Work completed</label>
                <textarea
                  id="resolution-work"
                  required
                  maxLength={2000}
                  value={work}
                  onChange={(e) => setWork(e.target.value)}
                />
                <label htmlFor="resolution-outcome">Observed outcome</label>
                <textarea
                  id="resolution-outcome"
                  required
                  maxLength={1000}
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                />
                {evidence.length > 0 && (
                  <fieldset>
                    <legend>Evidence supporting this resolution</legend>
                    {evidence.map((f) => (
                      <label className="check" key={f.id}>
                        <input
                          type="checkbox"
                          checked={evidenceIds.includes(f.id)}
                          onChange={(e) =>
                            setEvidenceIds((ids) =>
                              e.target.checked ? [...ids, f.id] : ids.filter((id) => id !== f.id),
                            )
                          }
                        />
                        {f.originalName}
                      </label>
                    ))}
                  </fieldset>
                )}
                <label htmlFor="evidence-omission">
                  {evidenceIds.length
                    ? 'Evidence note (optional)'
                    : 'Why is evidence unsuitable or unavailable?'}
                </label>
                <textarea
                  id="evidence-omission"
                  required={!evidenceIds.length}
                  maxLength={1000}
                  value={omission}
                  onChange={(e) => setOmission(e.target.value)}
                />
                <p className="hint">
                  Choose ready evidence above, or explain why it is unsuitable. The reporter must be
                  able to review the selected proof.
                </p>
              </>
            )}
            {action === 'confirm' && (
              <p className="notice">
                Confirm only after checking that this resolution addresses your report. You can
                reopen it if the problem returns.
              </p>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I reviewed this action and its audience.
            </label>
            <button type="submit">{busy ? 'Saving…' : (labels[action] ?? 'Save action')}</button>
          </fieldset>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
        </form>
      )}
      {!actions.length && !current && (
        <p className="notice">The responsible owner will record the next action here.</p>
      )}
      <IssueHistory key={issue.id} issue={issue} apiPrefix={apiPrefix} />
    </section>
  );
}
function ResolutionContent({ value: r }: { value: Resolution }) {
  return (
    <>
      <dl className="resolution-fields">
        <dt>Problem</dt>
        <dd className="post-body">{r.symptom}</dd>
        {r.cause && (
          <>
            <dt>Cause</dt>
            <dd className="post-body">{r.cause}</dd>
          </>
        )}
        <dt>Work completed</dt>
        <dd className="post-body">{r.action}</dd>
        <dt>Outcome</dt>
        <dd className="post-body">{r.outcome}</dd>
        {r.evidenceOmissionReason && (
          <>
            <dt>Evidence limitation</dt>
            <dd className="post-body">{r.evidenceOmissionReason}</dd>
          </>
        )}
      </dl>
      <p className="hint">
        Proposed by {r.proposedBy.displayName} on {when(r.proposedAt)}.
        {r.confirmedAt &&
          ` Confirmed by ${r.confirmedBy?.displayName ?? 'reporter'} on ${when(r.confirmedAt)}.`}
      </p>
    </>
  );
}
function IssueHistory({ issue, apiPrefix }: { issue: Issue; apiPrefix: string }) {
  const api = useApi();
  const [events, setEvents] = useState<IssueEvent[]>([]),
    [resolutions, setResolutions] = useState<Resolution[]>([]),
    [eventCursor, setEventCursor] = useState<string | null>(null),
    [resolutionCursor, setResolutionCursor] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const gen = ++generation.current;
    setBusy(true);
    setError('');
    setEvents([]);
    setResolutions([]);
    setEventCursor(null);
    setResolutionCursor(null);
    Promise.all([
      api(`${apiPrefix}/posts/${issue.id}/history?limit=15`, eventPageSchema, {
        signal: controller.signal,
      }),
      api(`${apiPrefix}/issues/${issue.id}/resolutions?limit=10`, resolutionPageSchema, {
        signal: controller.signal,
      }),
    ])
      .then(([h, r]) => {
        if (gen !== generation.current) return;
        setEvents(h.items);
        setEventCursor(h.nextCursor);
        setResolutions(r.items);
        setResolutionCursor(r.nextCursor);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(displayError(e));
      })
      .finally(() => {
        if (gen === generation.current) setBusy(false);
      });
    return () => {
      generation.current++;
      controller.abort();
    };
  }, [apiPrefix, issue.id, issue.version, refresh]);
  async function more(kind: 'history' | 'resolutions') {
    const cursor = kind === 'history' ? eventCursor : resolutionCursor;
    if (!cursor || busy) return;
    const gen = generation.current;
    setBusy(true);
    setError('');
    try {
      if (kind === 'history') {
        const p = await api(
          `${apiPrefix}/posts/${issue.id}/history?limit=15&cursor=${encodeURIComponent(cursor)}`,
          eventPageSchema,
        );
        if (gen === generation.current) {
          setEvents((old) => [...old, ...p.items.filter((i) => !old.some((o) => o.id === i.id))]);
          setEventCursor(p.nextCursor);
        }
      } else {
        const p = await api(
          `${apiPrefix}/issues/${issue.id}/resolutions?limit=10&cursor=${encodeURIComponent(cursor)}`,
          resolutionPageSchema,
        );
        if (gen === generation.current) {
          setResolutions((old) => [
            ...old,
            ...p.items.filter((i) => !old.some((o) => o.id === i.id)),
          ]);
          setResolutionCursor(p.nextCursor);
        }
      }
    } catch (e) {
      if (gen === generation.current) setError(displayError(e));
    } finally {
      if (gen === generation.current) setBusy(false);
    }
  }
  return (
    <>
      <section className="card history" aria-label="Issue history">
        <div className="section-heading">
          <h2>Issue history</h2>
          <button className="secondary" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
            Refresh history
          </button>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {busy && <p role="status">Loading current history…</p>}
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.id}>
              <strong>{e.summary}</strong>
              <p className="hint">
                {e.actor?.displayName ?? 'CampusFix'} ·{' '}
                <time dateTime={e.createdAt}>{when(e.createdAt)}</time>
              </p>
              {e.reason && <p className="post-body">{e.reason}</p>}
              {e.changes
                ?.filter(
                  (c) =>
                    ['nextAction', 'progress', 'nextUpdateAt'].includes(c.field) &&
                    c.after !== null,
                )
                .map((c) => (
                  <p className="post-body" key={c.field}>
                    <strong>
                      {c.field === 'nextAction'
                        ? 'Next action'
                        : c.field === 'nextUpdateAt'
                          ? 'Next update'
                          : 'Progress'}
                      :
                    </strong>{' '}
                    {c.field === 'nextUpdateAt' ? when(String(c.after)) : String(c.after)}
                  </p>
                ))}
            </li>
          ))}
        </ol>
        {eventCursor && (
          <button disabled={busy} className="secondary" onClick={() => void more('history')}>
            Load earlier history
          </button>
        )}
      </section>
      {resolutions.filter((r) => r.id !== issue.detail.currentResolution?.id).length > 0 && (
        <section className="card">
          <h2>Earlier resolution attempts</h2>
          {resolutions
            .filter((r) => r.id !== issue.detail.currentResolution?.id)
            .map((r) => (
              <details key={r.id}>
                <summary>
                  {r.state.toLowerCase()} attempt · {when(r.proposedAt)}
                </summary>
                <ResolutionContent value={r} />
              </details>
            ))}
        </section>
      )}
      {resolutionCursor && (
        <button disabled={busy} className="secondary" onClick={() => void more('resolutions')}>
          Load more resolution attempts
        </button>
      )}
    </>
  );
}
export function StaffQueue({
  apiPrefix,
  configuration,
  membership,
  open,
}: {
  apiPrefix: string;
  configuration: PublicConfiguration;
  membership: Membership;
  open: (id: string) => void;
}) {
  const api = useApi();
  const units = configuration.units.filter((u) =>
    membership.roles.some(
      (r) =>
        Date.parse(r.expiresAt) > Date.now() &&
        ['UNIT_LEAD', 'HANDLER', 'SENSITIVE_HANDLER'].includes(r.role) &&
        (r.scope === 'CAMPUS' || r.scopeId === u.id),
    ),
  );
  const [unitId, setUnit] = useState(units[0]?.id ?? ''),
    [tab, setTab] = useState<QueueQuery['tab']>('MINE'),
    [items, setItems] = useState<Issue[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const params = new URLSearchParams({ unitId, tab, limit: '20' }).toString();
  useEffect(() => {
    const controller = new AbortController();
    const gen = ++generation.current;
    setItems([]);
    setCursor(null);
    setError('');
    if (!unitId) return;
    setBusy(true);
    api(`${apiPrefix}/staff/queue?${params}`, issuePageSchema, { signal: controller.signal })
      .then((p) => {
        if (gen === generation.current) {
          setItems(p.items);
          setCursor(p.nextCursor);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(displayError(e));
      })
      .finally(() => {
        if (gen === generation.current) setBusy(false);
      });
    return () => {
      generation.current++;
      controller.abort();
    };
  }, [apiPrefix, params, refresh]);
  async function more() {
    if (!cursor || busy) return;
    const gen = generation.current;
    setBusy(true);
    try {
      const p = await api(
        `${apiPrefix}/staff/queue?${params}&cursor=${encodeURIComponent(cursor)}`,
        issuePageSchema,
      );
      if (gen === generation.current) {
        setItems((old) => [...old, ...p.items.filter((i) => !old.some((o) => o.id === i.id))]);
        setCursor(p.nextCursor);
      }
    } catch (e) {
      if (gen === generation.current) setError(displayError(e));
    } finally {
      if (gen === generation.current) setBusy(false);
    }
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Staff workspace</p>
          <h1>Your response queue.</h1>
          <p>
            Only currently authorized reports appear. A resolution proposal stays open until the
            reporter confirms it.
          </p>
        </div>
        <button disabled={busy} className="secondary" onClick={() => setRefresh((v) => v + 1)}>
          Refresh queue
        </button>
      </div>
      <div className="filters">
        <div>
          <label htmlFor="queue-unit">Responsible unit</label>
          <select id="queue-unit" value={unitId} onChange={(e) => setUnit(e.target.value)}>
            {units.map((u) => (
              <option value={u.id} key={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="queue-tab">Queue view</label>
          <select
            id="queue-tab"
            value={tab}
            onChange={(e) => setTab(e.target.value as QueueQuery['tab'])}
          >
            <option value="MINE">Assigned to me</option>
            <option value="UNIT">Permitted unit reports</option>
            <option value="OVERDUE">Overdue response</option>
            <option value="AWAITING_CONFIRMATION">Awaiting reporter confirmation</option>
          </select>
        </div>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!unitId && (
        <p className="notice">No active staff unit is assigned to your current membership.</p>
      )}
      {busy && <p role="status">Checking your current queue…</p>}
      {!busy && !error && !items.length && (
        <p className="empty">No visible reports match this queue.</p>
      )}
      <div className="issue-list">
        {items.map((i) => (
          <article className="issue-card" key={i.id}>
            <span className="status-label">
              {i.detail.status.replaceAll('_', ' ').toLowerCase()}
            </span>
            <h2>
              <button className="issue-link" onClick={() => open(i.id)}>
                {i.title}
              </button>
            </h2>
            <p>Owner: {i.detail.primaryOwner.displayName}</p>
            {i.detail.nextAction && <p>{i.detail.nextAction}</p>}
            <p className="hint">
              Next update: {when(i.detail.nextUpdateAt ?? i.detail.updateDueAt ?? i.createdAt)}
            </p>
          </article>
        ))}
      </div>
      {cursor && (
        <button className="secondary load-more" disabled={busy} onClick={() => void more()}>
          Load more queue items
        </button>
      )}
    </>
  );
}
