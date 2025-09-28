import {Migration} from 'kysely';
import {InitialMigration} from './001_initial';
import {migration_002_chorus_charts} from './002_chorus_charts';
import {migration_003_local_charts} from './003_local_charts';
import {migration_004_local_charts_normalized} from './004_local_charts_normalized';

export const migrations: Record<string, Migration> = {
  '001_initial': InitialMigration,
  '002_chorus_charts': migration_002_chorus_charts,
  '003_local_charts': migration_003_local_charts,
  '004_local_charts_normalized': migration_004_local_charts_normalized,
};
