/**
 * SingleFlight coordinates asynchronous operations to ensure that multiple
 * concurrent callers deduplicate execution and share the exact same in-flight Promise.
 */
export class SingleFlight<T> {
  private activeToken: object | null = null;
  private inFlightPromise: Promise<T> | null = null;

  /**
   * Executes `fn` if no operation is currently running, or returns the existing in-flight Promise.
   */
  async do(fn: () => Promise<T>): Promise<T> {
    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }

    const currentToken = {};
    this.activeToken = currentToken;

    this.inFlightPromise = (async () => {
      try {
        return await fn();
      } finally {
        if (this.activeToken === currentToken) {
          this.activeToken = null;
          this.inFlightPromise = null;
        }
      }
    })();

    return this.inFlightPromise;
  }

  /**
   * Resets the active in-flight promise immediately.
   * Note: The underlying running task may continue, but callers after reset will trigger a new flight.
   */
  reset(): void {
    this.activeToken = null;
    this.inFlightPromise = null;
  }

  /**
   * Returns whether a single-flight operation is currently executing.
   */
  isInFlight(): boolean {
    return this.inFlightPromise !== null;
  }
}
