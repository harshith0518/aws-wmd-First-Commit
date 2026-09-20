import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ownerCandidatesSchema,
  reviewSchema,
  reviewPageSchema,
  reviewResponseSchema,
  reviewResponsePageSchema,
  reviewEventPageSchema,
  issueSchema,
  type ServiceReview,
  type ReviewEvent,
  type ReviewResponse,
  type Issue,
  type Membership,
} from '@campusfix/contracts';
import { useApi, RequestError } from './api';
const reasonNames = {
  NO_RESPONSE: 'No response',
  INCOMPLETE_FIX: 'Incomplete fix',
  INAPPROPRIATE_CONDUCT: 'Inappropriate conduct',
  RETALIATION: 'Retaliation',
};
const stateNames = {
  OPEN: 'Submitted',
  IN_REVIEW: 'Under review',
  ACTION_REQUIRED: 'Correction required',
  CLOSED: 'Review completed',
  ESCALATED: 'Awaiting independent reviewer',
};
const outcomes = {
  COMPLAINT_UPHELD: 'Concern upheld — correction required',
  RESPONSE_UPHELD: 'Original response upheld',
  INSUFFICIENT_EVIDENCE: 'Insufficient evidence for a conclusion',
};
const message = (e: unknown) =>
  e instanceof Error ? e.message : 'Unable to complete the request. Please retry.';
