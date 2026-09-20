import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { campusSummarySchema, membershipSchema, profileSchema } from '@campusfix/contracts';
import { ApiContext, createApi } from '../../apps/web/src/api';
import { IssueWorkspace } from '../../apps/web/src/issues';
import '../../apps/web/src/styles.css';
import './demo.css';
const actorSchema = z.object({
  key: z.string(),
  name: z.string(),
  detail: z.string(),
  kind: z.string(),
});
const bootstrapSchema = z.object({
  campusName: z.string(),
  actors: z.array(actorSchema),
  datasetVersion: z.number(),
  localOnly: z.literal(true),
});
const sessionSchema = z.object({
  token: z.string(),
  actor: actorSchema,
  profile: profileSchema,
  campus: campusSummarySchema,
  membership: membershipSchema,
  shortcuts: z.record(z.string(), z.string()),
});
type Session = z.infer<typeof sessionSchema>;
function Demo() {
  const [bootstrap, setBootstrap] = useState<z.infer<typeof bootstrapSchema>>(),
    [session, setSession] = useState<Session>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [path, setPath] = useState(location.pathname + location.search);
  const [api, setApi] = useState(() => createApi(() => ''));
  const navigate = (next: string) => {
    history.pushState(null, '', next);
    setPath(next);
    setError('');
  };
  useEffect(() => {
    fetch('/demo/bootstrap', { cache: 'no-store' })
      .then((r) => r.json())
      .then((v) => setBootstrap(bootstrapSchema.parse(v)))
      .catch(() => setError('The local demo could not load. Check the terminal.'));
    const pop = () => setPath(location.pathname + location.search);
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  async function enter(key: string) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/demo/session/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        cache: 'no-store',
      });
      if (!response.ok)
        throw Error(
          'The persona could not be opened. Restart the local demo if its membership expired.',
        );
      const next = sessionSchema.parse(await response.json());
      setApi(() => createApi(() => next.token));
      setSession(next);
      navigate(`/c/${next.campus.id}/issues`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch persona.');
    } finally {
      setBusy(false);
    }
  }
  function home() {
    setSession(undefined);
    navigate('/');
  }
  const p = session ? `/c/${session.campus.id}` : '';
  return (
    <div className="shell demo-shell">
      <a className="skip" href="#demo-main">
        Skip to content
      </a>
      <div className="demo-notice">
        Fictional college · Local demo · Persona switching is excluded from AWS deployments
      </div>
      <header className="header">
        <button className="demo-brand" onClick={home}>
          <span className="brand-icon">C</span>
          <span>
            CampusFix<small>IIT Dholakpur</small>
          </span>
        </button>
        {session ? (
          <div className="demo-switch">
            <label htmlFor="persona">Explore as</label>
            <select
              id="persona"
              value={session.actor.key}
              disabled={busy}
              onChange={(e) => void enter(e.target.value)}
            >
              {bootstrap?.actors.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name} · {a.kind}
                </option>
              ))}
            </select>
            <button className="secondary" onClick={home}>
              Campus overview
            </button>
          </div>
        ) : (
          <span className="badge">A report deserves a resolution</span>
        )}
      </header>
      <main id="demo-main" aria-busy={busy}>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {session ? (
          <>
            <div className="demo-person">
              <span className="demo-avatar">
                {session.actor.name
                  .split(' ')
                  .map((v) => v[0])
                  .slice(0, 2)
                  .join('')}
              </span>
              <div>
                <strong>{session.actor.name}</strong>
                <p>{session.actor.detail}</p>
              </div>
              <span className="badge">{session.campus.name}</span>
            </div>
            <div className="demo-shortcuts" aria-label="Recording shortcuts">
              <span>Demo story</span>
              {session.shortcuts.groupIssue && (
                <button
                  className="secondary"
                  onClick={() => navigate(`${p}/issues/${session.shortcuts.groupIssue}`)}
                >
                  Water purifier report
                </button>
              )}
              <button className="secondary" onClick={() => navigate(`${p}/issues`)}>
                Your visible feed
              </button>
              {session.shortcuts.closedIssue && (
                <button
                  className="secondary"
                  onClick={() => navigate(`${p}/issues/${session.shortcuts.closedIssue}`)}
                >
                  Confirmed Wi-Fi repair
                </button>
              )}
              {session.shortcuts.privateReview && (
                <button
                  className="secondary"
                  onClick={() =>
                    navigate(`${p}/service-reviews/${session.shortcuts.privateReview}`)
                  }
                >
                  Independent review
                </button>
              )}
            </div>
            <ApiContext.Provider value={api}>
              {path.endsWith('/membership') ? (
                <section className="page narrow">
                  <p className="eyebrow">{session.campus.name}</p>
                  <h1>Your campus access.</h1>
                  <div className="card">
                    <p>
                      <strong>{session.profile.displayName}</strong>
                    </p>
                    <p>{session.actor.detail}</p>
                    <p>Membership: {session.membership.status.toLowerCase()}</p>
                    <p>Approved groups: {session.membership.groupIds.length}</p>
                    <p>
                      Roles:{' '}
                      {session.membership.roles
                        .map((r) => r.role.toLowerCase().replaceAll('_', ' '))
                        .join(', ') || 'Student member'}
                    </p>
                    <p className="hint">Permissions are checked by the server on every request.</p>
                    <button onClick={() => navigate(`${p}/issues`)}>Back to campus issues</button>
                  </div>
                </section>
              ) : (
                <IssueWorkspace
                  key={session.actor.key}
                  campus={session.campus}
                  membership={session.membership}
                  path={path}
                  navigate={navigate}
                />
              )}
            </ApiContext.Provider>
          </>
        ) : (
          <>
            <section className="demo-hero">
              <div>
                <p className="eyebrow">Welcome to IIT Dholakpur</p>
                <h1>
                  Campus concerns.
                  <br />
                  <span>Clear accountability.</span>
                </h1>
                <p className="intro">
                  A working fictional campus where students report concerns, responsible teams act,
                  and students confirm the outcome.
                </p>
                <div className="actions">
                  <button disabled={busy || !bootstrap} onClick={() => void enter('student-a')}>
                    Explore as Aarav
                  </button>
                  <button
                    className="secondary"
                    disabled={busy || !bootstrap}
                    onClick={() => void enter('owner')}
                  >
                    Open the staff desk
                  </button>
                </div>
                <p className="hint">
                  No AWS login needed. Changes go through the real API and local DynamoDB.
                </p>
              </div>
              <aside className="demo-campus-card">
                <span className="badge">The recording campus</span>
                <h2>
                  One campus.
                  <br />
                  Many perspectives.
                </h2>
                <p>Kaveri & Narmada hostels</p>
                <p>Computer Science & Mechanical Engineering</p>
                <p>Coding club · Placement cell · Campus services</p>
                <hr />
                <p>
                  <strong>Report → Owner → Progress → Student confirmation</strong>
                </p>
                <p className="hint">
                  All names, reports and decisions are fictional. This is not affiliated with a real
                  IIT.
                </p>
              </aside>
            </section>
            <section className="demo-people">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Meet the campus</p>
                  <h2>Choose a perspective.</h2>
                </div>
                <p>Each person sees only their permitted records.</p>
              </div>
              <div className="demo-personas">
                {bootstrap?.actors.map((a) => (
                  <button
                    key={a.key}
                    className="demo-persona"
                    disabled={busy}
                    onClick={() => void enter(a.key)}
                  >
                    <span className="demo-avatar">
                      {a.name
                        .split(' ')
                        .map((v) => v[0])
                        .slice(0, 2)
                        .join('')}
                    </span>
                    <span className="demo-persona-text">
                      <strong>{a.name}</strong>
                      <span>{a.detail}</span>
                      <em>{a.kind} →</em>
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <section className="demo-scenarios">
              <h2>Already populated. Ready to explore.</h2>
              <div className="card-grid">
                <article className="card">
                  <span className="status-label">In progress</span>
                  <h3>Kaveri water purifier</h3>
                  <p>
                    Aarav's report, a resident's reply and an attributed owner update. Propose a fix
                    as Prakash; confirm it as Aarav.
                  </p>
                </article>
                <article className="card">
                  <span className="status-label">Confirmed & reviewed</span>
                  <h3>Library Wi-Fi repair</h3>
                  <p>
                    A complete historical resolution, confirmed by the reporting student and curated
                    into the knowledge library.
                  </p>
                </article>
                <article className="card">
                  <span className="status-label">Private review</span>
                  <h3>Accessible library entrance</h3>
                  <p>
                    Kabir requests an independent review. Dr Saira can assess it; the original
                    handler cannot access the case.
                  </p>
                </article>
              </div>
            </section>
          </>
        )}
      </main>
      <footer>
        CampusFix · First Commit
        <span>IIT Dholakpur dataset v2 · Synthetic local demonstration</span>
      </footer>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Demo />);
