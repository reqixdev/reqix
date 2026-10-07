import { createAuth, createMemoryLock, type Session } from '../../../dist/index.js';
import { startMockBackend } from '../lib/mock-backend.ts';

interface CustomSession extends Session {
  accessToken: string;
  refreshToken?: string;
  user?: { id: string; email: string; name: string };
  [key: string]: unknown;
}

async function runE2EParallelRefreshProof() {
  console.log('🚀 Starting Reqix E2E Concurrency & Refresh Verification...\n');

  // 1. Start mock JWT backend
  const mockServer = await startMockBackend();
  console.log(`[Mock Backend] Running at ${mockServer.url}`);

  try {
    let currentSession: CustomSession | null = null;

    // 2. Instantiate Reqix createAuth client
    const auth = createAuth<CustomSession>({
      getSession: () => currentSession,
      saveSession: (s) => {
        currentSession = s;
      },
      clearSession: () => {
        currentSession = null;
      },
      lock: createMemoryLock(),
      refreshBeforeExpirySec: 0,
      clockSkewSec: 0,
      refreshSession: async (session) => {
        console.log('  ⚡ [reqix] refreshSession invoked!');
        const res = await fetch(`${mockServer.url}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        });

        if (!res.ok) {
          throw new Error(`Refresh failed with status ${res.status}`);
        }

        const data = (await res.json()) as { accessToken: string; refreshToken: string };
        return {
          ...session,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        };
      },
    });

    // 3. Login to acquire initial token
    console.log('\nStep 1: Logging in to obtain initial short-lived JWT...');
    const loginRes = await fetch(`${mockServer.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
    });

    if (!loginRes.ok) {
      throw new Error(`Login failed with status ${loginRes.status}`);
    }

    const loginData = (await loginRes.json()) as {
      accessToken: string;
      refreshToken: string;
      user: { id: string; email: string; name: string };
    };

    await auth.setSession({
      accessToken: loginData.accessToken,
      refreshToken: loginData.refreshToken,
      user: loginData.user,
    });

    console.log('✅ Logged in successfully. Access token lifetime: 2 seconds.');

    // 4. Wait 2.2s for access token to expire
    console.log('⏳ Waiting 2.2 seconds for access token expiration...');
    await new Promise((resolve) => setTimeout(resolve, 2200));

    // 5. Fire 10 parallel requests simultaneously
    console.log('\nStep 2: Firing 10 concurrent requests to protected endpoint with expired token...');
    mockServer.resetStats();

    const startTime = Date.now();
    const parallelRequests = Array.from({ length: 10 }, (_, index) => {
      return auth
        .fetch(`${mockServer.url}/api/user/data`)
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(`Request ${index + 1} returned status ${res.status}`);
          }
          const json = await res.json();
          return { index: index + 1, status: res.status, json };
        });
    });

    const results = await Promise.all(parallelRequests);
    const duration = Date.now() - startTime;

    console.log(`✅ All 10 concurrent requests completed in ${duration}ms!`);

    const stats = mockServer.getStats();
    console.log(`\n📊 Backend Statistics:`);
    console.log(`   - Protected data requests received: ${stats.dataRequestCount}`);
    console.log(`   - Refresh token requests received:  ${stats.refreshCount}`);

    // Verify proof: Exactly 1 refresh for 10 parallel requests!
    if (stats.refreshCount !== 1) {
      throw new Error(
        `❌ PROOF FAILED: Expected exactly 1 refresh call, but got ${stats.refreshCount}!`
      );
    }
    if (results.length !== 10 || results.some((r) => r.status !== 200)) {
      throw new Error(`❌ PROOF FAILED: Not all requests succeeded with 200 OK.`);
    }

    console.log('\n🎉 PROOF VERIFIED: 10 parallel requests -> EXACTLY 1 token refresh!');

    // 6. Test Reactive 401 Concurrency Proof
    console.log('\nStep 3: Testing Reactive 401 fallback concurrency...');
    const sessionToRevoke = await auth.getSession();
    if (sessionToRevoke) {
      mockServer.invalidateToken(sessionToRevoke.accessToken);
    }
    mockServer.resetStats();

    console.log('   (Token revoked on server; client does not know yet)');
    console.log('   Firing 10 concurrent requests to trigger 401 -> reactive single-flight refresh...');

    const reactiveRequests = Array.from({ length: 10 }, (_, index) => {
      return auth
        .fetch(`${mockServer.url}/api/user/data`)
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(`Reactive request ${index + 1} returned ${res.status}`);
          }
          return { index: index + 1, status: res.status };
        });
    });

    const reactiveResults = await Promise.all(reactiveRequests);
    const reactiveStats = mockServer.getStats();

    console.log(`   - Reactive refresh token requests received: ${reactiveStats.refreshCount}`);
    if (reactiveStats.refreshCount !== 1) {
      throw new Error(
        `❌ REACTIVE PROOF FAILED: Expected exactly 1 refresh call, got ${reactiveStats.refreshCount}`
      );
    }
    if (reactiveResults.length !== 10) {
      throw new Error('❌ REACTIVE PROOF FAILED: Not all requests succeeded.');
    }

    console.log('🎉 REACTIVE PROOF VERIFIED: 10 concurrent 401s coalesced into EXACTLY 1 refresh!');

    // 7. Test Logout
    console.log('\nStep 4: Testing logout cleanup...');
    await auth.logout({ reason: 'manual' });
    if (currentSession !== null) {
      throw new Error('❌ LOGOUT FAILED: Session was not cleared.');
    }
    console.log('✅ Logout verified: Session cleared completely.');

    console.log('\n========================================');
    console.log('  ALL E2E CONCURRENCY CHECKS PASSED! ✨  ');
    console.log('========================================\n');
  } finally {
    await mockServer.close();
    console.log('[Mock Backend] Server closed.');
  }
}

runE2EParallelRefreshProof().catch((err) => {
  console.error('\n❌ E2E Proof Encountered Error:', err);
  process.exit(1);
});
