import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Reqix Next.js App Router Example',
  description: 'Headless, server-first auth and fetch demo with rotating JWT tokens',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <style>{`
          :root {
            --bg-primary: #0a0c10;
            --bg-secondary: #12161f;
            --bg-card: rgba(22, 27, 34, 0.7);
            --border: rgba(255, 255, 255, 0.1);
            --text-primary: #f0f6fc;
            --text-secondary: #8b949e;
            --accent: #58a6ff;
            --accent-gradient: linear-gradient(135deg, #388bfd 0%, #a371f7 100%);
            --success: #3fb950;
            --error: #f85149;
          }

          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }

          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background-color: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
          }

          header {
            border-bottom: 1px solid var(--border);
            backdrop-filter: blur(12px);
            background: rgba(10, 12, 16, 0.8);
            position: sticky;
            top: 0;
            z-index: 50;
          }

          .nav-container {
            max-width: 1100px;
            margin: 0 auto;
            padding: 1rem 1.5rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          .logo-badge {
            font-weight: 700;
            font-size: 1.15rem;
            letter-spacing: -0.02em;
            background: var(--accent-gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }

          .nav-links {
            display: flex;
            gap: 1.25rem;
            align-items: center;
          }

          .nav-links a {
            color: var(--text-secondary);
            text-decoration: none;
            font-size: 0.9rem;
            font-weight: 500;
            transition: color 0.15s ease;
          }

          .nav-links a:hover {
            color: var(--text-primary);
          }

          main {
            flex: 1;
            max-width: 1100px;
            width: 100%;
            margin: 0 auto;
            padding: 2.5rem 1.5rem;
          }

          footer {
            border-top: 1px solid var(--border);
            padding: 1.5rem;
            text-align: center;
            font-size: 0.85rem;
            color: var(--text-secondary);
          }

          code, pre {
            font-family: 'JetBrains Mono', monospace;
          }
        `}</style>
      </head>
      <body>
        <header>
          <div className="nav-container">
            <a href="/" className="logo-badge">
              <span>⚡ Reqix</span>
            </a>
            <nav className="nav-links">
              <a href="/">Overview</a>
              <a href="/dashboard">Dashboard (RSC)</a>
              <a href="/api/auth/login">Auth Endpoints</a>
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer>
          <p>Built with Reqix • Headless, server-first auth & fetch orchestration</p>
        </footer>
      </body>
    </html>
  );
}
