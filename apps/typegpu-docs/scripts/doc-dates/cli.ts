/**
 * Keeps the `lastUpdated` frontmatter field of docs pages in sync with their content.
 *
 * Usage (from the repository root):
 *   node apps/typegpu-docs/scripts/doc-dates/cli.ts check [--base <ref>] [--fix]
 *   node apps/typegpu-docs/scripts/doc-dates/cli.ts populate
 *
 * `check` verifies that:
 *   - every docs page has a valid `lastUpdated` date,
 *   - every docs page changed relative to the base ref (including uncommitted and untracked changes)
 *     has its `lastUpdated` date bumped.
 *   With `--fix`, offending pages get their `lastUpdated` set to today's date instead.
 *   The base ref defaults to whichever of `origin/main` and `origin/release` is closest to HEAD.
 *
 * `populate` fills in missing `lastUpdated` dates based on the Git history of each page.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  isTrackedDocPage,
  readLastUpdated,
  addDays,
  today,
  writeLastUpdated,
  type LastUpdated,
} from './frontmatter.ts';

const docsAppRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const contentDir = join(docsAppRoot, 'src', 'content', 'docs');

/**
 * Commits that touched many pages in a purely mechanical way (renames, import style changes),
 * which should not count as the page being updated when populating dates from Git history.
 */
const MECHANICAL_COMMITS = [
  'ca9525024', // impr: Use named tgpu export (#2610)
  'bbbb5184e', // docs: Use `{ tgpu }` import in documentation and examples (#2791)
  '53f4ff83a', // fix: More tree-shakeable and convenient exports (#2068)
  '54556957f', // chore: rename react-native-wgpu to react-native-webgpu (#2619)
];

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: docsAppRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function tryGit(...args: string[]): string | undefined {
  try {
    return git(...args);
  } catch {
    return undefined;
  }
}

const repoRoot = git('rev-parse', '--show-toplevel');
const contentDirFromRepo = relative(repoRoot, contentDir).replaceAll('\\', '/');

function lines(output: string): string[] {
  return output.split('\n').filter((line) => line.length > 0);
}

/** Repository-relative paths of docs pages that are tracked or untracked (but not ignored). */
function listDocPages(): string[] {
  const files = lines(
    git('ls-files', '--cached', '--others', '--exclude-standard', '--full-name', '--', contentDir),
  );
  return [...new Set(files)].filter(isDocPage).filter((file) => {
    try {
      readFileSync(join(repoRoot, file));
      return true;
    } catch {
      return false; // Deleted in the working tree
    }
  });
}

function isDocPage(repoPath: string): boolean {
  return (
    repoPath.startsWith(`${contentDirFromRepo}/`) &&
    isTrackedDocPage(repoPath.slice(contentDirFromRepo.length + 1))
  );
}

function readPage(repoPath: string): string {
  return readFileSync(join(repoRoot, repoPath), 'utf8');
}

function describe(value: LastUpdated): string {
  switch (value.kind) {
    case 'missing':
      return 'is missing a `lastUpdated` date';
    case 'invalid':
      return `has an invalid \`lastUpdated\` date: "${value.raw}" (expected YYYY-MM-DD)`;
    case 'valid':
      return `has \`lastUpdated: ${value.date}\``;
  }
}

function resolveBase(explicitBase: string | undefined): string {
  if (explicitBase) {
    const mergeBase = tryGit('merge-base', explicitBase, 'HEAD');
    if (!mergeBase) {
      throw new Error(
        `Could not find a merge base between "${explicitBase}" and HEAD. Is the ref fetched (and the clone not shallow)?`,
      );
    }
    return mergeBase;
  }

  // Picking the closest merge base, as docs changes can target either `main` or `release`.
  const candidates = ['origin/main', 'origin/release']
    .map((ref) => tryGit('merge-base', ref, 'HEAD'))
    .filter((sha): sha is string => !!sha);

  const closest = candidates.find((candidate) =>
    candidates.every(
      (other) =>
        other === candidate ||
        tryGit('merge-base', '--is-ancestor', other, candidate) !== undefined,
    ),
  );

  if (!closest) {
    throw new Error(
      'Could not determine the base to compare against. Pass one explicitly with `--base <ref>`.',
    );
  }
  return closest;
}

function check({ base, fix }: { base: string | undefined; fix: boolean }) {
  const mergeBase = resolveBase(base);
  const date = today();
  const pages = listDocPages();

  const changed = new Set([
    ...lines(git('diff', '--name-only', '--no-renames', '--diff-filter=AM', mergeBase)),
    ...lines(git('ls-files', '--others', '--exclude-standard', '--full-name', '--', contentDir)),
  ]);

  const problems: string[] = [];
  const fixed: string[] = [];

  for (const page of pages) {
    const source = readPage(page);
    const current = readLastUpdated(source);
    let problem: string | undefined;

    if (current.kind !== 'valid') {
      problem = describe(current);
    } else if (current.date > addDays(date, 1)) {
      problem = `has a \`lastUpdated\` date in the future: ${current.date}`;
    } else if (changed.has(page)) {
      const baseSource = tryGit('show', `${mergeBase}:${page}`);
      const previous = baseSource !== undefined ? readLastUpdated(baseSource) : undefined;
      if (previous?.kind === 'valid' && current.date <= previous.date) {
        problem = `was changed, but its \`lastUpdated\` date (${current.date}) was not bumped`;
      }
    }

    if (!problem) {
      continue;
    }

    if (fix) {
      writeFileSync(join(repoRoot, page), writeLastUpdated(source, date));
      fixed.push(page);
    } else {
      problems.push(`${page} ${problem}`);
    }
  }

  const shortBase = git('rev-parse', '--short', mergeBase);

  if (fixed.length > 0) {
    console.log(`Set \`lastUpdated: ${date}\` in:\n${fixed.map((p) => `  - ${p}`).join('\n')}`);
  }

  if (problems.length > 0) {
    console.error(
      [
        `Found docs pages with outdated \`lastUpdated\` dates (compared against ${shortBase}):`,
        ...problems.map((p) => `  - ${p}`),
        '',
        'Set `lastUpdated` in the frontmatter to the date of the change (YYYY-MM-DD),',
        'or run `pnpm fix:doc-dates` to set it to today for every offending page.',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  console.log(`All ${pages.length} docs pages have up-to-date \`lastUpdated\` dates.`);
}

function lastMeaningfulChange(page: string): string | undefined {
  const history = lines(git('log', '--follow', '--format=%H %as', '--', join(repoRoot, page)));
  for (const entry of history) {
    const [sha = '', date] = entry.split(' ');
    if (!MECHANICAL_COMMITS.some((prefix) => sha.startsWith(prefix))) {
      return date;
    }
  }
  return undefined;
}

function populate() {
  if (tryGit('rev-parse', '--is-shallow-repository') === 'true') {
    throw new Error('Populating dates requires the full Git history, but the clone is shallow.');
  }

  for (const page of listDocPages()) {
    const source = readPage(page);
    if (readLastUpdated(source).kind === 'valid') {
      continue;
    }
    const date = lastMeaningfulChange(page) ?? today();
    writeFileSync(join(repoRoot, page), writeLastUpdated(source, date));
    console.log(`${date} ${page}`);
  }
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: 'string' },
    fix: { type: 'boolean', default: false },
  },
});

switch (positionals[0]) {
  case 'check':
    check({ base: values.base, fix: values.fix });
    break;
  case 'populate':
    populate();
    break;
  default:
    console.error('Usage: cli.ts <check [--base <ref>] [--fix] | populate>');
    process.exitCode = 1;
}
