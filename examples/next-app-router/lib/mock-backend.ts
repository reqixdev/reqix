import http from 'node:http';

export interface MockBackendStats {
  refreshCount: number;
  loginCount: number;
  dataRequestCount: number;
}

export interface MockBackendServer {
  port: number;
  url: string;
  close: () => Promise<void>;
  getStats: () => MockBackendStats;
  resetStats: () => void;
  invalidateToken: (token: string) => void;
}

/**
 * Creates a simple base64url JWT without third-party dependencies.
 */
export function createMockJwt(claims: Record<string, unknown>, expiresInSec: number): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInSec;
  const payload = {
    ...claims,
    exp,
    iat: Math.floor(Date.now() / 1000),
    jti: Math.random().toString(36).slice(2),
  };

  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = Buffer.from('mock-sig').toString('base64url');

  return `${b64Header}.${b64Payload}.${signature}`;
}

export function startMockBackend(desiredPort = 0): Promise<MockBackendServer> {
  const stats: MockBackendStats = {
    refreshCount: 0,
    loginCount: 0,
    dataRequestCount: 0,
  };

  // refresh token -> { userId, familyId, exp }
  const refreshTokens = new Map<string, { userId: string; familyId: string; exp: number }>();
  // revoked refresh token families
  const revokedFamilies = new Set<string>();
  // revoked access tokens
  const revokedAccessTokens = new Set<string>();

  const server = http.createServer(async (req, res) => {
    // Collect body
    let bodyText = '';
    for await (const chunk of req) {
      bodyText += chunk;
    }

    let parsedBody: Record<string, unknown> = {};
    if (bodyText) {
      try {
        parsedBody = JSON.parse(bodyText);
      } catch {
        // ignore parse error
      }
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    res.setHeader('Content-Type', 'application/json');

    // CORS headers for client requests if needed
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    // Endpoints
    if (req.method === 'POST' && pathname === '/api/auth/login') {
      stats.loginCount++;
      const email = parsedBody['email'] ?? 'user@example.com';
      const userId = 'user_123';
      const familyId = `family_${Date.now()}_${Math.random()}`;

      // Access token valid for 2 seconds (short lived for testing proactive & reactive refresh)
      const accessToken = createMockJwt({ sub: userId, email }, 2);
      const refreshToken = `ref_${Date.now()}_${Math.random()}`;

      refreshTokens.set(refreshToken, {
        userId,
        familyId,
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          accessToken,
          refreshToken,
          user: { id: userId, email, name: 'Demo User' },
        })
      );
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/refresh') {
      stats.refreshCount++;
      const incomingRefreshToken = (parsedBody['refreshToken'] as string) ?? '';
      const session = refreshTokens.get(incomingRefreshToken);

      if (!session) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'invalid_grant', message: 'Unknown refresh token' }));
        return;
      }

      if (revokedFamilies.has(session.familyId)) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'invalid_grant', message: 'Token family revoked' }));
        return;
      }

      // Rotate refresh token
      refreshTokens.delete(incomingRefreshToken);
      const newRefreshToken = `ref_${Date.now()}_${Math.random()}`;
      refreshTokens.set(newRefreshToken, {
        userId: session.userId,
        familyId: session.familyId,
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      // Issue new access token (expires in 2 seconds)
      const newAccessToken = createMockJwt({ sub: session.userId, email: 'user@example.com' }, 2);

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        })
      );
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      const incomingRefreshToken = (parsedBody['refreshToken'] as string) ?? '';
      const session = refreshTokens.get(incomingRefreshToken);
      if (session) {
        revokedFamilies.add(session.familyId);
        refreshTokens.delete(incomingRefreshToken);
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true }));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/user/data') {
      stats.dataRequestCount++;
      const authHeader = req.headers['authorization'] ?? '';
      if (!authHeader.startsWith('Bearer ')) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Unauthorized', message: 'Missing Bearer token' }));
        return;
      }

      const token = authHeader.slice(7);
      if (revokedAccessTokens.has(token)) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Unauthorized', message: 'Token revoked' }));
        return;
      }

      // Parse JWT payload exp
      try {
        const parts = token.split('.');
        if (parts.length !== 3 || !parts[1]) {
          throw new Error('Invalid JWT format');
        }
        const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
        const payload = JSON.parse(payloadJson);
        const exp = payload.exp as number;
        const now = Math.floor(Date.now() / 1000);

        if (exp && exp <= now) {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: 'Unauthorized', message: 'Token expired' }));
          return;
        }

        // Add 25ms artificial latency so concurrent requests overlap in time
        await new Promise((resolve) => setTimeout(resolve, 25));

        res.statusCode = 200;
        res.end(
          JSON.stringify({
            data: 'Protected data response',
            sub: payload.sub,
            timestamp: Date.now(),
          })
        );
        return;
      } catch {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Unauthorized', message: 'Malformed token' }));
        return;
      }
    }

    if (req.method === 'GET' && pathname === '/api/stats') {
      res.statusCode = 200;
      res.end(JSON.stringify(stats));
      return;
    }

    // Default 404
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  return new Promise((resolve) => {
    server.listen(desiredPort, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : desiredPort;
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((err) => (err ? closeReject(err) : closeResolve()));
          }),
        getStats: () => ({ ...stats }),
        resetStats: () => {
          stats.refreshCount = 0;
          stats.loginCount = 0;
          stats.dataRequestCount = 0;
        },
        invalidateToken: (token: string) => {
          revokedAccessTokens.add(token);
        },
      });
    });
  });
}
