export {
  createAuth,
  publicFetch,
} from './create-auth.js';

export {
  AuthError,
  isAuthError,
} from './types.js';

export type {
  Session,
  LogoutReason,
  RefreshLock,
  AuthOptions,
  Auth,
  AuthErrorCode,
} from './types.js';

export {
  decodeJwtExp,
  isNearExpiry,
  getSessionExpiry,
  isValidSession,
} from './session.js';

export {
  SingleFlight,
} from './single-flight.js';

export {
  EventEmitter,
} from './events.js';

export {
  createWebLock,
  createMemoryLock,
  createNoopLock,
  CrossTabSync,
} from './locks.js';
export type {
  CrossTabMessage,
} from './locks.js';
