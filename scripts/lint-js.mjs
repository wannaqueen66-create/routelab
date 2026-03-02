#!/usr/bin/env node
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const roots = (args.length ? args : ['.']).map((p) => resolve(process.cwd(), p));
const JS_EXT = new Set(['.js', '.mjs', '.cjs']);
const IGNORE_DIR = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.tmp']);

function walk(dir, files = []) {
  if (!existsSync(dir)) {
    return files;
  }
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIR.has(entry.name)) {
        continue;
      }
      walk(full, files);
      continue;
    }
    if (entry.isFile() && JS_EXT.has(extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

const targets = [];
for (const root of roots) {
  try {
    const st = statSync(root);
    if (st.isDirectory()) {
      walk(root, targets);
    } else if (st.isFile() && JS_EXT.has(extname(root))) {
      targets.push(root);
    }
  } catch (_) {
    // ignore missing path
  }
}

if (!targets.length) {
  console.log('lint-js: no JS files found');
  process.exit(0);
}

let failed = 0;
for (const file of targets) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) {
    failed += 1;
  }
}

if (failed) {
  console.error(`lint-js: ${failed} file(s) failed syntax check`);
  process.exit(1);
}

console.log(`lint-js: ${targets.length} file(s) passed`);
