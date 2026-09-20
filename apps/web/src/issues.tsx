import { DiscussionPanel, SupportControl } from './discussion';
import { FilePanel } from './files';
import { type Attachment } from '@campusfix/contracts';
import { WorkflowPanel, StaffQueue } from './workflow';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  publicConfigurationSchema,
  draftSchema,
  draftPageSchema,
  issueSchema,
  issuePageSchema,
  issueCreateSchema,
  type PublicConfiguration,
  type Draft,
  type Issue,
  type Membership,
  type CampusSummary,
  type Audience,
} from '@campusfix/contracts';
import { useApi, RequestError } from './api';

type Navigation = (path: string) => void;
export function IssueWorkspace({
  campus,
  membership,
  path,
  navigate,
}: {
  campus: CampusSummary;
  membership: Membership;
  path: string;
  navigate: Navigation;
}) {
  const api = useApi();
  const [configuration, setConfiguration] = useState<PublicConfiguration>(),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const prefix = `/c/${campus.id}`;
  const apiPrefix = `/campuses/${campus.id}`;
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api(`${apiPrefix}/configuration`, publicConfigurationSchema, { signal: controller.signal })
      .then(setConfiguration)
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(message(e));
          if (e instanceof RequestError && [401, 403, 404].includes(e.status))
            setConfiguration(undefined);
        }
      });
    return () => controller.abort();
  }, [apiPrefix, revision]);
  useEffect(() => {
    const refresh = () => setRevision((v) => v + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const tail = path.slice(prefix.length);
  const draftId = tail.startsWith('/drafts/') ? tail.split('/')[2] : undefined,
    issueId =
      tail.startsWith('/issues/') && tail !== '/issues/new' ? tail.split('/')[2] : undefined;
  return (
    <section className="workspace">
      <div className="workspace-top">
        <div>
          <p className="eyebrow">{campus.name}</p>
          <nav aria-label="Campus">
            {membership.roles.some(
              (r) =>
                Date.parse(r.expiresAt) > Date.now() &&
                ['UNIT_LEAD', 'HANDLER', 'SENSITIVE_HANDLER'].includes(r.role),
            ) && (
              <button
                className={tail === '/staff/queue' ? 'tab active' : 'tab'}
                onClick={() => navigate(`${prefix}/staff/queue`)}
              >
                Staff queue
              </button>
            )}
            <button
              className={tail === '/issues' ? 'tab active' : 'tab'}
              onClick={() => navigate(`${prefix}/issues`)}
            >
              Issues
            </button>
            <button
              className={tail.startsWith('/drafts') ? 'tab active' : 'tab'}
              onClick={() => navigate(`${prefix}/drafts`)}
            >
              My drafts
            </button>
            <button className="tab" onClick={() => navigate(`${prefix}/membership`)}>
              My access
            </button>
          </nav>
        </div>
        <button onClick={() => navigate(`${prefix}/issues/new`)}>Report an issue</button>
      </div>
      {configuration && error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {error && !configuration ? (
        <div className="notice error" role="alert">
          <h1>Campus information is unavailable.</h1>
          <p>{error}</p>
          <button className="secondary" onClick={() => setRevision((v) => v + 1)}>
            Check access again
          </button>
        </div>
      ) : !configuration ? (
        <p role="status">Loading your campus and current permissions…</p>
      ) : tail === '/issues/new' || draftId ? (
        <ReportForm
          key={draftId ?? 'new'}
          configuration={configuration}
          membership={membership}
          apiPrefix={apiPrefix}
          draftId={draftId}
          onPublished={(id) => navigate(`${prefix}/issues/${id}`)}
          onSaved={(id) => navigate(`${prefix}/drafts/${id}`)}
        />
      ) : tail === '/staff/queue' ? (
        <StaffQueue
          apiPrefix={apiPrefix}
          configuration={configuration}
          membership={membership}
          open={(id) => navigate(`${prefix}/issues/${id}`)}
        />
      ) : issueId ? (
        <IssueDetail
          key={issueId}
          id={issueId}
          apiPrefix={apiPrefix}
          configuration={configuration}
          membership={membership}
        />
      ) : tail === '/drafts' ? (
        <DraftList apiPrefix={apiPrefix} open={(id) => navigate(`${prefix}/drafts/${id}`)} />
      ) : (
        <IssueFeed
          apiPrefix={apiPrefix}
          configuration={configuration}
          membership={membership}
          open={(id) => navigate(`${prefix}/issues/${id}`)}
        />
      )}
    </section>
  );
}
function ReportForm({
  configuration,
  membership,
  apiPrefix,
  draftId,
  onPublished,
  onSaved,
}: {
  configuration: PublicConfiguration;
  membership: Membership;
  apiPrefix: string;
  draftId: string | undefined;
  onPublished: (id: string) => void;
  onSaved: (id: string) => void;
}) {
  const api = useApi();
  const [draft, setDraft] = useState<Draft>(),
    [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [categoryId, setCategory] = useState(''),
    [unitId, setUnit] = useState(''),
    [location, setLocation] = useState(''),
    [audienceKind, setAudience] = useState<Audience['kind']>('CAMPUS'),
    [groups, setGroups] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false),
    [severity, setSeverity] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL');
  const [loading, setLoading] = useState(!!draftId),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [conflict, setConflict] = useState(false);
  const [latestComparison, setLatestComparison] = useState<Draft>();
  const [files, setFiles] = useState<Attachment[]>([]),
    [fileBusy, setFileBusy] = useState(false),
    [filesKnown, setFilesKnown] = useState(!draftId),
    [omitPending, setOmitPending] = useState(false);
  const request = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  function retryKey(input: unknown, operation: string) {
    const fingerprint = JSON.stringify([operation, input]);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, key: crypto.randomUUID() };
    return request.current.key;
  }
  function populate(value: Draft) {
    if (value.type !== 'ISSUE')
      throw new Error('This draft type is not available in the current release.');
    setDraft(value);
    setTitle(value.title);
    setBody(value.body);
    setCategory(value.categoryId ?? '');
    setUnit(configuration.categories.find((c) => c.id === value.categoryId)?.defaultUnitId ?? '');
    setLocation(value.locationLabel ?? '');
    setAudience(value.audience?.kind ?? 'CAMPUS');
    setGroups(value.audience?.kind === 'GROUPS' ? value.audience.groupIds : []);
    setConfirmed(false);
  }
  useEffect(() => {
    if (!draftId) return;
    const controller = new AbortController();
    setLoading(true);
    api(`${apiPrefix}/drafts/${draftId}`, draftSchema, { signal: controller.signal })
      .then(populate)
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [apiPrefix, draftId]);
  const allowedGroups = configuration.groups.filter((g) => membership.groupIds.includes(g.id));
  const category = configuration.categories.find((c) => c.id === categoryId);
  const audience: Audience =
    audienceKind === 'GROUPS'
      ? { kind: 'GROUPS', groupIds: groups }
      : audienceKind === 'RESTRICTED'
        ? { kind: 'RESTRICTED' }
        : { kind: 'CAMPUS' };
  const audienceText =
    audienceKind === 'CAMPUS'
      ? 'All active members of this campus'
      : audienceKind === 'RESTRICTED'
        ? 'You and the assigned sensitive-case handlers'
        : `Residents or members of ${
            allowedGroups
              .filter((g) => groups.includes(g.id))
              .map((g) => g.name)
              .join(', ') || 'your selected groups'
          }, plus you and the assigned handlers`;
  async function submit(mode: 'save' | 'publish') {
    setError('');
    setNotice('');
    setConflict(false);
    if (draftId && !draft) {
      setError('Reload the draft before saving.');
      return;
    }
    if (audienceKind === 'GROUPS' && (groups.length < 1 || groups.length > 4)) {
      setError('Select between one and four approved groups.');
      return;
    }
    if (
      mode === 'publish' &&
      draft &&
      (!filesKnown || fileBusy || (files.some((f) => f.state !== 'CLEAN') && !omitPending))
    ) {
      setError(
        'Wait for evidence checks, or explicitly choose to publish without unfinished files.',
      );
      return;
    }
    const common = {
      type: 'ISSUE' as const,
      title,
      body,
      ...(categoryId ? { categoryId } : {}),
      locationLabel: location,
      audience,
    };
    const payload = {
      title,
      body,
      categoryId,
      unitId,
      locationLabel: location,
      audience,
      audienceConfirmed: confirmed,
      severity,
      attachmentIds: files.filter((f) => f.state === 'CLEAN').map((f) => f.id),
    };
    if (mode === 'publish') {
      const parsed = issueCreateSchema.safeParse(payload);
      if (!parsed.success) {
        setError(
          !confirmed
            ? 'Confirm the audience before publishing.'
            : 'Add a title, description, category and responsible team before publishing.',
        );
        return;
      }
    }
    const data =
      mode === 'save'
        ? draft
          ? { ...common, expectedVersion: draft.version }
          : common
        : draft
          ? { expectedVersion: draft.version, payload }
          : payload;
    const route =
      mode === 'save'
        ? draft
          ? `${apiPrefix}/drafts/${draft.id}`
          : `${apiPrefix}/drafts`
        : draft
          ? `${apiPrefix}/drafts/${draft.id}/publish`
          : `${apiPrefix}/issues`;
    setBusy(true);
    try {
      if (mode === 'save') {
        const saved = await api(route, draftSchema, {
          method: draft ? 'PATCH' : 'POST',
          headers: { 'Idempotency-Key': retryKey(data, route) },
          body: JSON.stringify(data),
        });
        setDraft(saved);
        setNotice('Draft saved. Only you can read it.');
        if (!draftId) onSaved(saved.id);
      } else {
        const published = await api(route, issueSchema, {
          method: 'POST',
          headers: { 'Idempotency-Key': retryKey(data, route) },
          body: JSON.stringify(data),
        });
        onPublished(published.id);
      }
    } catch (e) {
      setError(message(e));
      setConflict(e instanceof RequestError && e.code === 'VERSION_CONFLICT');
    } finally {
      setBusy(false);
    }
  }
  async function compareVersion() {
    if (!draft) return;
    setBusy(true);
    try {
      const latest = await api(`${apiPrefix}/drafts/${draft.id}`, draftSchema);
      setDraft(latest);
      setLatestComparison(latest);
      setNotice(
        `Server draft is version ${latest.version}. Your unsaved text is preserved. Review it before saving over that version.`,
      );
      setConflict(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <p role="status">Loading your private draft…</p>;
  return (
    <div className="report-layout">
      <div>
        <p className="eyebrow">{draft ? 'Private draft' : 'New report'}</p>
        <h1>{draft ? 'Continue your report.' : 'What needs attention?'}</h1>
        <p className="intro-small">
          Describe the issue, choose its audience, and send it to a responsible campus team.
        </p>
        {error && (
          <div role="alert" className="notice error">
            <p>{error}</p>
            {conflict && (
              <button type="button" className="secondary" onClick={() => void compareVersion()}>
                Check latest version and keep my text
              </button>
            )}
          </div>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {latestComparison && (
          <section className="notice" aria-label="Latest saved version">
            <h2>Latest saved draft</h2>
            <strong>{latestComparison.title || 'Untitled draft'}</strong>
            <p className="post-body">{latestComparison.body || 'No description saved.'}</p>
            <p>Your unsaved text remains in the form below. Compare before saving.</p>
          </section>
        )}
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void submit('publish');
          }}
        >
          <fieldset disabled={busy || fileBusy || (!!draftId && !draft)}>
            <legend className="sr-only">Issue details</legend>
            <label htmlFor="issue-title">Issue title</label>
            <input
              id="issue-title"
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="A short, specific description"
            />
            <p className="hint">{title.length}/120 characters</p>
            <label htmlFor="issue-body">What happened?</label>
            <textarea
              id="issue-body"
              rows={6}
              maxLength={5000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe where, when, and how the issue affects you."
            />
            <div className="form-grid">
              <div>
                <label htmlFor="issue-category">Category</label>
                <select
                  id="issue-category"
                  value={categoryId}
                  onChange={(e) => {
                    const next = configuration.categories.find((c) => c.id === e.target.value);
                    setCategory(e.target.value);
                    setUnit(next?.defaultUnitId ?? '');
                    if (next?.sensitiveDefault) setAudience('RESTRICTED');
                    setConfirmed(false);
                  }}
                >
                  <option value="">Choose a category</option>
                  {configuration.categories
                    .filter((c) => c.allowedPostTypes.includes('ISSUE'))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label htmlFor="issue-team">Responsible team</label>
                <select id="issue-team" value={unitId} onChange={(e) => setUnit(e.target.value)}>
                  <option value="">Choose a team</option>
                  {configuration.units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label htmlFor="issue-location">Location (optional)</label>
            <input
              id="issue-location"
              maxLength={160}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Building or shared area; avoid private room details"
            />
            <label htmlFor="issue-priority">Impact</label>
            <select
              id="issue-priority"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as typeof severity)}
            >
              <option value="LOW">Low — minor inconvenience</option>
              <option value="NORMAL">Normal — service affected</option>
              <option value="HIGH">High — significant disruption</option>
              <option value="URGENT">Urgent — immediate human attention needed</option>
            </select>
            {severity === 'URGENT' && (
              <div className="notice">
                <strong>This report is not emergency dispatch.</strong>
                {configuration.emergencyContacts.length ? (
                  configuration.emergencyContacts.map((c) => (
                    <p key={c.label}>
                      {c.label}: {c.number}
                    </p>
                  ))
                ) : (
                  <p>
                    For an emergency, contact your campus emergency service or local emergency
                    number directly.
                  </p>
                )}
              </div>
            )}
            <label htmlFor="issue-audience">Who can see this report?</label>
            <select
              id="issue-audience"
              value={audienceKind}
              disabled={category?.sensitiveDefault}
              onChange={(e) => {
                setAudience(e.target.value as Audience['kind']);
                setConfirmed(false);
              }}
            >
              <option value="CAMPUS">Entire campus</option>
              <option value="GROUPS">Selected hostel or department groups</option>
              <option value="RESTRICTED">Restricted case</option>
            </select>
            {audienceKind === 'GROUPS' && (
              <fieldset className="group-picker">
                <legend>Choose up to four approved groups</legend>
                {allowedGroups.length ? (
                  allowedGroups.map((g) => (
                    <label className="check" key={g.id}>
                      <input
                        type="checkbox"
                        checked={groups.includes(g.id)}
                        disabled={!groups.includes(g.id) && groups.length >= 4}
                        onChange={(e) => {
                          setGroups((old) =>
                            e.target.checked ? [...old, g.id] : old.filter((id) => id !== g.id),
                          );
                          setConfirmed(false);
                        }}
                      />
                      {g.name}
                    </label>
                  ))
                ) : (
                  <p>You do not have any approved group memberships yet.</p>
                )}
              </fieldset>
            )}
            <div className="audience-preview">
              <strong>Visible to</strong>
              <p>{audienceText}.</p>
            </div>
            {audienceKind === 'RESTRICTED' && !configuration.featureFlags.sensitiveCases && (
              <p className="notice">
                Restricted handling is not configured for this campus. Save a private draft while
                your representative sets up the appropriate team.
              </p>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I have checked the audience and want to share this report with them.
            </label>
            {draft ? (
              <FilePanel
                apiPrefix={apiPrefix}
                postId={draft.id}
                canUpload
                disabled={busy}
                onBusyChange={setFileBusy}
                onChange={async (values) => {
                  setFiles(values);
                  setFilesKnown(true);
                  const latest = await api(`${apiPrefix}/drafts/${draft.id}`, draftSchema);
                  if (
                    JSON.stringify([
                      draft.title,
                      draft.body,
                      draft.categoryId,
                      draft.audience,
                      draft.locationLabel,
                    ]) !==
                    JSON.stringify([
                      latest.title,
                      latest.body,
                      latest.categoryId,
                      latest.audience,
                      latest.locationLabel,
                    ])
                  ) {
                    setLatestComparison(latest);
                    setConflict(true);
                    setError(
                      'This draft was edited elsewhere. Compare the latest version before saving.',
                    );
                  } else setDraft(latest);
                }}
              />
            ) : (
              <p className="hint">Save a private draft first to add evidence before publishing.</p>
            )}
            {draft && files.some((f) => f.state !== 'CLEAN') && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={omitPending}
                  onChange={(e) => setOmitPending(e.target.checked)}
                />
                Publish without unfinished or rejected evidence. These files will not become visible
                automatically.
              </label>
            )}
            <div className="actions">
              <button
                type="submit"
                disabled={
                  audienceKind === 'RESTRICTED' && !configuration.featureFlags.sensitiveCases
                }
              >
                {busy ? 'Saving…' : 'Publish report'}
              </button>
              <button type="button" className="secondary" onClick={() => void submit('save')}>
                Save private draft
              </button>
            </div>
          </fieldset>
        </form>
      </div>
      <aside className="report-aside">
        <p className="eyebrow">What happens next</p>
        <h2>A clear owner and next step.</h2>
        <ol>
          <li>The selected team’s eligible lead becomes the issue owner.</li>
          <li>The report appears only in permitted feeds.</li>
          <li>Replies, progress and confirmation will form its resolution record.</li>
        </ol>
        <p className="hint">
          Keep personal details out of campus-wide reports. A group audience includes approved group
          members and assigned handlers.
        </p>
      </aside>
    </div>
  );
}
function IssueFeed({
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
  const initialFilters = useRef(new URLSearchParams(location.search));
  const [items, setItems] = useState<Issue[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [category, setCategory] = useState(initialFilters.current.get('categoryId') ?? ''),
    [group, setGroup] = useState(initialFilters.current.get('groupId') ?? ''),
    [mine, setMine] = useState(initialFilters.current.get('mine') === 'true'),
    [search, setSearch] = useState(initialFilters.current.get('query') ?? ''),
    [query, setQuery] = useState(initialFilters.current.get('query') ?? ''),
    [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const filters = new URLSearchParams({
    type: 'ISSUE',
    limit: '20',
    ...(category ? { categoryId: category } : {}),
    ...(group ? { groupId: group } : {}),
    ...(mine ? { mine: 'true' } : {}),
    ...(query ? { query } : {}),
  }).toString();
  async function load(next?: string) {
    const current = generation.current;
    setBusy(true);
    setError('');
    try {
      const page = await api(
        `${apiPrefix}/posts?${filters}${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
        issuePageSchema,
      );
      if (current !== generation.current) return;
      setItems((old) =>
        next ? [...old, ...page.items.filter((i) => !old.some((o) => o.id === i.id))] : page.items,
      );
      setCursor(page.nextCursor);
    } catch (e) {
      if (current === generation.current) {
        setError(message(e));
        if (e instanceof RequestError && [401, 403, 404].includes(e.status)) {
          setItems([]);
          setCursor(null);
        }
      }
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    generation.current++;
    setItems([]);
    setCursor(null);
    void load();
    history.replaceState(null, '', `${location.pathname}?${filters}`);
    return () => {
      generation.current++;
    };
  }, [apiPrefix, filters, refresh]);
  return (
    <>
      <div className="section-heading">
        <div>
          <h1>Campus issues.</h1>
          <p className="intro-small">Follow the reports you are permitted to see.</p>
        </div>
        <button className="secondary" disabled={busy} onClick={() => setRefresh((v) => v + 1)}>
          Refresh
        </button>
      </div>
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search);
        }}
      >
        <div>
          <label htmlFor="filter-category">Category</label>
          <select
            id="filter-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {configuration.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filter-group">Group</label>
          <select id="filter-group" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">All permitted audiences</option>
            {configuration.groups
              .filter((g) => membership.groupIds.includes(g.id))
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label htmlFor="issue-search">Search recent reports</label>
          <input
            id="issue-search"
            maxLength={200}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="secondary" type="submit">
          Search
        </button>
        <label className="check">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          My reports
        </label>
      </form>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <div className="issue-list">
        {items.map((issue) => (
          <article className="issue-card" key={issue.id}>
            <div>
              <span className="status-label">
                {issue.detail.status.replaceAll('_', ' ').toLowerCase()}
              </span>
              <span className="audience-label">
                {issue.audience.kind === 'CAMPUS'
                  ? 'Campus'
                  : issue.audience.kind === 'GROUPS'
                    ? 'Group'
                    : 'Restricted'}
              </span>
            </div>
            <h2>
              <button className="issue-link" onClick={() => open(issue.id)}>
                {issue.title}
              </button>
            </h2>
            <p>
              {issue.body.slice(0, 220)}
              {issue.body.length > 220 ? '…' : ''}
            </p>
            <div className="issue-meta">
              <span>Owner: {issue.detail.primaryOwner.displayName}</span>
              <span>{configuration.units.find((u) => u.id === issue.detail.unitId)?.name}</span>
              <time dateTime={issue.createdAt}>
                {new Date(issue.createdAt).toLocaleDateString()}
              </time>
            </div>
          </article>
        ))}
      </div>
      {busy && <p role="status">Loading permitted reports…</p>}
      {!busy && !items.length && !error && (
        <div className="empty">
          <h2>
            {cursor
              ? 'No matches in this set of reports.'
              : 'No visible reports match these filters.'}
          </h2>
          <p>
            {cursor
              ? 'Continue to the next set to keep searching.'
              : 'Try different filters or report an issue for your campus.'}
          </p>
        </div>
      )}
      {cursor && (
        <button disabled={busy} className="secondary" onClick={() => void load(cursor)}>
          Load more reports
        </button>
      )}
    </>
  );
}
function DraftList({ apiPrefix, open }: { apiPrefix: string; open: (id: string) => void }) {
  const api = useApi();
  const [items, setItems] = useState<Draft[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const generation = useRef(0);
  async function load(next?: string) {
    const current = generation.current;
    setBusy(true);
    setError('');
    try {
      const page = await api(
        `${apiPrefix}/drafts${next ? `?cursor=${encodeURIComponent(next)}` : ''}`,
        draftPageSchema,
      );
      if (current !== generation.current) return;
      setItems((old) => (next ? [...old, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      if (current === generation.current) {
        setError(message(e));
        setItems([]);
        setCursor(null);
      }
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    generation.current++;
    void load();
    return () => {
      generation.current++;
    };
  }, [apiPrefix]);
  return (
    <>
      <h1>Your private drafts.</h1>
      <p className="intro-small">
        Only you can read these. A draft is not assigned to a team until you publish it.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="card-grid">
        {items.map((d) => (
          <article className="card" key={d.id}>
            <p className="eyebrow">Private · version {d.version}</p>
            <h2>{d.title || 'Untitled draft'}</h2>
            <p>{d.body.slice(0, 150) || 'Add details when you are ready.'}</p>
            <button className="secondary" onClick={() => open(d.id)}>
              Continue editing
            </button>
          </article>
        ))}
      </div>
      {busy ? (
        <p role="status">Loading drafts…</p>
      ) : !items.length && !error ? (
        <div className="empty">
          <h2>No drafts here.</h2>
          <p>Start a report and save it privately if you need more time.</p>
        </div>
      ) : null}
      {cursor && (
        <button className="secondary" disabled={busy} onClick={() => void load(cursor)}>
          Load more drafts
        </button>
      )}
      <button className="text-button" disabled={busy} onClick={() => void load()}>
        Refresh drafts
      </button>
    </>
  );
}
function IssueDetail({
  id,
  apiPrefix,
  configuration,
  membership,
}: {
  id: string;
  apiPrefix: string;
  configuration: PublicConfiguration;
  membership: Membership;
}) {
  const api = useApi();
  const [issue, setIssue] = useState<Issue>(),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setIssue(undefined);
    setError('');
    api(`${apiPrefix}/posts/${id}`, issueSchema, { signal: controller.signal })
      .then(setIssue)
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [id, apiPrefix, refresh]);
  if (error)
    return (
      <div className="empty" role="alert">
        <h1>This item is unavailable.</h1>
        <p>{error}</p>
        <button className="secondary" onClick={() => setRefresh((v) => v + 1)}>
          Try again
        </button>
      </div>
    );
  if (!issue) return <p role="status">Loading report and checking your access…</p>;
  const unit = configuration.units.find((u) => u.id === issue.detail.unitId),
    category = configuration.categories.find((c) => c.id === issue.categoryId);
  return (
    <>
      <div className="section-heading">
        <div>
          <p className="eyebrow">{category?.name ?? 'Campus issue'}</p>
          <h1>{issue.title}</h1>
        </div>
        <button className="secondary" onClick={() => setRefresh((v) => v + 1)}>
          Refresh report
        </button>
      </div>
      <div className="detail-layout">
        <article className="card">
          <span className="status-label">
            {issue.detail.status.replaceAll('_', ' ').toLowerCase()}
          </span>
          <p className="post-body">{issue.body}</p>
          {issue.locationLabel && (
            <p>
              <strong>Location:</strong> {issue.locationLabel}
            </p>
          )}
          <p className="hint">
            Reported by {issue.author?.displayName ?? 'Campus member'} ·{' '}
            <time dateTime={issue.createdAt}>{new Date(issue.createdAt).toLocaleString()}</time>
          </p>
          <div className="audience-preview">
            <strong>Visibility</strong>
            <p>
              {issue.audience.kind === 'CAMPUS'
                ? 'All active members of this campus.'
                : issue.audience.kind === 'RESTRICTED'
                  ? 'Reporter and assigned sensitive-case handlers.'
                  : `${configuration.groups
                      .filter(
                        (g) =>
                          issue.audience.kind === 'GROUPS' &&
                          issue.audience.groupIds.includes(g.id),
                      )
                      .map((g) => g.name)
                      .join(', ')}, the reporter and assigned handlers.`}
            </p>
          </div>
        </article>
        <aside className="card">
          <p className="eyebrow">Accountability</p>
          <h2>{issue.detail.primaryOwner.displayName}</h2>
          <p>{unit?.name ?? 'Responsible campus team'}</p>
          <dl>
            <dt>Impact</dt>
            <dd>{issue.detail.severity.toLowerCase()}</dd>
            <dt>Acknowledgement due</dt>
            <dd>
              {issue.detail.ackDueAt
                ? new Date(issue.detail.ackDueAt).toLocaleString()
                : 'Not yet scheduled'}
            </dd>
            <dt>Update due</dt>
            <dd>
              {issue.detail.updateDueAt
                ? new Date(issue.detail.updateDueAt).toLocaleString()
                : 'Not yet scheduled'}
            </dd>
          </dl>
          <p className="hint">
            Times shown in your local timezone. Deadlines use the campus working calendar.
          </p>
        </aside>
      </div>
      <SupportControl
        issue={issue}
        apiPrefix={apiPrefix}
        onChange={async () => setIssue(await api(`${apiPrefix}/posts/${issue.id}`, issueSchema))}
      />
      <FilePanel
        apiPrefix={apiPrefix}
        postId={issue.id}
        canUpload={
          membership.user.id === issue.author?.id || issue.capabilities.includes('MANAGE_ISSUE')
        }
        isHandler={issue.capabilities.includes('MANAGE_ISSUE')}
        onChange={async () => setIssue(await api(`${apiPrefix}/posts/${issue.id}`, issueSchema))}
      />
      <DiscussionPanel
        issue={issue}
        apiPrefix={apiPrefix}
        membership={membership}
        onChange={async () => setIssue(await api(`${apiPrefix}/posts/${issue.id}`, issueSchema))}
      />
      <WorkflowPanel
        issue={issue}
        apiPrefix={apiPrefix}
        membership={membership}
        onChange={setIssue}
      />
    </>
  );
}
function message(error: unknown) {
  return error instanceof Error ? error.message : 'The request failed. Please retry.';
}
