import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  knowledgeSchema,
  knowledgePageSchema,
  knowledgeCreateSchema,
  issueSchema,
  type Knowledge,
  type Issue,
  type PublicConfiguration,
  type Membership,
} from '@campusfix/contracts';
import { useApi, RequestError } from './api';
const message = (e: unknown) =>
  e instanceof Error ? e.message : 'Unable to load this record. Please retry.';
const date = (v: string) => new Date(v).toLocaleString();
export function KnowledgeWorkspace({
  apiPrefix,
  tail,
  configuration,
  membership,
  navigate,
  routePrefix,
}: {
  apiPrefix: string;
  tail: string;
  configuration: PublicConfiguration;
  membership: Membership;
  navigate: (path: string) => void;
  routePrefix: string;
}) {
  const id = tail.split('?')[0]?.split('/')[2],
    params = new URLSearchParams(tail.split('?')[1] ?? ''),
    open = (id: string) => navigate(`${routePrefix}/library/${id}`),
    source = (id: string) => navigate(`${routePrefix}/issues/${id}`);
  if (id === 'new')
    return (
      <KnowledgeIntake
        key={tail}
        apiPrefix={apiPrefix}
        sourceId={params.get('issue') ?? ''}
        onCreated={open}
      />
    );
  if (id) return <KnowledgeDetail key={id} apiPrefix={apiPrefix} id={id} onSource={source} />;
  return (
    <KnowledgeList
      key={tail}
      apiPrefix={apiPrefix}
      configuration={configuration}
      membership={membership}
      params={params}
      onSearch={(p) => navigate(`${routePrefix}/library?${p}`)}
      open={open}
    />
  );
}
function KnowledgeList({
  apiPrefix,
  configuration,
  membership,
  params,
  onSearch,
  open,
}: {
  apiPrefix: string;
  configuration: PublicConfiguration;
  membership: Membership;
  params: URLSearchParams;
  onSearch: (p: URLSearchParams) => void;
  open: (id: string) => void;
}) {
  const api = useApi(),
    [category, setCategory] = useState(
      params.get('categoryId') ?? configuration.categories[0]?.id ?? '',
    ),
    [unit, setUnit] = useState(params.get('unitId') ?? ''),
    [group, setGroup] = useState(params.get('groupId') ?? ''),
    [query, setQuery] = useState(params.get('query') ?? ''),
    [items, setItems] = useState<Knowledge[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [capped, setCapped] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const generation = useRef(0),
    filters = useRef(
      new URLSearchParams({
        categoryId: category,
        ...(unit ? { unitId: unit } : {}),
        ...(group ? { groupId: group } : {}),
        ...(query ? { query } : {}),
        limit: '20',
      }),
    );
  async function load(next?: string) {
    const g = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const q = new URLSearchParams(filters.current);
      if (next) q.set('cursor', next);
      const p = await api(`${apiPrefix}/knowledge?${q}`, knowledgePageSchema);
      if (g !== generation.current) return;
      setItems((old) =>
        next ? [...old, ...p.items.filter((i) => !old.some((x) => x.id === i.id))] : p.items,
      );
      setCursor(p.nextCursor);
      setCapped(!!p.candidateLimitReached);
    } catch (e) {
      if (g === generation.current) {
        setError(message(e));
        setItems([]);
        setCursor(null);
      }
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (category) void load();
    return () => {
      generation.current++;
    };
  }, [apiPrefix]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(
      new URLSearchParams({
        categoryId: category,
        ...(unit ? { unitId: unit } : {}),
        ...(group ? { groupId: group } : {}),
        ...(query ? { query } : {}),
      }),
    );
  };
  return (
    <>
      <p className="eyebrow">Verified campus history</p>
      <h1>Resolution library.</h1>
      <p className="intro-small">
        Find reviewed fixes from issues you can currently read. These are past outcomes, not
        guarantees for a new problem.
      </p>
      <form className="card" onSubmit={submit}>
        <label htmlFor="library-category">Topic</label>
        <select
          id="library-category"
          required
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {configuration.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label htmlFor="library-unit">Team</label>
        <select id="library-unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option value="">All permitted teams</option>
          {configuration.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <label htmlFor="library-group">Group</label>
        <select id="library-group" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">All permitted audiences</option>
          {configuration.groups
            .filter((g) => membership.groupIds.includes(g.id))
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
        </select>
        <label htmlFor="library-query">Symptoms or keywords</label>
        <input
          id="library-query"
          maxLength={200}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button disabled={busy || !category}>Search reviewed fixes</button>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            onSearch(new URLSearchParams({ categoryId: configuration.categories[0]?.id ?? '' }))
          }
        >
          Clear filters
        </button>
      </form>
      <p className="hint">
        Search covers a bounded recent window in your permitted audiences. It is not an exhaustive
        archive.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {busy && <p role="status">Checking current source permissions…</p>}
      {!busy && !error && !items.length && (
        <p className="empty">No current reviewed fixes match. You can still report a new issue.</p>
      )}
      <div className="card-grid">
        {items.map((k) => (
          <article className="card" key={k.id}>
            <p className="eyebrow">Reporter confirmed · reviewed</p>
            <h2>
              <button className="text-button" onClick={() => open(k.id)}>
                {k.symptom}
              </button>
            </h2>
            <p>{k.fix}</p>
            <p>
              <strong>Observed outcome:</strong> {k.outcome}
            </p>
            <p className="hint">
              Reviewed by {k.reviewer.displayName} · {date(k.reviewedAt)}
            </p>
          </article>
        ))}
      </div>
      {capped && (
        <p className="hint">
          The recent candidate limit was reached. Narrow the topic or group; older records may be
          outside this search.
        </p>
      )}
      {cursor && (
        <button disabled={busy} onClick={() => void load(cursor)}>
          Load more reviewed fixes
        </button>
      )}
      <button className="secondary" disabled={busy || !category} onClick={() => void load()}>
        Refresh library
      </button>
    </>
  );
}
function KnowledgeIntake({
  apiPrefix,
  sourceId,
  onCreated,
}: {
  apiPrefix: string;
  sourceId: string;
  onCreated: (id: string) => void;
}) {
  const api = useApi(),
    [source, setSource] = useState<Issue>(),
    [symptom, setSymptom] = useState(''),
    [cause, setCause] = useState(''),
    [fix, setFix] = useState(''),
    [outcome, setOutcome] = useState(''),
    [due, setDue] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const request = useRef<{ body: string; key: string } | undefined>(undefined);
  useEffect(() => {
    const abort = new AbortController();
    api(`${apiPrefix}/posts/${sourceId}`, issueSchema, { signal: abort.signal })
      .then((i) => {
        if (!i.capabilities.includes('CURATE_KNOWLEDGE') || !i.detail.currentResolution)
          throw new Error('A current curator must review a confirmed resolution.');
        setSource(i);
        setSymptom(i.detail.currentResolution.symptom);
        setCause(i.detail.currentResolution.cause ?? '');
        setFix(i.detail.currentResolution.action);
        setOutcome(i.detail.currentResolution.outcome);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(message(e));
      });
    return () => abort.abort();
  }, [sourceId, apiPrefix]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!source || !confirmed) return;
    setBusy(true);
    setError('');
    try {
      const data = knowledgeCreateSchema.parse({
          sourcePostId: source.id,
          sourceExpectedVersion: source.version,
          resolutionId: source.detail.currentResolution?.id,
          symptom,
          ...(cause ? { cause } : {}),
          fix,
          outcome,
          reviewDueAt: new Date(due).toISOString(),
        }),
        body = JSON.stringify(data);
      if (request.current?.body !== body) request.current = { body, key: crypto.randomUUID() };
      const card = await api(`${apiPrefix}/knowledge`, knowledgeSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': request.current.key },
        body,
      });
      onCreated(card.id);
    } catch (e) {
      setError(message(e));
      if (e instanceof RequestError && [401, 403, 404].includes(e.status)) setSource(undefined);
      if (e instanceof RequestError && e.status === 409) {
        try {
          setSource(await api(`${apiPrefix}/posts/${sourceId}`, issueSchema));
          setConfirmed(false);
        } catch {
          setSource(undefined);
        }
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="eyebrow">Curated resolution</p>
      <h1>Review a reusable fix.</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!source && !error && <p role="status">Checking the confirmed source…</p>}
      {source && (
        <form className="card" onSubmit={save}>
          <p>
            <strong>Source:</strong> {source.title}
          </p>
          <p>
            The card keeps the source audience. Remove personal details; evidence remains on the
            original report under its own permissions.
          </p>
          <fieldset disabled={busy}>
            <legend>Reviewed resolution summary</legend>
            <label htmlFor="knowledge-symptom">Problem or symptoms</label>
            <textarea
              id="knowledge-symptom"
              required
              maxLength={1000}
              value={symptom}
              onChange={(e) => setSymptom(e.target.value)}
            />
            <label htmlFor="knowledge-cause">Verified cause (optional)</label>
            <textarea
              id="knowledge-cause"
              maxLength={1000}
              value={cause}
              onChange={(e) => setCause(e.target.value)}
            />
            <label htmlFor="knowledge-fix">Work that fixed it</label>
            <textarea
              id="knowledge-fix"
              required
              maxLength={2000}
              value={fix}
              onChange={(e) => setFix(e.target.value)}
            />
            <label htmlFor="knowledge-outcome">Verified outcome</label>
            <textarea
              id="knowledge-outcome"
              required
              maxLength={1000}
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            />
            <label htmlFor="knowledge-due">Review again by (your local time)</label>
            <input
              id="knowledge-due"
              type="datetime-local"
              required
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I checked the confirmed outcome, removed personal details, and reviewed the current
              source.
            </label>
            <button disabled={!confirmed}>Publish reviewed fix</button>
          </fieldset>
        </form>
      )}
    </>
  );
}
function KnowledgeDetail({
  apiPrefix,
  id,
  onSource,
}: {
  apiPrefix: string;
  id: string;
  onSource: (id: string) => void;
}) {
  const api = useApi(),
    [card, setCard] = useState<Knowledge>(),
    [action, setAction] = useState(''),
    [reason, setReason] = useState(''),
    [due, setDue] = useState(''),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const request = useRef<{ body: string; key: string } | undefined>(undefined);
  async function load() {
    try {
      const k = await api(`${apiPrefix}/knowledge/${id}`, knowledgeSchema);
      setCard(k);
      setAction(
        k.capabilities.includes('FLAG_STALE')
          ? 'mark-stale'
          : k.capabilities.includes('REVIEW')
            ? 'review'
            : '',
      );
      setError('');
    } catch (e) {
      setCard(undefined);
      setError(message(e));
    }
  }
  useEffect(() => {
    void load();
    const focus = () => void load();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [apiPrefix, id]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!card || !confirm) return;
    setBusy(true);
    setError('');
    try {
      const body = JSON.stringify({
        expectedVersion: card.version,
        action,
        reason,
        ...(action === 'review' ? { reviewDueAt: new Date(due).toISOString() } : {}),
      });
      if (request.current?.body !== body) request.current = { body, key: crypto.randomUUID() };
      const k = await api(`${apiPrefix}/knowledge/${id}/commands`, knowledgeSchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': request.current.key },
        body,
      });
      setCard(k);
      setConfirm(false);
      setAction(
        k.capabilities.includes('FLAG_STALE')
          ? 'mark-stale'
          : k.capabilities.includes('REVIEW')
            ? 'review'
            : '',
      );
    } catch (e) {
      if (e instanceof RequestError && [401, 403, 404].includes(e.status)) setCard(undefined);
      if (e instanceof RequestError && e.status === 409) await load();
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="eyebrow">Reviewed resolution</p>
      <h1>{card?.symptom ?? 'Library entry'}</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="secondary" disabled={busy} onClick={() => void load()}>
        Refresh source checks
      </button>
      {!card && !error && <p role="status">Checking the source and resolution…</p>}
      {card && (
        <>
          <article className="card">
            <p className="eyebrow">
              {card.state === 'ACTIVE'
                ? 'Current reviewed fix'
                : card.state === 'STALE'
                  ? 'Stale — needs review'
                  : 'Retired'}
            </p>
            {card.state !== 'ACTIVE' && (
              <p className="notice">
                This card is excluded from current search and AI sources. Check the original report
                before using its historical outcome.
              </p>
            )}
            {card.cause && (
              <>
                <h2>Cause</h2>
                <p className="post-body">{card.cause}</p>
              </>
            )}
            <h2>Fix</h2>
            <p className="post-body">{card.fix}</p>
            <h2>Observed outcome</h2>
            <p className="post-body">{card.outcome}</p>
            <p>
              Reviewed by {card.reviewer.displayName} · {date(card.reviewedAt)}
            </p>
            <p>Review due: {date(card.reviewDueAt)}</p>
            {card.lastChange && (
              <p className="notice">
                <strong>Latest review note:</strong> {card.lastChange.reason} —{' '}
                {card.lastChange.actor.displayName}, {date(card.lastChange.at)}
              </p>
            )}
            <button onClick={() => onSource(card.sourcePostId)}>
              Open confirmed source report
            </button>
          </article>
          {card.capabilities.length > 0 && (
            <form className="card" onSubmit={save}>
              <fieldset disabled={busy}>
                <legend>Keep this fix accurate</legend>
                <label htmlFor="knowledge-action">Library action</label>
                <select
                  id="knowledge-action"
                  value={action}
                  onChange={(e) => {
                    setAction(e.target.value);
                    setConfirm(false);
                  }}
                >
                  {card.capabilities.includes('FLAG_STALE') && (
                    <option value="mark-stale">Flag as stale</option>
                  )}
                  {card.capabilities.includes('REVIEW') && (
                    <option value="review">Review again</option>
                  )}
                  {card.capabilities.includes('RETIRE') && (
                    <option value="retire">Retire card</option>
                  )}
                </select>
                <label htmlFor="knowledge-reason">Reason or verification findings</label>
                <textarea
                  id="knowledge-reason"
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                {action === 'review' && (
                  <>
                    <label htmlFor="knowledge-review-date">Next review (your local time)</label>
                    <input
                      id="knowledge-review-date"
                      required
                      type="datetime-local"
                      value={due}
                      onChange={(e) => setDue(e.target.value)}
                    />
                  </>
                )}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={confirm}
                    onChange={(e) => setConfirm(e.target.checked)}
                  />
                  I reviewed the source and want to record this change.
                </label>
                <button disabled={!confirm}>Save library action</button>
              </fieldset>
            </form>
          )}
        </>
      )}
    </>
  );
}
