/**
 * Lightweight, typed subscription manager with zero dependencies.
 */
export class EventEmitter<T> {
  private listeners = new Set<(value: T) => void>();

  /**
   * Subscribes a listener function and returns an unsubscribe function.
   */
  subscribe(fn: (value: T) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /**
   * Emits a value to all registered listeners.
   * Catches errors in individual listeners so one error cannot crash others.
   */
  emit(value: T): void {
    for (const listener of this.listeners) {
      try {
        listener(value);
      } catch (err) {
        // Individual subscriber errors must never break the notification loop
        if (typeof console !== 'undefined' && console.error) {
          console.error('[reqix] Error in session subscriber:', err);
        }
      }
    }
  }

  /**
   * Removes all listeners.
   */
  clear(): void {
    this.listeners.clear();
  }

  get size(): number {
    return this.listeners.size;
  }
}
