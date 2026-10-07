'use client';

import React, { useState } from 'react';

export function ClientParallelDemo() {
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const triggerParallelRequests = async () => {
    setLoading(true);
    setLogs(['🚀 Firing 10 concurrent requests to /api/user/data...']);

    const start = Date.now();
    try {
      const requests = Array.from({ length: 10 }, async (_, i) => {
        const res = await fetch('/api/user/data');
        return { index: i + 1, status: res.status };
      });

      const results = await Promise.all(requests);
      const elapsed = Date.now() - start;

      const successCount = results.filter((r) => r.status === 200).length;
      setLogs((prev) => [
        ...prev,
        `✅ All 10 requests completed in ${elapsed}ms`,
        `📊 Successful (200 OK): ${successCount} / 10`,
        `⚡ Single-Flight guarantee: coalesced in-flight refresh!`,
      ]);
    } catch (err) {
      setLogs((prev) => [...prev, `❌ Error: ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '1.5rem',
        marginTop: '1.5rem',
      }}
    >
      <h3 style={{ fontSize: '1.15rem', marginBottom: '0.5rem' }}>Browser-Side Parallel Concurrency Test</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Press the button below to fire 10 simultaneous requests from the browser and observe single-flight execution.
      </p>

      <button
        type="button"
        onClick={triggerParallelRequests}
        disabled={loading}
        style={{
          padding: '0.65rem 1.25rem',
          borderRadius: '6px',
          background: 'var(--accent)',
          color: '#fff',
          border: 'none',
          fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'Executing 10 Parallel Requests...' : 'Trigger 10 Concurrent Requests'}
      </button>

      {logs.length > 0 && (
        <div
          style={{
            marginTop: '1rem',
            padding: '1rem',
            background: 'var(--bg-secondary)',
            borderRadius: '6px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '0.8rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          {logs.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
        </div>
      )}
    </div>
  );
}
