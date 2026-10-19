import {Migration} from 'kysely';
import {InitialMigration} from './001_initial';

export const migrations: Record<string, Migration> = {
  '001_initial': InitialMigration,
};
