import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  replySchema,
  replyPageSchema,
  replyRevisionPageSchema,
  supportResultSchema,
  type Reply,
  type ReplyRevision,
  type Issue,
  type Membership,
} from '@campusfix/contracts';
import { useApi, RequestError } from './api';
const removal = z.object({ id: z.string(), version: z.number(), removed: z.literal(true) });
const message = (e: unknown) =>
  e instanceof Error ? e.message : 'The request failed. Please retry.';
type Changed = () => Promise<void>;
export function SupportControl({
  issue,
  apiPrefix,
  onChange,
}: {
  issue: Issue;
  apiPrefix: string;
  onChange: Changed;
}) {
  const api = useApi(),
    [value, setValue] = useState<z.infer<typeof supportResultSchema>>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const request = useRef<{ body: string; key: string } | undefined>(undefined);
  useEffect(() => {
    const c = new AbortController();
    api(`${apiPrefix}/issues/${issue.id}/support`, supportResultSchema, { signal: c.signal })
      .then(setValue)
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(message(e));
          setValue(undefined);
        }
      });
    return () => c.abort();
  }, [apiPrefix, issue.id, issue.version]);
  async function toggle() {
    if (!value) return;
    setBusy(true);
    setError('');
    const body = JSON.stringify({ expectedVersion: value.version, enabled: !value.supported });
    if (request.current?.body !== body) request.current = { body, key: crypto.randomUUID() };
    try {
      const saved = await api(`${apiPrefix}/issues/${issue.id}/support`, supportResultSchema, {
        method: 'PUT',
        headers: { 'Idempotency-Key': request.current.key },
        body,
      });
      setValue(saved);
      await onChange();
    } catch (e) {
      setError(message(e));
      if (e instanceof RequestError && e.status === 409)
        try {
          setValue(await api(`${apiPrefix}/issues/${issue.id}/support`, supportResultSchema));
        } catch {
          setValue(undefined);
        }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="support-control" aria-label="Affected students">
      <p>
        <strong>{value?.supportCount ?? issue.detail.supportCount}</strong>{' '}
        {(value?.supportCount ?? issue.detail.supportCount) === 1 ? 'person has' : 'people have'}{' '}
        marked themselves affected.
      </p>
      <button
        type="button"
        className={value?.supported ? 'secondary' : 'primary'}
        aria-pressed={value?.supported ?? false}
        disabled={busy || !value}
        onClick={() => void toggle()}
      >
        {busy ? 'Saving…' : value?.supported ? 'Remove my affected status' : 'I’m affected too'}
      </button>
      {value?.supported && <p role="status">Your affected status is recorded once.</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
export function DiscussionPanel({
  issue,
  apiPrefix,
  membership,
  onChange,
}: {
  issue: Issue;
  apiPrefix: string;
  membership: Membership;
  onChange: Changed;
}) {
  const staff = issue.capabilities.includes('MANAGE_ISSUE'),
    [scope, setScope] = useState<'PUBLIC' | 'STAFF'>('PUBLIC');
  useEffect(() => {
    if (!staff) setScope('PUBLIC');
  }, [staff]);
  return (
    <section className="discussion-panel" aria-label="Discussion">
      <div className="section-heading">
        <div>
          <h2>Discussion</h2>
          <p>
            {scope === 'STAFF'
              ? 'Private notes for the currently assigned handlers.'
              : 'Replies are visible to everyone who can read this report.'}
          </p>
        </div>
        {staff && (
          <div className="actions" role="group" aria-label="Conversation visibility">
            <button
              type="button"
              className="secondary"
              aria-pressed={scope === 'PUBLIC'}
              onClick={() => setScope('PUBLIC')}
            >
              Public replies
            </button>
            <button
              type="button"
              className="secondary"
              aria-pressed={scope === 'STAFF'}
              onClick={() => setScope('STAFF')}
            >
              Staff notes
            </button>
          </div>
        )}
      </div>
      <ReplyList
        key={`${issue.id}-${scope}`}
        issue={issue}
        apiPrefix={apiPrefix}
        membership={membership}
        scope={scope}
        onChange={onChange}
      />
    </section>
  );
}
function ReplyList({
  issue,
  apiPrefix,
  membership,
  scope,
  onChange,
  parentReplyId,
}: {
  issue: Issue;
  apiPrefix: string;
  membership: Membership;
  scope: 'PUBLIC' | 'STAFF';
  onChange: Changed;
  parentReplyId?: string;
}) {
  const api = useApi(),
    [items, setItems] = useState<Reply[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const prefix = `${apiPrefix}/posts/${issue.id}/replies`,
    query = new URLSearchParams({
      limit: '20',
      scope,
      ...(parentReplyId ? { parentReplyId } : {}),
    }).toString();
  async function load(next?: string) {
    const gen = generation.current;
    setBusy(true);
    setError('');
    try {
      const p = await api(
        `${prefix}?${query}${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
        replyPageSchema,
      );
      if (gen !== generation.current) return;
      setItems((old) =>
        next ? [...old, ...p.items.filter((i) => !old.some((o) => o.id === i.id))] : p.items,
      );
      setCursor(p.nextCursor);
    } catch (e) {
      if (gen === generation.current) {
        setError(message(e));
        if (e instanceof RequestError && [401, 403, 404].includes(e.status)) {
          setItems([]);
          setCursor(null);
        }
      }
    } finally {
      if (gen === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    generation.current++;
    void load();
    return () => {
      generation.current++;
    };
  }, [prefix, query, revision, issue.version]);
  async function changed() {
    setRevision((v) => v + 1);
    await onChange();
  }
  const candidates = new Map<string, { id: string; displayName: string }>();
  for (const person of [
    issue.detail.primaryOwner,
    ...issue.detail.collaborators,
    ...(scope === 'PUBLIC' ? [issue.author, ...items.map((r) => r.author)] : []),
  ])
    if (person && person.id !== membership.user.id) candidates.set(person.id, person);
  return (
    <div className={parentReplyId ? 'reply-children' : 'reply-thread'}>
      {!parentReplyId && (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => setRevision((v) => v + 1)}
        >
          Refresh conversation
        </button>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {items.map((r) => (
        <ReplyCard
          key={r.id}
          reply={r}
          issue={issue}
          apiPrefix={apiPrefix}
          membership={membership}
          onChange={changed}
        />
      ))}
      {busy && <p role="status">Loading replies…</p>}
      {!busy && !items.length && !error && (
        <p>
          {cursor
            ? 'No matching replies in this batch. Load more to continue.'
            : scope === 'STAFF'
              ? 'No staff notes yet.'
              : 'No replies here yet.'}
        </p>
      )}
      {cursor && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void load(cursor)}
        >
          Load more replies
        </button>
      )}
      <ReplyComposer
        key={`${scope}-${parentReplyId ?? 'root'}`}
        prefix={prefix}
        scope={scope}
        {...(parentReplyId ? { parentReplyId } : {})}
        candidates={[...candidates.values()]}
        onChange={changed}
      />
    </div>
  );
}
function ReplyComposer({
  prefix,
  scope,
  parentReplyId,
  candidates,
  onChange,
}: {
  prefix: string;
  scope: 'PUBLIC' | 'STAFF';
  parentReplyId?: string;
  candidates: Array<{ id: string; displayName: string }>;
  onChange: Changed;
}) {
  const api = useApi(),
    [body, setBody] = useState(''),
    [mentionIds, setMentionIds] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const request = useRef<{ body: string; key: string } | undefined>(undefined);
  const field = `reply-body-${parentReplyId ?? scope}`;
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const payload = JSON.stringify({
      body,
      scope,
      ...(parentReplyId ? { parentReplyId } : {}),
      mentionIds,
    });
    if (request.current?.body !== payload)
      request.current = { body: payload, key: crypto.randomUUID() };
    try {
      await api(prefix, replySchema, {
        method: 'POST',
        headers: { 'Idempotency-Key': request.current.key },
        body: payload,
      });
      setBody('');
      setMentionIds([]);
      request.current = undefined;
      setNotice(scope === 'STAFF' ? 'Staff note saved.' : 'Reply posted.');
      await onChange();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="reply-composer" onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend>
          {parentReplyId
            ? 'Reply in this thread'
            : scope === 'STAFF'
              ? 'Add a private staff note'
              : 'Add a reply'}
        </legend>
        <label htmlFor={field}>{scope === 'STAFF' ? 'Staff note' : 'Your reply'}</label>
        <textarea
          id={field}
          rows={3}
          maxLength={2000}
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <p className="hint">{body.length}/2000 characters</p>
        {candidates.length > 0 && (
          <details>
            <summary>Mention participants (optional)</summary>
            <div className="mention-options">
              {candidates.map((p) => (
                <label className="check" key={p.id}>
                  <input
                    type="checkbox"
                    checked={mentionIds.includes(p.id)}
                    disabled={!mentionIds.includes(p.id) && mentionIds.length >= 10}
                    onChange={(e) =>
                      setMentionIds((ids) =>
                        e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id),
                      )
                    }
                  />
                  {p.displayName}
                </label>
              ))}
            </div>
          </details>
        )}
        <button type="submit" disabled={!body.trim()}>
          {busy ? 'Posting…' : scope === 'STAFF' ? 'Save staff note' : 'Post reply'}
        </button>
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
function ReplyCard({
  reply: r,
  issue,
  apiPrefix,
  membership,
  onChange,
}: {
  reply: Reply;
  issue: Issue;
  apiPrefix: string;
  membership: Membership;
  onChange: Changed;
}) {
  const api = useApi(),
    [editing, setEditing] = useState(false),
    [removing, setRemoving] = useState(false),
    [body, setBody] = useState(r.body),
    [reason, setReason] = useState(''),
    [children, setChildren] = useState(false),
    [showRevisions, setShowRevisions] = useState(false),
    [revisions, setRevisions] = useState<ReplyRevision[]>([]),
    [revisionCursor, setRevisionCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const request = useRef<{ body: string; key: string } | undefined>(undefined);
  const prefix = `${apiPrefix}/posts/${issue.id}/replies/${r.id}`,
    own = r.author?.id === membership.user.id;
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const payload = JSON.stringify({
      expectedVersion: r.version,
      reason,
      ...(!removing ? { body } : {}),
    });
    const fingerprint = JSON.stringify([removing, payload]);
    if (request.current?.body !== fingerprint)
      request.current = { body: fingerprint, key: crypto.randomUUID() };
    try {
      const options = {
        method: removing ? 'POST' : 'PATCH',
        headers: { 'Idempotency-Key': request.current.key },
        body: payload,
      };
      if (removing) await api(`${prefix}/remove`, removal, options);
      else await api(prefix, replySchema, options);
      setEditing(false);
      setRemoving(false);
      setReason('');
      setShowRevisions(false);
      await onChange();
    } catch (e) {
      setError(message(e));
      if (e instanceof RequestError && e.status === 409) await onChange();
    } finally {
      setBusy(false);
    }
  }
  async function history(next?: string) {
    setBusy(true);
    setError('');
    try {
      const page = await api(
        `${prefix}/revisions?limit=10${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
        replyRevisionPageSchema,
      );
      setRevisions((old) => (next ? [...old, ...page.items] : page.items));
      setRevisionCursor(page.nextCursor);
      setShowRevisions(true);
    } catch (e) {
      setRevisions([]);
      setShowRevisions(false);
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="reply-card">
      <header>
        <strong>{r.author?.displayName ?? 'Former campus member'}</strong>
        <span className="hint">
          {r.roleAtPosting === 'MEMBER'
            ? 'Campus member'
            : `${r.roleAtPosting.replaceAll('_', ' ').toLowerCase()} at posting`}
          {r.scope === 'STAFF' ? ' · Private staff note' : ''}
        </span>
        <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString()}</time>
      </header>
      {r.removedAt ? (
        <p className="hint">This reply was removed by its author.</p>
      ) : (
        <p className="post-body">{r.body}</p>
      )}
      {r.mentions.length > 0 && (
        <p className="hint">Mentioned: {r.mentions.map((p) => p.displayName).join(', ')}</p>
      )}
      {r.editedAt && <p className="hint">Edited {new Date(r.editedAt).toLocaleString()}</p>}
      <div className="actions">
        {!r.parentReplyId && (
          <button
            type="button"
            className="text-button"
            aria-expanded={children}
            onClick={() => setChildren((v) => !v)}
          >
            {children ? 'Hide thread' : 'View or add a reply'}
          </button>
        )}
        {own && !r.removedAt && (
          <>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setEditing(true);
                setRemoving(false);
                setBody(r.body);
                setReason('');
              }}
            >
              Edit reply
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setRemoving(true);
                setEditing(false);
                setReason('');
              }}
            >
              Remove reply
            </button>
          </>
        )}
        {(r.editedAt || r.removedAt) &&
          (!r.removedAt || own || issue.capabilities.includes('MANAGE_ISSUE')) && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => (showRevisions ? setShowRevisions(false) : void history())}
            >
              {showRevisions ? 'Hide edits' : 'View edits'}
            </button>
          )}
      </div>
      {(editing || removing) && (
        <form onSubmit={save}>
          <fieldset disabled={busy}>
            <legend>{removing ? 'Remove reply' : 'Revise reply'}</legend>
            {!removing && (
              <>
                <label htmlFor={`edit-${r.id}`}>Revised reply</label>
                <textarea
                  id={`edit-${r.id}`}
                  maxLength={2000}
                  required
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </>
            )}
            <label htmlFor={`reason-${r.id}`}>Reason</label>
            <input
              id={`reason-${r.id}`}
              maxLength={1000}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {removing && (
              <p className="hint">
                The conversation keeps an attributed placeholder. Retained revisions remain
                available to you and authorized handlers.
              </p>
            )}
            <div className="actions">
              <button type="submit">
                {busy ? 'Saving…' : removing ? 'Confirm removal' : 'Save revision'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setEditing(false);
                  setRemoving(false);
                }}
              >
                Cancel
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {showRevisions && (
        <section className="reply-revisions" aria-label="Reply revisions">
          {revisions.map((v) => (
            <article key={v.id}>
              <strong>Previous version {v.version}</strong>
              <p className="post-body">{v.body}</p>
              <p className="hint">
                {v.actor.displayName} · {v.reason} · {new Date(v.createdAt).toLocaleString()}
              </p>
            </article>
          ))}
          {revisionCursor && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void history(revisionCursor)}
            >
              Load more edits
            </button>
          )}
        </section>
      )}
      {children && !r.parentReplyId && (
        <ReplyList
          issue={issue}
          apiPrefix={apiPrefix}
          membership={membership}
          scope={r.scope}
          parentReplyId={r.id}
          onChange={onChange}
        />
      )}
    </article>
  );
}
