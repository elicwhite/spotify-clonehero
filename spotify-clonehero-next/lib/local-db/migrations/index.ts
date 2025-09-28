import {Migration} from 'kysely';
import {InitialMigration} from './001_initial';
import {migration_002_chorus_charts} from './002_chorus_charts';
import {migration_003_local_charts} from './003_local_charts';

export const migrations: Record<string, Migration> = {
  '001_initial': InitialMigration,
  '002_chorus_charts': migration_002_chorus_charts,
  '003_local_charts': migration_003_local_charts,
};
