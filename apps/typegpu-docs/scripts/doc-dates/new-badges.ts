/**
 * Derives "new" sidebar badges from the `lastUpdated` frontmatter of docs pages.
 * A page is considered new if it was updated on the day of the latest minor release, or since.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLastUpdated } from './frontmatter.ts';

const MINOR_RELEASE_TAG_RE = /^v\d+\.\d+\.0$/;

export interface ReleaseInfo {
  tag: string;
  date: string;
}

/**
 * Finds the latest minor release (e.g. `v0.12.0`) based on Git tags, along with the date it was tagged.
 * Returns `undefined` if tags are unavailable (e.g. in a shallow clone).
 */
export function getLatestMinorRelease(cwd: string): ReleaseInfo | undefined {
  let output: string;
  try {
    output = execFileSync(
      'git',
      [
        'for-each-ref',
        '--sort=-v:refname',
        '--format=%(refname:short) %(creatordate:short)',
        'refs/tags/v*',
      ],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch {
    return undefined;
  }

  for (const line of output.split('\n')) {
    const [tag = '', date = ''] = line.trim().split(' ');
    if (MINOR_RELEASE_TAG_RE.test(tag)) {
      return { tag, date };
    }
  }
  return undefined;
}

function findPage(contentDir: string, slug: string): string | undefined {
  return [`${slug}.mdx`, `${slug}.md`, `${slug}/index.mdx`, `${slug}/index.md`]
    .map((candidate) => join(contentDir, candidate))
    .find((path) => existsSync(path));
}

interface SidebarItemLike {
  slug?: string;
  badge?: unknown;
  items?: SidebarItemLike[];
}

/**
 * Adds a "new" badge to every sidebar item (that has no badge yet) whose page was updated
 * on the day of the given release, or later.
 */
export function withNewBadges<T extends SidebarItemLike>(
  items: T[],
  { contentDir, since }: { contentDir: string; since: string | undefined },
): T[] {
  if (since === undefined) {
    return items;
  }

  return items.map((item) => {
    if (item.items) {
      return { ...item, items: withNewBadges(item.items, { contentDir, since }) };
    }
    if (item.slug === undefined || item.badge !== undefined) {
      return item;
    }

    const page = findPage(contentDir, item.slug);
    const lastUpdated = page ? readLastUpdated(readFileSync(page, 'utf8')) : undefined;
    if (lastUpdated?.kind === 'valid' && lastUpdated.date >= since) {
      return { ...item, badge: { text: 'new' } };
    }
    return item;
  });
}
