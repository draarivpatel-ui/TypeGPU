/**
 * Helpers for reading and writing the `lastUpdated` frontmatter field of docs pages.
 * Starlight natively supports this field, and displays it in the page footer.
 *
 * Only uses Node built-ins, so it can be run directly with `node` (no install needed).
 */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
const LAST_UPDATED_LINE_RE = /^lastUpdated:[ \t]*(.*?)[ \t]*$/m;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type LastUpdated =
  | { kind: 'missing' }
  | { kind: 'invalid'; raw: string }
  | { kind: 'valid'; date: string };

export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/**
 * Reads the `lastUpdated` field (as a `YYYY-MM-DD` string) from the frontmatter of an .md/.mdx file.
 */
export function readLastUpdated(source: string): LastUpdated {
  const frontmatter = FRONTMATTER_RE.exec(source)?.[1];
  const match = frontmatter !== undefined ? LAST_UPDATED_LINE_RE.exec(frontmatter) : null;
  if (!match) {
    return { kind: 'missing' };
  }
  const raw = (match[1] ?? '').replace(/^(['"])(.*)\1$/, '$2');
  return isValidDate(raw) ? { kind: 'valid', date: raw } : { kind: 'invalid', raw };
}

/**
 * Returns `source` with the `lastUpdated` frontmatter field set to `date`.
 */
export function writeLastUpdated(source: string, date: string): string {
  const match = FRONTMATTER_RE.exec(source);
  if (!match) {
    throw new Error('Expected the file to start with a frontmatter block');
  }
  const [whole, frontmatter = ''] = match;
  const updated = LAST_UPDATED_LINE_RE.test(frontmatter)
    ? frontmatter.replace(LAST_UPDATED_LINE_RE, `lastUpdated: ${date}`)
    : `${frontmatter}\nlastUpdated: ${date}`;
  return source.replace(
    whole,
    whole.replace(frontmatter, () => updated),
  );
}

/**
 * Whether the given path (relative to the docs content directory) is a page that should track
 * its last updated date. Blog posts are excluded, as they carry their own publication `date`.
 */
export function isTrackedDocPage(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  return (
    /\.mdx?$/.test(normalized) && !normalized.startsWith('blog/') && !normalized.startsWith('api/')
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's date in the local timezone, as `YYYY-MM-DD`. */
export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Shifts a `YYYY-MM-DD` date by the given number of days. */
export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
