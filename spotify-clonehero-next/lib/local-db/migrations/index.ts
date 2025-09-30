import {Migration} from 'kysely';
import {InitialMigration} from './001_initial';
import {migration_002_chorus_charts} from './002_chorus_charts';
import {migration_003_local_charts} from './003_local_charts';
import {migration_004_local_charts_normalized} from './004_local_charts_normalized';
import {migration_005_add_normalized_columns} from './005_add_normalized_columns';
import {migration_006_add_normalized_indexes} from './006_add_normalized_indexes';
import {migration_007_add_track_chart_matches} from './007_add_track_chart_matches';
import {migration_008_add_spotify_history} from './008_add_spotify_history';

export const migrations: Record<string, Migration> = {
  '001_initial': InitialMigration,
  '002_chorus_charts': migration_002_chorus_charts,
  '003_local_charts': migration_003_local_charts,
  '004_local_charts_normalized': migration_004_local_charts_normalized,
  '005_add_normalized_columns': migration_005_add_normalized_columns,
  '006_add_normalized_indexes': migration_006_add_normalized_indexes,
  '007_add_track_chart_matches': migration_007_add_track_chart_matches,
  '008_add_spotify_history': migration_008_add_spotify_history,
};
