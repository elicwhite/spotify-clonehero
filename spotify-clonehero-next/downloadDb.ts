import path from 'path';
import fs from 'fs';
import fetchNewCharts from './lib/chorusChartDb/fetchNewCharts';

const CHART_FILE = path.join('.', 'public', 'data', 'charts.json');
const METADATA_FILE = path.join('.', 'public', 'data', 'metadata.json');
const RAW_FILE_LOCATION = path.join('.', 'raw_db_files');

const START_TIME = new Date('2011-01-01');

const SAVE_RAW_FILES = true;

async function run() {
  const NOW = new Date();

  if (SAVE_RAW_FILES) {
    fs.mkdirSync(RAW_FILE_LOCATION, {recursive: true});
  }

  const {charts, metadata} = await fetchNewCharts(
    START_TIME,
    1,
    (json, lastChartId) => {
      fs.writeFileSync(
        path.join(
          RAW_FILE_LOCATION,
          NOW.toISOString() + String(lastChartId) + '.json',
        ),
        JSON.stringify(json, null, 2),
      );
    },
  );

  const json = JSON.stringify(charts);
  fs.writeFileSync(CHART_FILE, json);
  fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata));
}

run();
