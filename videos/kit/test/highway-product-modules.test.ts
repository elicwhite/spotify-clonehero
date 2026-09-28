/**
 * The kit's one copy of the app's types (src/highway/product-modules.d.ts)
 * against the app's own sources. Every name a `declare module
 * '@product/...'` block exports must exist in the app file it mirrors, with
 * the same kind, and every real export must fit its declaration; a type the
 * kit builds and hands to the app must also fit the app's.
 * TypeScript checks a generated file that assigns each real export to its
 * declared type; the app's files compile with their imports of three,
 * scan-chart and react resolved to the kit's copies.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {describe, it} from 'node:test';
import ts from 'typescript';

const KIT = path.resolve(import.meta.dirname, '..');
const APP = path.resolve(KIT, '../../spotify-clonehero-next');
const DTS = path.join(KIT, 'src/highway/product-modules.d.ts');
const CHECK = path.join(KIT, 'test/product-modules.check.ts');

/**
 * Types the kit builds and hands to the app (its clock, the stage config,
 * the grid, overlay state, track keys, scopes, a drag, a note). The app
 * reads them, so the declared type must fit the app's as well.
 */
const HANDED_TO_APP = new Set([
  'StageClock',
  'StageConfig',
  'GridData',
  'AddHighwayOptions',
  'OverlayState',
  'TrackKey',
  'EditorScope',
  'NoteDragHint',
  'SchemaNote',
]);

/**
 * Functions declared deliberately narrower than the app, and why. Their
 * check calls the real function with the declared arguments, the narrowed
 * one cast away, and checks what it returns.
 */
const NARROWED: Record<string, {call: (real: string) => string; why: string}> =
  {
    computeChartElements: {
      call: real =>
        `${real}({...a[0], capabilities: a[0].capabilities as never})`,
      why: "the kit hands the app's own DRUM_EDIT_CAPABILITIES back, typed by the one member it reads",
    },
    listNotes: {
      call: real => `${real}(a[0], a[1] as never)`,
      why: "the kit hands the app's own schema back (from schemaForTrack), typed by the members it reads",
    },
  };

interface Declared {
  module: string;
  name: string;
  kind: 'value' | 'type';
}

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some(
    m => m.kind === ts.SyntaxKind.ExportKeyword,
  );

/** Every `export` of every `declare module '@product/...'` block. */
const declaredExports = (): Declared[] => {
  const source = ts.createSourceFile(
    DTS,
    fs.readFileSync(DTS, 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
  );
  const out: Declared[] = [];
  for (const statement of source.statements) {
    if (
      !ts.isModuleDeclaration(statement) ||
      !ts.isStringLiteral(statement.name) ||
      !statement.body ||
      !ts.isModuleBlock(statement.body)
    )
      continue;
    const module = statement.name.text;
    for (const node of statement.body.statements) {
      if (!isExported(node)) continue;
      if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
        out.push({module, name: node.name.text, kind: 'type'});
      else if (
        (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
        node.name
      )
        out.push({module, name: node.name.text, kind: 'value'});
      else if (ts.isVariableStatement(node))
        for (const d of node.declarationList.declarations)
          if (ts.isIdentifier(d.name))
            out.push({module, name: d.name.text, kind: 'value'});
    }
  }
  return out;
};

/** The app file a `@product/...` module mirrors. */
const appFile = (module: string): string => {
  const base = path.join(APP, module.slice('@product/'.length));
  const found = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find(
    f => fs.existsSync(f),
  );
  if (!found) throw new Error(`${module}: no app file at ${base}`);
  return found;
};

const kitPackage = (...parts: string[]) =>
  path.join(KIT, 'node_modules', ...parts);

/** The generated check: one line per declared export, so a diagnostic's line names the export. */
const checkSource = (declared: readonly Declared[]) => {
  const modules = [...new Set(declared.map(d => d.module))];
  const lines = [
    `/// <reference path=${JSON.stringify(DTS)} />`,
    'type Fits<A extends B, B> = [A, B];',
  ];
  modules.forEach((module, i) => {
    lines.push(
      `import * as real${i} from ${JSON.stringify(appFile(module).replace(/\.tsx?$/, ''))};`,
      `import type * as decl${i} from ${JSON.stringify(module)};`,
    );
  });
  const labels = new Map<number, string>();
  const add = (label: string, line: string) => {
    labels.set(lines.length + 1, label);
    lines.push(line);
  };
  for (const d of declared) {
    const i = modules.indexOf(d.module);
    const real = `real${i}.${d.name}`;
    const decl = `decl${i}.${d.name}`;
    const label = `${d.module} ${d.name}`;
    const narrowed = NARROWED[d.name];
    if (d.kind === 'type') {
      add(label, `export type T_${i}_${d.name} = Fits<${real}, ${decl}>;`);
      if (HANDED_TO_APP.has(d.name))
        add(
          `${label} (as the kit hands it to the app)`,
          `export type H_${i}_${d.name} = Fits<${decl}, ${real}>;`,
        );
    } else if (narrowed)
      add(
        label,
        `export const N_${i}_${d.name} = (a: Parameters<typeof ${decl}>): ReturnType<typeof ${decl}> => ${narrowed.call(real)};`,
      );
    else add(label, `export const V_${i}_${d.name}: typeof ${decl} = ${real};`);
  }
  return {text: lines.join('\n') + '\n', labels};
};

const compile = (text: string) => {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    baseUrl: '/',
    paths: {
      '@/*': [`${APP}/*`],
      three: [kitPackage('@types', 'three')],
      'three/*': [kitPackage('@types', 'three', '*')],
      '@eliwhite/scan-chart': [kitPackage('@eliwhite', 'scan-chart')],
      react: [kitPackage('@types', 'react')],
      'react/*': [kitPackage('@types', 'react', '*')],
    },
  };
  const host = ts.createCompilerHost(options, true);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  const get = host.getSourceFile.bind(host);
  host.readFile = f => (f === CHECK ? text : read(f));
  host.fileExists = f => f === CHECK || exists(f);
  host.getSourceFile = (f, language, ...rest) =>
    f === CHECK
      ? ts.createSourceFile(f, text, language)
      : get(f, language, ...rest);
  const program = ts.createProgram({rootNames: [CHECK, DTS], options, host});
  const check = program.getSourceFile(CHECK);
  assert.ok(check, 'the generated check did not compile');
  return {
    diagnostics: [
      ...program.getSyntacticDiagnostics(check),
      ...program.getSemanticDiagnostics(check),
    ],
    check,
  };
};

describe('the app types the kit declares (product-modules.d.ts)', () => {
  const declared = declaredExports();

  it('declares the modules the kit imports', () => {
    assert.ok(declared.length > 30, `only ${declared.length} declared exports`);
    for (const module of new Set(declared.map(d => d.module))) appFile(module);
    const names = new Set(declared.map(d => d.name));
    for (const name of [...HANDED_TO_APP, ...Object.keys(NARROWED)])
      assert.ok(names.has(name), `${name} is listed here but not declared`);
  });

  it('matches the app: every declared export exists and fits', () => {
    const {text, labels} = checkSource(declared);
    const {diagnostics, check} = compile(text);
    const problems = diagnostics.map(d => {
      const line =
        d.start === undefined
          ? 0
          : check.getLineAndCharacterOfPosition(d.start).line + 1;
      const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      return `${labels.get(line) ?? `line ${line}`}: ${message.split('\n').slice(0, 4).join(' / ')}`;
    });
    assert.deepEqual(problems, []);
  });
});
