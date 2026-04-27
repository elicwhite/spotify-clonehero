import type {Kysely} from 'kysely';
import type {DB} from './types';

// Module-scoped override consumed by `getLocalDb()` in client.ts. Lives in
// its own module so test code can import the setters without dragging in
// the SQLocal/OPFS stack from client.ts (which would fail to resolve under
// Node + Jest).
let testDbOverride: Kysely<DB> | null = null;

export function getTestDbOverride(): Kysely<DB> | null {
  return testDbOverride;
}

export function __setLocalDbForTesting(db: Kysely<DB> | null): void {
  testDbOverride = db;
}

export function __resetLocalDbForTesting(): void {
  testDbOverride = null;
}
