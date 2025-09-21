import {Migration} from 'kysely';
import {InitialMigration} from './001_initial';
import {migration_002_chorus_charts} from './002_chorus_charts';

export const migrations: Record<string, Migration> = {
  '001_initial': InitialMigration,
  '002_chorus_charts': migration_002_chorus_charts,
};
