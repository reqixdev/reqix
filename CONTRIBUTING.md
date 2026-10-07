# Contributing to reqix

Thank you for your interest in contributing to `reqix`! We welcome contributions, bug reports, and suggestions.

---

## Code of Conduct

Please be respectful, constructive, and empathetic in all interactions across issues, pull requests, and discussions.

---

## Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/reqixdev/reqix.git
   cd reqix
   ```

2. **Install dependencies:**
   `reqix` uses `pnpm` (version 9+ or 10+ recommended) and Node.js >= 18.0.0.
   ```bash
   pnpm install
   ```

3. **Verify the environment:**
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test:coverage
   pnpm build
   ```

---

## Quality & Architectural Constraints

When writing or modifying code in `reqix`, ensure you uphold the following core principles:

1. **Zero Runtime Dependencies in Core:**
   - The core library (`reqix`) must have 0 external runtime dependencies. Dev and peer dependencies (Next.js, React) are strictly optional and isolated to `./next` and `./react`.
2. **Strict TypeScript:**
   - `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
   - Never use `any` in public API types. Use generics or `unknown`.
3. **No TODOs or Placeholder Code:**
   - Every file must be complete, functional, and covered with unit tests.
4. **Token Security:**
   - Sensitive tokens (`accessToken`, `refreshToken`, `Authorization`, `Cookie`) must NEVER be leaked in log outputs, serialized error objects, or stack traces.
5. **High Test Coverage:**
   - Maintain >= 90% line coverage on `/auth` and `/core`.

---

## Workflow & Scripts

- `pnpm build`: Bundles ESM, CJS, and TypeScript declarations using `tsup`.
- `pnpm test`: Runs Vitest test suite.
- `pnpm test:coverage`: Generates code coverage report.
- `pnpm typecheck`: Validates TypeScript types across `src/` and `tests/`.
- `pnpm lint`: Lints codebase using ESLint with `@typescript-eslint`.
- `pnpm format`: Formats code using Prettier.

### Running Examples

- Next.js App Router Example:
  ```bash
  cd examples/next-app-router
  pnpm dev
  ```

- E2E Parallel Refresh Concurrency Proof:
  ```bash
  node --experimental-strip-types examples/next-app-router/scripts/test-parallel-refresh.ts
  ```

---

## Creating Changesets

When submitting a PR that alters user-facing functionality or fixes a bug:
```bash
pnpm changeset
```
Follow the interactive prompt to select the semver bump type (patch, minor, major) and provide a concise summary.
