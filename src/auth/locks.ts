import type { RefreshLock } from './types.js';

/**
 * No-op lock that executes the provided callback immediately.
 */
export function createNoopLock(): RefreshLock {
  return {
    run<T>(_key: string, fn: () => Promise<T>): Promise<T> {
      return fn();
    },
  };
}

/**
 * In-memory sequential mutex lock for single-process environments and tests.
 */
export function createMemoryLock(): RefreshLock {
  const queues = new Map<string, Promise<unknown>>();

  return {
    async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const currentQueue = queues.get(key) || Promise.resolve();

      let resolveNext!: () => void;
      const nextPromise = new Promise<void>((resolve) => {
        resolveNext = resolve;
      });

      queues.set(key, nextPromise);

      await currentQueue.catch(() => {});

      try {
        return await fn();
      } finally {
        resolveNext();
        if (queues.get(key) === nextPromise) {
          queues.delete(key);
        }
      }
    },
  };
}

/**
 * Creates a lock utilizing the Web Locks API (navigator.locks.request) if available in browser environments,
 * falling back to an in-memory lock otherwise.
 */
export function createWebLock(): RefreshLock {
  const memoryFallback = createMemoryLock();

  return {
    async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      if (
        typeof navigator !== 'undefined' &&
        'locks' in navigator &&
        typeof navigator.locks?.request === 'function'
      ) {
        return new Promise<T>((resolve, reject) => {
          navigator.locks.request(key, async () => {
            try {
              const result = await fn();
              resolve(result);
            } catch (err) {
              reject(err);
            }
          });
        });
      }

      return memoryFallback.run(key, fn);
    },
  };
}

export interface CrossTabMessage<T> {
  type: 'session_change' | 'logout';
  payload?: T;
  timestamp: number;
}

/**
 * Safe BroadcastChannel manager for cross-tab synchronization in browser environments.
 * Returns a no-op implementation when BroadcastChannel is not supported or when running server-side.
 */
export class CrossTabSync<T> {
  private channel: BroadcastChannel | null = null;

  constructor(channelName = 'reqix_auth_sync', onMessage?: (msg: CrossTabMessage<T>) => void) {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(channelName);
        if (onMessage) {
          this.channel.onmessage = (event: MessageEvent<CrossTabMessage<T>>) => {
            if (event.data && typeof event.data === 'object' && event.data.type) {
              onMessage(event.data);
            }
          };
        }
      } catch {
        this.channel = null;
      }
    }
  }

  post(type: 'session_change' | 'logout', payload?: T): void {
    if (this.channel) {
      try {
        this.channel.postMessage({
          type,
          payload,
          timestamp: Date.now(),
        });
      } catch {
        // Ignore channel communication errors
      }
    }
  }

  close(): void {
    if (this.channel) {
      try {
        this.channel.close();
      } catch {
        // Ignore close errors
      }
      this.channel = null;
    }
  }
}
