'use client';

import React, { useState } from 'react';

export default function HomePage() {
  const [email, setEmail] = useState('demo@example.com');
  const [password, setPassword] = useState('password123');
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        throw new Error(`Login failed with HTTP ${res.status}`);
      }

      setStatus('✅ Successfully authenticated! Cookies are now stored securely.');
    } catch (err) {
      setStatus(`❌ ${err instanceof Error ? err.message : 'Login failed'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setStatus('🚪 Logged out successfully. Cookies cleared.');
    } catch {
      setStatus('❌ Logout request failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <section style={{ textAlign: 'center', padding: '2rem 0 1rem' }}>
        <h1
          style={{
            fontSize: '2.5rem',
            fontWeight: 800,
            letterSpacing: '-0.03em',
            marginBottom: '0.75rem',
          }}
        >
          Headless Server-First Auth for Next.js
        </h1>
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: '1.1rem',
            maxWidth: '650px',
            margin: '0 auto',
          }}
        >
          Production-grade JWT refresh orchestration with zero runtime dependencies.
          Guaranteed single-flight concurrency, proactive Edge middleware refresh, and RSC token deduplication.
        </p>
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '1.5rem',
        }}
      >
        {/* Login Panel */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '1.75rem',
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Authentication Console</h2>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '6px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '6px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                type="submit"
                disabled={loading}
                style={{
                  flex: 1,
                  padding: '0.7rem 1rem',
                  borderRadius: '6px',
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Authenticating...' : 'Sign In'}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                disabled={loading}
                style={{
                  padding: '0.7rem 1rem',
                  borderRadius: '6px',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Log Out
              </button>
            </div>
          </form>

          {status && (
            <div
              style={{
                marginTop: '1.25rem',
                padding: '0.75rem 1rem',
                borderRadius: '6px',
                background: 'var(--bg-secondary)',
                fontSize: '0.85rem',
                border: '1px solid var(--border)',
              }}
            >
              {status}
            </div>
          )}
        </div>

        {/* Protected Navigation & Features */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '1.75rem',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>Protected Dashboard (RSC)</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              Navigate to the server-rendered dashboard to test token extraction, Edge middleware proactive refresh,
              and Server Component data fetching using <code>getServerAuth()</code>.
            </p>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.9rem' }}>
              <li>🔒 <strong>Server Components:</strong> Token is read directly from cookies.</li>
              <li>⚡ <strong>Single-Flight:</strong> Parallel component fetches share 1 refresh.</li>
              <li>🛡️ <strong>Open-Redirect:</strong> Validated redirect after authentication.</li>
            </ul>
          </div>
          <a
            href="/dashboard"
            style={{
              display: 'inline-block',
              textAlign: 'center',
              marginTop: '1.5rem',
              padding: '0.75rem 1.25rem',
              borderRadius: '6px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              color: 'var(--accent)',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            Go to Protected Dashboard →
          </a>
        </div>
      </div>
    </div>
  );
}
