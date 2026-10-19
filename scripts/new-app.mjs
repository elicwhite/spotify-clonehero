#!/usr/bin/env node
// Make a new app from apps/_template.
//
//   pnpm new-app <name> [--port N]
//
// Copies apps/_template to apps/<name>, replaces the `__APP_NAME__` and
// `__APP_PORT__` placeholders, and writes a short README. Run `pnpm install`
// after it so the workspace links the new app.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appsDir = path.join(root, 'apps');
const templateDir = path.join(appsDir, '_template');

function fail(message) {
  console.error(`new-app: ${message}`);
  console.error('usage: pnpm new-app <name> [--port N]');
  process.exit(1);
}

const args = process.argv.slice(2);
let name;
let port;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') {
    port = Number(args[++i]);
  } else if (args[i].startsWith('--port=')) {
    port = Number(args[i].slice('--port='.length));
  } else if (args[i].startsWith('-')) {
    fail(`unknown option ${args[i]}`);
  } else if (name === undefined) {
    name = args[i];
  } else {
    fail(`unexpected argument ${args[i]}`);
  }
}

if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  fail(
    'the name is lowercase letters, digits and dashes, and starts with a letter',
  );
}
const target = path.join(appsDir, name);
if (fs.existsSync(target)) {
  fail(`apps/${name} exists`);
}

// The dev ports that the apps already use.
const usedPorts = new Set();
for (const entry of fs.readdirSync(appsDir, {withFileTypes: true})) {
  const manifest = path.join(appsDir, entry.name, 'package.json');
  if (!entry.isDirectory() || !fs.existsSync(manifest)) continue;
  for (const match of fs.readFileSync(manifest, 'utf8').matchAll(/-p (\d+)/g)) {
    usedPorts.add(Number(match[1]));
  }
}
if (port === undefined) {
  port = 3050;
  while (usedPorts.has(port)) port++;
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  fail('the port is a whole number from 1024 to 65535');
}
if (usedPorts.has(port)) {
  fail(`port ${port} belongs to another app`);
}

fs.cpSync(templateDir, target, {
  recursive: true,
  verbatimSymlinks: true,
  filter: source =>
    !['node_modules', '.next', 'README.md'].includes(path.basename(source)) &&
    !source.endsWith('.tsbuildinfo'),
});

function replacePlaceholders(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      replacePlaceholders(file);
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    const replaced = text
      .replaceAll('__APP_NAME__', name)
      .replaceAll('__APP_PORT__', String(port));
    if (replaced !== text) fs.writeFileSync(file, replaced);
  }
}
replacePlaceholders(target);

fs.writeFileSync(
  path.join(target, 'README.md'),
  `# ${name}

A Next app of the Music Charts workspace, made from \`apps/_template\`. It runs
on port ${port}: \`pnpm --dir apps/${name} dev\`.
`,
);

console.log(`Made apps/${name} (port ${port}). Next: pnpm install`);
