import { describe, it, expect } from 'vitest';
import { createMemoryLock, createNoopLock } from '../../src/auth/locks.js';

describe('Auth Locks', () => {
  it('noop lock executes immediately', async () => {
    const lock = createNoopLock();
    const res = await lock.run('test-key', async () => 'hello');
    expect(res).toBe('hello');
  });

  it('memory lock serializes concurrent executions under the same key', async () => {
    const lock = createMemoryLock();
    const executionOrder: number[] = [];

    const task1 = lock.run('shared-key', async () => {
      await new Promise((r) => setTimeout(r, 20));
      executionOrder.push(1);
      return 1;
    });

    const task2 = lock.run('shared-key', async () => {
      executionOrder.push(2);
      return 2;
    });

    await Promise.all([task1, task2]);
    // Task 1 was started first; Task 2 must wait for Task 1
    expect(executionOrder).toEqual([1, 2]);
  });
});
