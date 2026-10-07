'use client';

import React, { useState } from 'react';

export interface LoginFormProps {
  onSuccess?: () => void;
  redirectTo?: string;
  className?: string;
}

export function LoginForm({ onSuccess, redirectTo = '/dashboard', className }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(errorData.message || `Login failed with status ${res.status}`);
      }

      if (onSuccess) {
        onSuccess();
      } else if (typeof window !== 'undefined') {
        window.location.href = redirectTo;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        width: '100%',
        maxWidth: '400px',
      }}
    >
      <div>
        <label
          htmlFor="email"
          style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}
        >
          Email address
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          placeholder="Enter your email"
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
            border: '1px solid #d1d5db',
            fontSize: '0.95rem',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div>
        <label
          htmlFor="password"
          style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          placeholder="••••••••"
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
            border: '1px solid #d1d5db',
            fontSize: '0.95rem',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
            background: '#fee2e2',
            color: '#b91c1c',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        style={{
          padding: '0.65rem 1rem',
          borderRadius: '6px',
          background: '#2563eb',
          color: '#ffffff',
          fontWeight: 600,
          border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1,
          marginTop: '0.5rem',
        }}
      >
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  );
}
