import React from 'react';
import { redirect } from 'next/navigation';
import { getAppAuth } from '@/lib/auth';
import { ClientParallelDemo } from './client-parallel';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const auth = getAppAuth();
  const session = await auth.getSession();

  if (!session) {
    redirect('/?error=unauthorized');
  }

  // Fetch protected data inside the Server Component using auth.fetch
  const backendUrl = process.env['AUTH_BACKEND_URL'] || 'http://127.0.0.1:4000';
  let protectedData: Record<string, unknown> | null = null;
  let fetchError: string | null = null;

  try {
    const res = await auth.fetch(`${backendUrl}/api/user/data`);
    if (res.ok) {
      protectedData = (await res.json()) as Record<string, unknown>;
    } else {
      fetchError = `Backend returned HTTP ${res.status}`;
    }
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.85rem', fontWeight: 700 }}>Server Component Dashboard</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Rendered on the server with <code>getServerAuth()</code> and React <code>cache()</code>.
          </p>
        </div>
        <a
          href="/"
          style={{
            color: 'var(--accent)',
            fontSize: '0.9rem',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          ← Return Home
        </a>
      </div>

      {/* Session State Card */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '1.5rem',
        }}
      >
        <h2 style={{ fontSize: '1.15rem', marginBottom: '0.75rem' }}>Active Session Details</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.9rem' }}>
          <div>
            <span style={{ color: 'var(--text-secondary)' }}>User: </span>
            <strong>{session.user?.name ?? 'Authenticated User'}</strong> ({session.user?.email ?? 'N/A'})
          </div>
          <div>
            <span style={{ color: 'var(--text-secondary)' }}>Access Token: </span>
            <code style={{ background: 'var(--bg-secondary)', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>
              {session.accessToken ? `${session.accessToken.slice(0, 16)}...` : 'Missing'}
            </code>
          </div>
          <div>
            <span style={{ color: 'var(--text-secondary)' }}>Refresh Token: </span>
            <code style={{ background: 'var(--bg-secondary)', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>
              {session.refreshToken ? `${session.refreshToken.slice(0, 16)}...` : 'Not present'}
            </code>
          </div>
        </div>
      </div>

      {/* Protected Backend Data Card */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '1.5rem',
        }}
      >
        <h2 style={{ fontSize: '1.15rem', marginBottom: '0.75rem' }}>Server-Fetched Protected Data</h2>
        {fetchError ? (
          <div style={{ color: 'var(--error)', fontSize: '0.9rem' }}>
            ⚠️ Failed to fetch backend data: {fetchError}
          </div>
        ) : (
          <pre
            style={{
              background: 'var(--bg-secondary)',
              padding: '1rem',
              borderRadius: '6px',
              fontSize: '0.85rem',
              overflowX: 'auto',
            }}
          >
            {JSON.stringify(protectedData, null, 2)}
          </pre>
        )}
      </div>

      {/* Client Parallel Demo */}
      <ClientParallelDemo />
    </div>
  );
}
