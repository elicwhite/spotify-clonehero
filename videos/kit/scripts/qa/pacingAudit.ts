/**
 * The pacing test for a film: reads its `PacingSheet` (./pacing.ts) and
 * checks it against the pacing rules; exits 1 on any failure.
 *
 *   node --import tsx scripts/qa/pacingAudit.ts --sheet <film/src/pacing.ts> \
 *     [--export pacing] [--rules <rules.json|module.ts>] [--rules-export rules]
 *
 * The sheet comes from a module Node imports directly (TypeScript is fine
 * under tsx): keep it free of React and Remotion imports, the way a
 * storyboard module is, so the audit never has to bundle the film. Word
 * counts come from each block's words, never from a typed-in count.
 * --rules replaces any of the default rules (PACING_RULES in ./pacing.ts)
 * with the fields it gives; `reading` merges by kind.
 */
import {isMain, loadData, need, parseFlags, runCli} from '../lib/cli';
import {maxOf} from '../lib/numbers';
import {
  assertRuleOverrides,
  assertPacingSheet,
  PACING_RULES,
  auditPacing,
  withRules,
  type PacingRules,
  type PacingSheet,
} from './pacing';

/** The audit as printable lines: one row per block, then a summary. */
function formatPacing(
  sheet: PacingSheet,
  rules: PacingRules = PACING_RULES,
): {lines: string[]; ok: boolean} {
  const {rows, failures} = auditPacing(sheet, rules);
  const lines = rows.map(
    r =>
      `${r.ok ? 'ok  ' : 'FAIL'} ${r.id.padEnd(22)} ${r.kind.padEnd(8)} ${String(r.words).padStart(3)}w  ` +
      `held ${r.heldSec.toFixed(2)}s  needs ${r.needSec.toFixed(2)}${r.maxSec === null ? 's+' : `-${r.maxSec.toFixed(2)}s`}`,
  );
  const last = maxOf(
    [
      ...sheet.text.map(t => t.out),
      ...sheet.camera.map(c => c.to),
      ...sheet.actions.map(a => a.at),
    ],
    0,
  );
  lines.push(
    '',
    `${sheet.text.length} text blocks, ${sheet.actions.length} actions, ${sheet.camera.length} camera moves, ` +
      `through ${(last / sheet.fps).toFixed(2)}s at ${sheet.fps} fps`,
  );
  if (failures.length)
    lines.push(
      '',
      `${failures.length} failures:`,
      ...failures.map(f => `- ${f}`),
    );
  else lines.push('', 'PACING OK');
  return {lines, ok: failures.length === 0};
}

const USAGE = `
Usage: node --import tsx scripts/qa/pacingAudit.ts --sheet <film/src/pacing.ts> [--export pacing]
         [--rules <rules.json|module.ts>] [--rules-export rules]
`;

async function main(): Promise<void> {
  const {values} = parseFlags({
    sheet: {type: 'string'},
    export: {type: 'string', default: 'pacing'},
    rules: {type: 'string'},
    'rules-export': {type: 'string', default: 'rules'},
  });
  const sheet = await loadData(need(values.sheet, 'sheet'), values.export);
  assertPacingSheet(sheet);
  let rules = PACING_RULES;
  if (values.rules) {
    const overrides = await loadData(values.rules, values['rules-export']);
    assertRuleOverrides(overrides);
    rules = withRules(overrides);
  }
  const {lines, ok} = formatPacing(sheet, rules);
  console.log(lines.join('\n'));
  if (!ok) process.exitCode = 1;
}

if (isMain(import.meta.url)) runCli(USAGE, main);
