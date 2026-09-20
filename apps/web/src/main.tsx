import { workspacePath } from './deployment';
import { IssueWorkspace } from './issues';
import { StrictMode, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  campusPageSchema,
  membershipSchema,
  profileSchema,
  profileSyncSchema,
  type CampusSummary,
  type Membership,
  type Profile,
} from '@campusfix/contracts';
import { authConfig, beginSignIn, completeSignIn, signOut } from './auth';
import { api, RequestError } from './api';
import './styles.css';

const config = authConfig(import.meta.env);
function navigate(path: string) {
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
function App() {
  const [route, setPath] = useState(workspacePath(location)),
    [profile, setProfile] = useState<Profile>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [needsProfile, setNeedsProfile] = useState(false);
  const path = route.split('?')[0]!;
  const [campuses, setCampuses] = useState<CampusSummary[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [membership, setMembership] = useState<Membership>(),
    [selectedCampus, setSelectedCampus] = useState<CampusSummary>();
  const [name, setName] = useState('');
  const profileKey = useRef(crypto.randomUUID());
  const requestGeneration = useRef(0);
  const resetCampus = () => {
    requestGeneration.current++;
    setMembership(undefined);
    setSelectedCampus(undefined);
    setCampuses([]);
    setCursor(null);
  };
  useEffect(() => {
    const onRoute = () => {
      setPath(workspacePath(location));
      setError('');
    };
    const expired = () => {
      resetCampus();
      setProfile(undefined);
      setNeedsProfile(false);
      navigate('/');
      setError('Your session expired. Sign in again.');
    };
    window.addEventListener('popstate', onRoute);
    window.addEventListener('campusfix:session-ended', expired);
    return () => {
      window.removeEventListener('popstate', onRoute);
      window.removeEventListener('campusfix:session-ended', expired);
    };
  }, []);
  async function loadCampuses(next?: string) {
    const generation = requestGeneration.current;
    setLoading(true);
    setError('');
    try {
      const page = await api(
        `/me/campuses${next ? `?cursor=${encodeURIComponent(next)}` : ''}`,
        campusPageSchema,
      );
      if (generation !== requestGeneration.current) return;
      setCampuses((old) =>
        next ? [...old, ...page.items.filter((i) => !old.some((o) => o.id === i.id))] : page.items,
      );
      setCursor(page.nextCursor);
    } catch (e) {
      if (generation === requestGeneration.current) setError(message(e));
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (path !== '/auth/callback') return;
    if (!config) {
      setError('Campus sign-in has not been configured yet.');
      return;
    }
    let current = true;
    setLoading(true);
    completeSignIn(config)
      .then(async () => {
        try {
          const saved = await api('/me', profileSchema);
          if (!current) return;
          const me = await api('/me', profileSchema, {
            method: 'PUT',
            headers: { 'Idempotency-Key': crypto.randomUUID() },
            body: JSON.stringify({ displayName: saved.displayName }),
          });
          if (current) {
            setProfile(me);
            setName(me.displayName);
            setLoading(false);
            navigate('/campuses');
          }
        } catch (e) {
          if (current && e instanceof RequestError && e.code === 'PROFILE_REQUIRED') {
            setNeedsProfile(true);
            setLoading(false);
            navigate('/account');
          } else throw e;
        }
      })
      .catch((e) => {
        if (current) setError(message(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [path]);
  useEffect(() => {
    if (path === '/campuses' && profile) void loadCampuses();
  }, [path, profile]);
  async function login() {
    setError('');
    try {
      if (config) await beginSignIn(config);
      else setError('Campus sign-in has not been configured yet.');
    } catch (e) {
      setError(message(e));
    }
  }
  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    const parsed = profileSyncSchema.safeParse({ displayName: name });
    if (!parsed.success) {
      setError('Enter a name between 1 and 80 characters.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const me = await api('/me', profileSchema, {
        method: 'PUT',
        headers: { 'Idempotency-Key': profileKey.current },
        body: JSON.stringify(parsed.data),
      });
      setProfile(me);
      setNeedsProfile(false);
      profileKey.current = crypto.randomUUID();
      navigate('/campuses');
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  async function openCampus(campus: CampusSummary) {
    resetCampus();
    const generation = requestGeneration.current;
    setLoading(true);
    setError('');
    try {
      const m = await api(`/campuses/${campus.id}/membership`, membershipSchema);
      if (generation !== requestGeneration.current) return;
      setMembership(m);
      setSelectedCampus(campus);
      navigate(
        `/c/${campus.id}/${m.status === 'ACTIVE' && campus.status === 'ACTIVE' ? 'issues' : 'membership'}`,
      );
    } catch (e) {
      if (generation === requestGeneration.current) setError(message(e));
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }
  function logout() {
    resetCampus();
    setProfile(undefined);
    setNeedsProfile(false);
    signOut(config);
  }
  const isAccount = path === '/account' && (profile || needsProfile);
  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="header">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate(profile ? '/campuses' : '/');
          }}
        >
          <span className="brand-icon">C</span>CampusFix
        </a>
        <nav aria-label="Account">
          {profile ? (
            <>
              <button
                className="text-button"
                onClick={() => {
                  resetCampus();
                  navigate('/campuses');
                }}
              >
                My campuses
              </button>
              <button className="text-button" onClick={() => navigate('/account')}>
                {profile.displayName}
              </button>
              <button className="secondary" onClick={logout}>
                Sign out
              </button>
            </>
          ) : (
            <span className="badge">Campus accountability</span>
          )}
        </nav>
      </header>
      <main id="main" aria-busy={loading}>
        {error && (
          <div className="notice error" role="alert">
            <strong>Something needs attention</strong>
            <p>{error}</p>
            {path === '/auth/callback' && (
              <button onClick={() => void login()}>Restart sign-in</button>
            )}
          </div>
        )}
        {path === '/auth/callback' ? (
          <section className="page">
            <p className="eyebrow">Secure sign-in</p>
            <h1>Checking your account.</h1>
            <p>Verifying your session before opening campus information.</p>
            {loading && <p role="status">Signing you in…</p>}
          </section>
        ) : isAccount ? (
          <section className="page narrow">
            <p className="eyebrow">Your account</p>
            <h1>{needsProfile ? 'Introduce yourself.' : 'Account details.'}</h1>
            <p>
              Your college verifies your campus access. Your name does not grant a role or group
              membership.
            </p>
            <form onSubmit={saveProfile}>
              <label htmlFor="displayName">Display name</label>
              <input
                id="displayName"
                autoComplete="name"
                value={name}
                maxLength={80}
                required
                onChange={(e) => {
                  setName(e.target.value);
                  profileKey.current = crypto.randomUUID();
                }}
              />
              <p className="hint">Use the name students and staff know you by.</p>
              {profile && (
                <p>
                  Verified email: <strong>{profile.verifiedEmail}</strong>
                </p>
              )}
              <button disabled={loading} type="submit">
                {loading ? 'Saving…' : 'Save and continue'}
              </button>
            </form>
          </section>
        ) : path === '/campuses' && profile ? (
          <section className="page">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Your workspace</p>
                <h1>Choose your campus.</h1>
              </div>
              <button className="secondary" disabled={loading} onClick={() => void loadCampuses()}>
                Refresh access
              </button>
            </div>
            <p>Each campus has its own members, handling teams and visibility rules.</p>
            {loading && <p role="status">Loading your current memberships…</p>}
            <div className="card-grid">
              {campuses.map((c) => (
                <article className="card" key={c.id}>
                  <span className="status-label">{c.membershipStatus.toLowerCase()}</span>
                  <h2>{c.name}</h2>
                  <p>
                    {c.status === 'ACTIVE'
                      ? 'Your verified campus workspace'
                      : 'This campus is not currently active.'}
                  </p>
                  <button disabled={loading} onClick={() => void openCampus(c)}>
                    {c.membershipStatus === 'ACTIVE'
                      ? 'View campus access'
                      : 'View membership status'}
                  </button>
                </article>
              ))}
            </div>
            {!loading && !campuses.length && !error && (
              <div className="empty">
                <h2>No campus membership yet.</h2>
                <p>
                  Ask your college representative to approve your account. Campus joining and
                  invitations are the next implementation step.
                </p>
              </div>
            )}
            {cursor && (
              <button
                className="secondary"
                disabled={loading}
                onClick={() => void loadCampuses(cursor)}
              >
                Load more campuses
              </button>
            )}
          </section>
        ) : membership &&
          selectedCampus &&
          membership.status === 'ACTIVE' &&
          path.startsWith(`/c/${selectedCampus.id}/`) &&
          !path.endsWith('/membership') ? (
          <IssueWorkspace
            key={selectedCampus.id}
            campus={selectedCampus}
            membership={membership}
            path={route}
            navigate={navigate}
          />
        ) : membership && selectedCampus && path.endsWith('/membership') ? (
          <MembershipView
            membership={membership}
            campus={selectedCampus}
            refresh={() => void openCampus(selectedCampus)}
            busy={loading}
          />
        ) : (
          <>
            <section className="hero">
              <p className="eyebrow">A more accountable campus</p>
              <h1>
                Every concern.
                <br />A clear next step.
              </h1>
              <p className="intro">
                Report campus issues, reach the right team, and follow a concern through to a
                confirmed resolution.
              </p>
              <div className="actions">
                <button onClick={() => void login()}>
                  {profile ? 'Continue with your account' : 'Sign in to your campus'}
                </button>
                <span className="hint">Your college account. Your campus community.</span>
              </div>
              {!config && (
                <div className="notice">
                  <strong>Development setup</strong>
                  <p>
                    The app is running. A Cognito user pool must be configured before real accounts
                    can sign in.
                  </p>
                </div>
              )}
            </section>
            <section className="foundation">
              <div>
                <p className="eyebrow">Built around accountability</p>
                <h2>A report should lead somewhere.</h2>
                <p>
                  CampusFix connects student concerns to a responsible team, with a visible record
                  of replies and progress.
                </p>
              </div>
              <ol className="steps">
                <li>
                  <span>01</span>
                  <div>
                    <strong>The right audience</strong>
                    <p>Hostel and department concerns stay within their permitted groups.</p>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <strong>A named owner</strong>
                    <p>Every published issue has someone responsible for its next step.</p>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <strong>A confirmed outcome</strong>
                    <p>The reporting student confirms whether the proposed fix worked.</p>
                  </div>
                </li>
              </ol>
            </section>
          </>
        )}
      </main>
      <footer>
        CampusFix · AWS First Commit <span>Hackathon demo · Accountability core</span>
      </footer>
    </div>
  );
}
function MembershipView({
  membership: m,
  campus,
  refresh,
  busy,
}: {
  membership: Membership;
  campus: CampusSummary;
  refresh: () => void;
  busy: boolean;
}) {
  const expired = !!m.expiresAt && Date.parse(m.expiresAt) <= Date.now();
  const active = m.status === 'ACTIVE' && !expired && campus.status === 'ACTIVE';
  return (
    <section className="page">
      <p className="eyebrow">{campus.name}</p>
      <h1>
        {active
          ? 'Your campus access.'
          : m.status === 'PENDING'
            ? 'Your approval is pending.'
            : 'Campus access is unavailable.'}
      </h1>
      <p>
        {active
          ? 'Your membership has been loaded from the current campus record.'
          : m.status === 'PENDING'
            ? 'Your college representative must approve your membership before you can open campus information.'
            : 'Contact your college representative to review your membership.'}
      </p>
      <div className="card">
        <dl>
          <dt>Membership</dt>
          <dd>{expired ? 'Expired' : m.status.toLowerCase()}</dd>
          <dt>Approved groups</dt>
          <dd>{m.groupIds.length}</dd>
          <dt>Current roles</dt>
          <dd>
            {m.roles
              .filter((r) => Date.parse(r.expiresAt) > Date.now())
              .map((r) => r.role.toLowerCase().replaceAll('_', ' '))
              .join(', ') || 'No additional roles'}
          </dd>
        </dl>
        <button className="secondary" disabled={busy} onClick={refresh}>
          Check access again
        </button>
      </div>
      {active && (
        <div className="notice">
          <strong>Issue reporting is available.</strong>
          <p>Use the campus selector to open the reporting workspace.</p>
        </div>
      )}
    </section>
  );
}
function message(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please retry.';
}
const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing.');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