export function ReviewWorkspace({
  apiPrefix,
  tail,
  membership,
  navigate,
  routePrefix,
}: {
  apiPrefix: string;
  tail: string;
  membership: Membership;
  navigate: (path: string) => void;
  routePrefix: string;
}) {
  const open = (id: string) => navigate(`${routePrefix}/service-reviews/${id}`),
    id = tail.split('?')[0]?.split('/')[2];
  if (id === 'new')
    return (
      <ReviewIntake
        apiPrefix={apiPrefix}
        issueId={new URLSearchParams(tail.split('?')[1] ?? '').get('issue') ?? ''}
        onCreated={open}
      />
    );
  if (id) return <ReviewDetail key={id} apiPrefix={apiPrefix} id={id} membership={membership} />;
  return <ReviewList apiPrefix={apiPrefix} open={open} />;
}
function ReviewList({ apiPrefix, open }: { apiPrefix: string; open: (id: string) => void }) {
  const api = useApi(),
    [items, setItems] = useState<ServiceReview[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function load(next?: string) {
    setBusy(true);
    setError('');
    try {
      const p = await api(
        `${apiPrefix}/service-reviews?limit=20${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
        reviewPageSchema,
      );
      setItems((old) =>
        next ? [...old, ...p.items.filter((i) => !old.some((o) => o.id === i.id))] : p.items,
      );
      setCursor(p.nextCursor);
    } catch (e) {
      setError(message(e));
      if (e instanceof RequestError && [401, 403, 404].includes(e.status)) {
        setItems([]);
        setCursor(null);
      }
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, [apiPrefix]);
  return (
    <>
      <h1>Your service reviews.</h1>
      <p className="intro-small">
        Private concerns you submitted or were independently assigned to review.
      </p>
      <button className="secondary" disabled={busy} onClick={() => void load()}>
        Refresh reviews
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="card-grid">
        {items.map((r) => (
          <article className="card" key={r.id}>
            <p className="badge">{stateNames[r.state]}</p>
            <h2>
              <button className="text-button" onClick={() => open(r.id)}>
                {reasonNames[r.reasonCode]}
              </button>
            </h2>
            <p className="post-body">{r.description.slice(0, 180)}</p>
            <p>
              {r.reviewer
                ? `Reviewer: ${r.reviewer.displayName}`
                : 'No eligible independent reviewer assigned.'}
            </p>
            <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString()}</time>
          </article>
        ))}
      </div>
      {busy && <p role="status">Loading private reviews…</p>}
      {!busy && !items.length && !error && (
        <p>To raise a concern, open the report and choose Request an independent review.</p>
      )}
      {cursor && (
        <button disabled={busy} className="secondary" onClick={() => void load(cursor)}>
          Load more reviews
        </button>
      )}
    </>
  );
}
function ReviewIntake({
  apiPrefix,
  issueId,
  onCreated,
}: {
  apiPrefix: string;
  issueId: string;
  onCreated: (id: string) => void;
}) {
  const api = useApi(),
    [source, setSource] = useState<Issue>(),
    [reason, setReason] = useState<keyof typeof reasonNames>('NO_RESPONSE'),
    [description, setDescription] = useState(''),
    [outcome, setOutcome] = useState(''),
    [subject, setSubject] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const req = useRef<{ body: string; key: string } | undefined>(undefined);
  useEffect(() => {
    const c = new AbortController();
    if (issueId)
      api(`${apiPrefix}/posts/${issueId}`, issueSchema, { signal: c.signal })
        .then(setSource)
        .catch((e) => {
          if (!c.signal.aborted) setError(message(e));
        });
    else setError('Open the original report to request a review.');
    return () => c.abort();
  }, [issueId, apiPrefix]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!confirmed || !source) return;
    setBusy(true);
    setError('');
    const body = JSON.stringify({
      issueId,
      reasonCode: reason,
      description,
      ...(outcome ? { desiredOutcome: outcome } : {}),
      ...(subject ? { subjectId: subject } : {}),
    });
    if (req.current?.body !== body) req.current = { body, key: crypto.randomUUID() };
    try {
      const saved = await api(`${apiPrefix}/service-reviews`, reviewSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': req.current.key },
        body,
      });
      onCreated(saved.id);
    } catch (e) {
      setError(message(e));
      if (e instanceof RequestError && [401, 403, 404].includes(e.status)) setSource(undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>Request an independent review.</h1>
      {source && (
        <>
          <p className="intro-small">About: {source.title}</p>
          <div className="notice">
            <strong>Private audience</strong>
            <p>
              Your explanation is shared with you and the assigned independent reviewer. The
              original responder has no automatic access. You do not have to confront the responder
              before raising a concern.
            </p>
          </div>
          <form className="card" onSubmit={submit}>
            <fieldset disabled={busy}>
              <legend>Your concern</legend>
              <label htmlFor="review-reason">Reason</label>
              <select
                id="review-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as keyof typeof reasonNames)}
              >
                {Object.entries(reasonNames).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              <label htmlFor="review-subject">Person involved (optional)</label>
              <select
                id="review-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              >
                <option value="">No individual named</option>
                {[source.detail.primaryOwner, ...source.detail.collaborators].map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
              <label htmlFor="review-description">What needs independent review?</label>
              <textarea
                id="review-description"
                rows={6}
                maxLength={3000}
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <p className="hint">
                {description.length}/3000 characters. Describe the response, what remains unresolved
                and relevant dates.
              </p>
              <label htmlFor="review-outcome">Desired outcome (optional)</label>
              <textarea
                id="review-outcome"
                maxLength={1000}
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I reviewed the private audience and my explanation.
              </label>
              <button type="submit" disabled={!confirmed || !description.trim()}>
                {busy ? 'Submitting…' : 'Submit private review'}
              </button>
            </fieldset>
          </form>
        </>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!source && !error && <p role="status">Checking report access…</p>}
    </>
  );
}
function ReviewDetail({
  apiPrefix,
  id,
  membership,
}: {
  apiPrefix: string;
  id: string;
  membership: Membership;
}) {
  const api = useApi(),
    [review, setReview] = useState<ServiceReview>(),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    api(`${apiPrefix}/service-reviews/${id}`, reviewSchema, { signal: c.signal })
      .then(setReview)
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(message(e));
          setReview(undefined);
        }
      });
    return () => c.abort();
  }, [apiPrefix, id, revision]);
  function unavailable() {
    setReview(undefined);
    setError('This private review is no longer available to your account.');
  }
  if (!review)
    return (
      <>
        <h1>Service review</h1>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <p role="status">Checking private review access…</p>
        )}
        <button className="secondary" onClick={() => setRevision((v) => v + 1)}>
          Check access again
        </button>
      </>
    );
  return (
    <>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Private service review</p>
          <h1>{reasonNames[review.reasonCode]}</h1>
          <p className="badge">{stateNames[review.state]}</p>
        </div>
        <button className="secondary" onClick={() => setRevision((v) => v + 1)}>
          Refresh review
        </button>
      </div>
      <article className="card">
        <p className="post-body">{review.description}</p>
        {review.desiredOutcome && (
          <p>
            <strong>Desired outcome:</strong> {review.desiredOutcome}
          </p>
        )}
        <p>
          Requested by {review.requester.displayName}
          {review.subject ? ` · Named person: ${review.subject.displayName}` : ''}
        </p>
        <p>
          {review.reviewer
            ? `Assigned reviewer: ${review.reviewer.displayName}`
            : 'Awaiting a configured independent reviewer. The original responder is excluded.'}
        </p>
        {review.reviewer && !review.reviewerAvailable && (
          <p className="notice">
            The assigned reviewer is no longer eligible. A new independent reviewer is needed before
            further decisions.
          </p>
        )}
        <dl>
          <dt>Acknowledgement due</dt>
          <dd>{new Date(review.ackDueAt).toLocaleString()}</dd>
          <dt>Decision due</dt>
          <dd>{new Date(review.decisionDueAt).toLocaleString()}</dd>
          {review.nextUpdateAt && (
            <>
              <dt>Next update</dt>
              <dd>{new Date(review.nextUpdateAt).toLocaleString()}</dd>
            </>
          )}
        </dl>
        {review.decisionOutcome && (
          <div className="notice">
            <h2>
              {review.decisionOutcome === 'COMPLAINT_UPHELD' && review.state === 'CLOSED'
                ? 'Concern upheld — remedy verified'
                : outcomes[review.decisionOutcome]}
            </h2>
            <p className="post-body">{review.decisionReason}</p>
            {review.correctiveAction && (
              <>
                <p>
                  <strong>Corrective action:</strong> {review.correctiveAction}
                </p>
                {review.dueAt && <p>Action due {new Date(review.dueAt).toLocaleString()}</p>}
              </>
            )}
            {review.appealDeadline && (
              <p>
                Further-review deadline: {new Date(review.appealDeadline).toLocaleString()}. Use
                your campus's approved grievance contact for further review.
              </p>
            )}
          </div>
        )}
      </article>
      <ReviewDecision
        review={review}
        apiPrefix={apiPrefix}
        onChange={setReview}
        onUnavailable={unavailable}
      />
      <ReviewConversation
        review={review}
        apiPrefix={apiPrefix}
        membership={membership}
        onChange={() => setRevision((v) => v + 1)}
        onUnavailable={unavailable}
      />
    </>
  );
}
function ReviewDecision({
  review: r,
  apiPrefix,
  onChange,
  onUnavailable,
}: {
  review: ServiceReview;
  apiPrefix: string;
  onChange: (r: ServiceReview) => void;
  onUnavailable: () => void;
}) {
  const api = useApi(),
    actions = r.capabilities.filter((a) => a !== 'RESPOND'),
    [action, setAction] = useState('begin'),
    [reason, setReason] = useState(''),
    [outcome, setOutcome] = useState('RESPONSE_UPHELD'),
    [correction, setCorrection] = useState(''),
    [owner, setOwner] = useState(''),
    [date, setDate] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const req = useRef<{ body: string; key: string } | undefined>(undefined);
  const mapping = {
      BEGIN: 'begin',
      DECIDE: 'decide',
      REQUIRE_ACTION: 'require-action',
      CLOSE: 'close',
    } as const,
    available = actions.map((a) => mapping[a as keyof typeof mapping]);
  useEffect(() => {
    if (!(available as string[]).includes(action)) setAction(available[0] ?? '');
    setConfirmed(false);
  }, [r.version, available.join('|')]);
  const [handlers, setHandlers] = useState<Array<{ id: string; displayName: string }>>([]),
    [handlerCursor, setHandlerCursor] = useState<string | null>(null);
  const appealDate = useRef(new Date(Date.now() + 15 * 86400000).toISOString());
  async function loadHandlers(next?: string) {
    try {
      const p = await api(
        `${apiPrefix}/service-reviews/${r.id}/handler-candidates?limit=25${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
        ownerCandidatesSchema,
      );
      setHandlers((old) => (next ? [...old, ...p.items] : p.items));
      setHandlerCursor(p.nextCursor);
    } catch (e) {
      setError(message(e));
      if (e instanceof RequestError && [401, 403, 404].includes(e.status)) onUnavailable();
    }
  }
  useEffect(() => {
    if (action === 'require-action') void loadHandlers();
  }, [action, r.id]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!confirmed) return;
    setBusy(true);
    setError('');
    try {
      const value = {
          expectedVersion: r.version,
          action,
          ...(action === 'begin'
            ? { nextUpdateAt: new Date(date).toISOString() }
            : action === 'require-action'
              ? {
                  decisionOutcome: 'COMPLAINT_UPHELD',
                  decisionReason: reason,
                  correctiveAction: correction,
                  correctiveOwnerId: owner,
                  dueAt: new Date(date).toISOString(),
                }
              : {
                  decisionReason: reason,
                  ...(action === 'decide' ? { decisionOutcome: outcome } : {}),
                  appealDeadline: appealDate.current,
                }),
        },
        body = JSON.stringify(value);
      if (req.current?.body !== body) req.current = { body, key: crypto.randomUUID() };
      const saved = await api(`${apiPrefix}/service-reviews/${r.id}/commands`, reviewSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': req.current.key },
        body,
      });
      onChange(saved);
      setReason('');
      setConfirmed(false);
    } catch (e) {
      setError(message(e));
      if (e instanceof RequestError) {
        if ([401, 403, 404].includes(e.status)) onUnavailable();
        else if (e.status === 409)
          try {
            onChange(await api(`${apiPrefix}/service-reviews/${r.id}`, reviewSchema));
          } catch {
            onUnavailable();
          }
      }
    } finally {
      setBusy(false);
    }
  }
  if (!available.length) return null;
  return (
    <form className="card review-decision" onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend>Independent reviewer action</legend>
        <label htmlFor="review-action">Action</label>
        <select
          id="review-action"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setConfirmed(false);
          }}
        >
          {available.map((a) => (
            <option key={a} value={a}>
              {a === 'begin'
                ? 'Begin review'
                : a === 'decide'
                  ? 'Record decision'
                  : a === 'require-action'
                    ? 'Require a corrective action'
                    : 'Verify remedy and close'}
            </option>
          ))}
        </select>
        {action === 'begin' ? (
          <>
            <label htmlFor="review-next">Next update (your local time)</label>
            <input
              id="review-next"
              type="datetime-local"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </>
        ) : (
          <>
            <label htmlFor="review-decision-reason">
              Reasoned findings{action === 'close' ? ' and how the remedy was verified' : ''}
            </label>
            <textarea
              id="review-decision-reason"
              rows={4}
              required
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {action === 'decide' && (
              <>
                <label htmlFor="review-result">Outcome</label>
                <select
                  id="review-result"
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                >
                  <option value="RESPONSE_UPHELD">Original response upheld</option>
                  <option value="INSUFFICIENT_EVIDENCE">
                    Insufficient evidence for a conclusion
                  </option>
                </select>
              </>
            )}
            {action === 'require-action' && (
              <>
                <label htmlFor="review-correction">Corrective action</label>
                <textarea
                  id="review-correction"
                  required
                  maxLength={2000}
                  value={correction}
                  onChange={(e) => setCorrection(e.target.value)}
                />
                <label htmlFor="corrective-owner">Responsible corrective handler</label>
                <select
                  id="corrective-owner"
                  required
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                >
                  <option value="">Choose an eligible handler</option>
                  {handlers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
                {handlerCursor && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void loadHandlers(handlerCursor)}
                  >
                    Load more corrective handlers
                  </button>
                )}
                <label htmlFor="corrective-due">Correction due (your local time)</label>
                <input
                  id="corrective-due"
                  type="datetime-local"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </>
            )}
          </>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I am independent of the original response and reviewed these findings.
        </label>
        <button type="submit" disabled={!confirmed}>
          {busy ? 'Recording…' : 'Record review action'}
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
function ReviewConversation({
  review: r,
  apiPrefix,
  membership,
  onChange,
  onUnavailable,
}: {
  review: ServiceReview;
  apiPrefix: string;
  membership: Membership;
  onChange: () => void;
  onUnavailable: () => void;
}) {
  const api = useApi(),
    [items, setItems] = useState<ReviewResponse[]>([]),
    [events, setEvents] = useState<ReviewEvent[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [historyCursor, setHistoryCursor] = useState<string | null>(null),
    [body, setBody] = useState(''),
    [privateNote, setPrivateNote] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const req = useRef<{ body: string; key: string } | undefined>(undefined),
    prefix = `${apiPrefix}/service-reviews/${r.id}`;
  async function load(next?: string, history = false) {
    try {
      if (history) {
        const p = await api(
          `${prefix}/history?limit=20${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
          reviewEventPageSchema,
        );
        setEvents((old) => (next ? [...old, ...p.items] : p.items));
        setHistoryCursor(p.nextCursor);
      } else {
        const p = await api(
          `${prefix}/responses?limit=20${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
          reviewResponsePageSchema,
        );
        setItems((old) => (next ? [...old, ...p.items] : p.items));
        setCursor(p.nextCursor);
      }
    } catch (e) {
      setError(message(e));
      if (e instanceof RequestError && [401, 403, 404].includes(e.status)) onUnavailable();
    }
  }
  useEffect(() => {
    void load();
    void load(undefined, true);
  }, [prefix, r.version]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const payload = JSON.stringify({
      body,
      visibility: privateNote ? 'REVIEWERS' : 'COMPLAINANT_REVIEWERS',
    });
    if (req.current?.body !== payload) req.current = { body: payload, key: crypto.randomUUID() };
    try {
      await api(`${prefix}/responses`, reviewResponseSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': req.current.key },
        body: payload,
      });
      setBody('');
      req.current = undefined;
      onChange();
    } catch (e) {
      setError(message(e));
      if (e instanceof RequestError && [401, 403, 404].includes(e.status)) onUnavailable();
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="card" aria-label="Private review conversation">
        <h2>Private responses</h2>
        {items.map((i) => (
          <article className="reply-card" key={i.id}>
            <strong>{i.author.displayName}</strong>
            <p className="hint">
              {i.visibility === 'REVIEWERS' ? 'Reviewer-only note' : 'Complainant and reviewer'} ·{' '}
              {new Date(i.createdAt).toLocaleString()}
            </p>
            <p className="post-body">{i.body}</p>
          </article>
        ))}
        {cursor && (
          <button className="secondary" onClick={() => void load(cursor)}>
            Load more responses
          </button>
        )}
        {r.capabilities.includes('RESPOND') && (
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              <legend>Add a private response</legend>
              <label htmlFor="review-response">Response</label>
              <textarea
                id="review-response"
                required
                maxLength={2000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              {r.reviewer?.id === membership.user.id && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={privateNote}
                    onChange={(e) => setPrivateNote(e.target.checked)}
                  />
                  Reviewer-only note
                </label>
              )}
              <button type="submit" disabled={!body.trim()}>
                {busy ? 'Saving…' : 'Save review response'}
              </button>
            </fieldset>
          </form>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
      <section className="card" aria-label="Private review history">
        <h2>Review history</h2>
        {events.map((e) => (
          <article key={e.id}>
            <strong>{e.summary}</strong>
            <p className="hint">
              {e.actor.displayName} · {new Date(e.createdAt).toLocaleString()}
            </p>
            {e.reason && <p className="post-body">{e.reason}</p>}
          </article>
        ))}
        {historyCursor && (
          <button className="secondary" onClick={() => void load(historyCursor, true)}>
            Load more review history
          </button>
        )}
      </section>
    </>
  );
}
