#!/usr/bin/env bun
/**
 * Decide whether a push/PR touches app-affecting files (→ run the E2E job) or is
 * provably docs-only (→ skip it). Writes `run=true|false` to `$GITHUB_OUTPUT`.
 *
 * Defaults to RUN: an unknown base, an empty diff, or any non-ignored file all
 * yield `true`, so the required E2E check is never wrongly skipped.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

/** A changed path matching any of these does NOT affect the app build/behaviour. */
const NON_APP: ((file: string) => boolean)[] = [
  (f) => f.startsWith('docs/'),
  (f) => f.endsWith('.md'),
  (f) => f.startsWith('.claude/'),
  (f) => f === 'LICENSE',
  (f) => f.startsWith('.github/ISSUE_TEMPLATE/'),
];

const isNonApp = (file: string): boolean => NON_APP.some((match) => match(file));

type EventPayload = {
  pull_request?: { base?: { sha?: string } };
  before?: string;
};

function readEvent(): EventPayload {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as EventPayload;
  } catch {
    return {};
  }
}

function resolveBase(): string | undefined {
  const event = readEvent();
  return process.env.GITHUB_EVENT_NAME === 'pull_request'
    ? event.pull_request?.base?.sha
    : event.before;
}

function isCommit(ref: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--quiet', '--verify', `${ref}^{commit}`], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function decide(): boolean {
  const base = resolveBase();
  const head = process.env.GITHUB_SHA;
  if (!base || !head || !isCommit(base)) {
    console.log(`Unknown/invalid base (${base ?? 'none'}) — running to be safe.`);
    return true;
  }

  const diff = execFileSync('git', ['diff', '--name-only', base, head], { encoding: 'utf8' });
  const files = diff.split('\n').map((f) => f.trim()).filter(Boolean);
  console.log(`Changed files:\n${files.join('\n') || '(none)'}`);
  if (files.length === 0) return true;

  const appFiles = files.filter((f) => !isNonApp(f));
  console.log(appFiles.length ? `App-affecting: ${appFiles.join(', ')}` : 'Docs-only change.');
  return appFiles.length > 0;
}

const run = decide();
console.log(`run=${run}`);
const outFile = process.env.GITHUB_OUTPUT;
if (outFile) appendFileSync(outFile, `run=${run}\n`);
