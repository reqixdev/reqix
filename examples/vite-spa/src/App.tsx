import { useState } from 'react';
import { useSession, useAuthFetch } from 'reqix/react';
import { auth, type SpaSession } from './auth';

export function App() {
  const { session, isAuthenticated, loading } = useSession(auth);
  const authFetch = useAuthFetch(auth);

  const [message, setMessage] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(false);

  const handleSimulateLogin = async () => {
    const fakeSession: SpaSession = {
      accessToken: `mock_jwt_access_${Date.now()}`,
      refreshToken: `mock_refresh_${Date.now()}`,
      expiresAt: Date.now() + 60_000,
      user: {
        id: 'usr_987',
        name: 'Alice Henderson',
      },
    };
    await auth.setSession(fakeSession);
    setMessage('✅ Logged in successfully!');
  };

  const handleLogout = async () => {
    await auth.logout({ reason: 'manual' });
    setMessage('👋 Logged out.');
  };

  const handleFetchProtected = async () => {
    setInFlight(true);
    setMessage(null);
    try {
      const res = await authFetch('https://httpbin.org/get');
      if (res.ok) {
        setMessage('✅ Protected request succeeded with fresh Bearer token!');
      } else {
        setMessage(`⚠️ Server responded with HTTP ${res.status}`);
      }
    } catch (err) {
      setMessage(`❌ Fetch error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInFlight(false);
    }
  };

  return (
    <div
      style={{
        maxWidth: '720px',
        margin: '3rem auto',
        padding: '0 1.5rem',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#1a1f36',
      }}
    >
      <header style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2.25rem', fontWeight: 800, margin: '0 0 0.5rem', color: '#0f172a' }}>
          ⚡ Reqix React SPA Demo
        </h1>
        <p style={{ color: '#64748b', fontSize: '1.05rem', margin: 0 }}>
          Client-side React SPA demonstrating <code>useSession</code> and <code>useAuthFetch</code>.
        </p>
      </header>

      <div
        style={{
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '1.75rem',
          background: '#ffffff',
          boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', margin: '0 0 0.25rem' }}>Auth State</h2>
            <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0 }}>
              Synced with <code>useSession(auth)</code> hook
            </p>
          </div>
          <span
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: '999px',
              fontSize: '0.8rem',
              fontWeight: 600,
              background: loading ? '#f1f5f9' : isAuthenticated ? '#dcfce7' : '#fee2e2',
              color: loading ? '#64748b' : isAuthenticated ? '#15803d' : '#b91c1c',
            }}
          >
            {loading ? 'Loading...' : isAuthenticated ? 'Authenticated' : 'Unauthenticated'}
          </span>
        </div>

        {isAuthenticated && session?.user ? (
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '1rem',
              marginBottom: '1.5rem',
              fontSize: '0.9rem',
            }}
          >
            <p style={{ margin: '0 0 0.4rem' }}>
              <strong>User:</strong> {session.user.name} ({session.user.email})
            </p>
            <p style={{ margin: 0, wordBreak: 'break-all' }}>
              <strong>Token:</strong>{' '}
              <code style={{ background: '#e2e8f0', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                {session.accessToken}
              </code>
            </p>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {!isAuthenticated ? (
            <button
              onClick={handleSimulateLogin}
              style={{
                padding: '0.65rem 1.25rem',
                borderRadius: '6px',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Sign In (Mock Session)
            </button>
          ) : (
            <>
              <button
                onClick={handleFetchProtected}
                disabled={inFlight}
                style={{
                  padding: '0.65rem 1.25rem',
                  borderRadius: '6px',
                  background: '#059669',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 600,
                  cursor: inFlight ? 'not-allowed' : 'pointer',
                }}
              >
                {inFlight ? 'Fetching...' : 'Fetch with useAuthFetch()'}
              </button>
              <button
                onClick={handleLogout}
                style={{
                  padding: '0.65rem 1.25rem',
                  borderRadius: '6px',
                  background: '#f1f5f9',
                  color: '#475569',
                  border: '1px solid #cbd5e1',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Log Out
              </button>
            </>
          )}
        </div>

        {message && (
          <div
            style={{
              marginTop: '1.25rem',
              padding: '0.75rem 1rem',
              borderRadius: '6px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              fontSize: '0.9rem',
            }}
          >
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
