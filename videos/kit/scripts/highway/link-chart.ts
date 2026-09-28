/**
 * Make a chart readable by the highway (`useChartFolder` in src/highway)
 * without copying song material into the repository.
 *
 *   node --import tsx kit/scripts/highway/link-chart.ts --chart <chart folder> --out <film>/public/generated/highway
 *   node --import tsx kit/scripts/highway/link-chart.ts --test-chart --out <folder>
 *
 * The highway parses the chart in the browser the way the chart editor opens
 * it (notes.chart or notes.mid, plus song.ini), so its notes and karaoke
 * line are the product's own. This links the chart folder as `<out>/chart`
 * and lists the files to read in `<out>/chart-files.json`. The link is to the
 * folder, not to single files: Remotion's render server answers a request
 * for a symlinked file with a 404 but reads through a symlinked folder.
 * `--test-chart` writes the kit's invented test chart there instead (files,
 * no link), for demos and checks that need no song at all.
 *
 * A film reads it with `useChartFolder({dir: 'generated/highway'})` (the
 * folder relative to its public dir).
 */
import fs from 'node:fs';
import path from 'node:path';
import {testChartFiles} from '../../src/highway/testChart';
import {need, parseFlags, runCli, UsageError} from '../lib/cli';

const USAGE =
  'node --import tsx kit/scripts/highway/link-chart.ts (--chart <chart folder> | --test-chart) --out <folder>';

/**
 * Remove an earlier link or test chart at `link`, never following a link
 * into the chart folder it points at.
 */
const clearLink = (outDir: string, link: string): void => {
  const existing = fs.lstatSync(link, {throwIfNoEntry: false});
  if (existing?.isSymbolicLink()) {
    fs.unlinkSync(link);
    return;
  }
  if (!existing) return;
  const written = path.join(outDir, 'chart-files.json');
  const names = fs.existsSync(written)
    ? (JSON.parse(fs.readFileSync(written, 'utf8')) as string[])
    : null;
  const ours =
    names !== null && fs.readdirSync(link).every(name => names.includes(name));
  if (!ours)
    throw new Error(
      `${link} exists and is not a link this script wrote; remove it by hand.`,
    );
  fs.rmSync(link, {recursive: true});
};

runCli(USAGE, () => {
  const {values} = parseFlags({
    chart: {type: 'string'},
    'test-chart': {type: 'boolean', default: false},
    out: {type: 'string'},
  });
  if (Boolean(values.chart) === values['test-chart'])
    throw new UsageError('pass one of --chart and --test-chart');
  const outDir = path.resolve(need(values.out, 'out'));
  const link = path.join(outDir, 'chart');
  fs.mkdirSync(outDir, {recursive: true});
  clearLink(outDir, link);

  let files: string[];
  if (values.chart) {
    const chartDir = path.resolve(values.chart);
    const chartFile = ['notes.chart', 'notes.mid'].find(name =>
      fs.existsSync(path.join(chartDir, name)),
    );
    if (!chartFile)
      throw new Error(`no notes.chart or notes.mid in ${chartDir}`);
    files = [chartFile, 'song.ini'].filter(name =>
      fs.existsSync(path.join(chartDir, name)),
    );
    fs.symlinkSync(chartDir, link, 'dir');
  } else {
    fs.mkdirSync(link);
    const chart = testChartFiles();
    for (const file of chart)
      fs.writeFileSync(path.join(link, file.fileName), file.data);
    files = chart.map(file => file.fileName);
  }
  fs.writeFileSync(
    path.join(outDir, 'chart-files.json'),
    `${JSON.stringify(files)}\n`,
  );
  console.log(
    `${values.chart ? 'Linked the chart folder' : 'Wrote the test chart'} at ${link} (${files.join(', ')})`,
  );
});
