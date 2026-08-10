import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export type FolderAlbumManifestRow = {
  assetIds: string[];
  collisionSource: boolean;
  include: boolean;
  sourcePath: string;
  title: string;
};

const monthNames = new Map([
  ['january', 'Jan'],
  ['february', 'Feb'],
  ['march', 'Mar'],
  ['april', 'Apr'],
  ['may', 'May'],
  ['june', 'Jun'],
  ['july', 'Jul'],
  ['august', 'Aug'],
  ['september', 'Sep'],
  ['october', 'Oct'],
  ['november', 'Nov'],
  ['december', 'Dec'],
]);

const periodNames = new Map([
  ['janmarch', 'Jan–Mar'],
  ['januarymarch', 'Jan–Mar'],
  ['novdec', 'Nov–Dec'],
  ['novemberdecember', 'Nov–Dec'],
]);

const normalizePath = (value: string) => `/${value.replaceAll('\\', '/').split('/').filter(Boolean).join('/')}`;

const words = (value: string) =>
  value.replaceAll(/[_-]+/g, ' ').replaceAll(/\s+/g, ' ').trim().split(' ').filter(Boolean);

const humanWord = (value: string) => {
  if (/^[A-Z0-9]{2,6}$/.test(value)) {
    return value;
  }
  if (/^\d+$/.test(value)) {
    return value;
  }
  return `${value.slice(0, 1).toLocaleUpperCase()}${value.slice(1).toLocaleLowerCase()}`;
};

const humanSegment = (value: string) =>
  words(value)
    .map((word) => humanWord(word))
    .join(' ');

export const folderAlbumTitle = (sourcePath: string) => {
  const segments = normalizePath(sourcePath).split('/').filter(Boolean);
  const tokens = segments.flatMap((segment) => words(segment));
  const year = tokens.find((token) => /^(?:19|20)\d{2}$/.test(token));
  const month = tokens
    .map((token) => monthNames.get(token.toLocaleLowerCase()) || periodNames.get(token.toLocaleLowerCase()))
    .find(Boolean);
  const yearSegmentIndex = year ? segments.findIndex((segment) => words(segment).includes(year)) : -1;
  const yearSegmentQualifier =
    yearSegmentIndex >= 0
      ? words(segments[yearSegmentIndex]!)
          .filter(
            (token) =>
              token !== year &&
              !monthNames.has(token.toLocaleLowerCase()) &&
              !periodNames.has(token.toLocaleLowerCase()),
          )
          .map((token) => humanWord(token))
          .join(' ')
      : '';
  const trailingSegments = yearSegmentIndex >= 0 ? segments.slice(yearSegmentIndex + 1) : [];
  const qualifier = trailingSegments
    .filter(
      (segment) =>
        !words(segment).some(
          (token) => monthNames.has(token.toLocaleLowerCase()) || periodNames.has(token.toLocaleLowerCase()),
        ),
    )
    .map((segment) => humanSegment(segment))
    .filter(Boolean)
    .join(' — ');
  const structured = [yearSegmentQualifier, month || '', year || ''].filter(Boolean).join(' ');
  if (structured) {
    return qualifier ? `${structured} — ${qualifier}` : structured;
  }
  return humanSegment(segments.at(-1) || 'Album');
};

const genericCollectionSegments = new Set(['archive', 'archives', 'photo', 'photos', 'video', 'videos']);

const humanContextSegment = (segment: string, representedTokens: Set<string>) =>
  words(segment)
    .filter((token) => {
      const lower = token.toLocaleLowerCase();
      return (
        !/^(?:19|20)\d{2}$/.test(token) &&
        !representedTokens.has(lower) &&
        !monthNames.has(lower) &&
        !periodNames.has(lower)
      );
    })
    .map((token) => humanWord(token))
    .join(' ');

const collectionSuffixParts = (sourcePath: string, rootPath: string, title: string) => {
  const root = normalizePath(rootPath);
  const relative = normalizePath(sourcePath).slice(root.length).replace(/^\//, '');
  const segments = relative.split('/').filter(Boolean);
  const representedTokens = new Set(words(title).map((token) => token.toLocaleLowerCase()));
  const context = segments
    .slice(0, -1)
    .filter((segment) => !genericCollectionSegments.has(segment.toLocaleLowerCase()))
    .map((segment) => humanContextSegment(segment, representedTokens))
    .filter(Boolean);
  return {
    context: context.length > 0 ? context : [humanSegment(segments.at(-2) || 'Folder')],
    leaf: humanSegment(segments.at(-1) || 'Folder'),
    relative: segments.map((segment) => humanSegment(segment)),
  };
};

export const resolveFolderAlbumTitleCollisions = (
  rows: Array<Omit<FolderAlbumManifestRow, 'collisionSource'>>,
  rootPath: string,
): FolderAlbumManifestRow[] => {
  const baseCounts = new Map<string, number>();
  for (const row of rows) {
    const key = row.title.toLocaleLowerCase();
    baseCounts.set(key, (baseCounts.get(key) || 0) + 1);
  }
  const provisional = rows.map((row) => {
    const baseKey = row.title.toLocaleLowerCase();
    const collisionSource = (baseCounts.get(baseKey) || 0) > 1;
    const suffix = collectionSuffixParts(row.sourcePath, rootPath, row.title);
    const title = collisionSource ? `${row.title} — ${suffix.context.join(' · ')}` : row.title;
    return { ...row, collisionSource, suffix, title };
  });

  const candidateCounts = new Map<string, number>();
  for (const row of provisional) {
    const key = row.title.toLocaleLowerCase();
    candidateCounts.set(key, (candidateCounts.get(key) || 0) + 1);
  }

  const used = new Set<string>();
  return provisional.map(({ suffix, ...row }) => {
    const baseCandidate = row.title;
    let title =
      (candidateCounts.get(baseCandidate.toLocaleLowerCase()) || 0) > 1
        ? `${baseCandidate} · ${suffix.leaf}`
        : baseCandidate;
    if (used.has(title.toLocaleLowerCase())) {
      title = `${row.title} · ${suffix.relative.join(' · ')}`;
    }
    const stableTitle = title;
    let sequence = 2;
    while (used.has(title.toLocaleLowerCase())) {
      title = `${stableTitle} (${sequence})`;
      sequence += 1;
    }
    used.add(title.toLocaleLowerCase());
    return { ...row, title };
  });
};

export const folderAlbumManifestIssues = (rows: FolderAlbumManifestRow[]) => {
  const included = rows.filter(({ include }) => include);
  const emptyTitles = included.filter(({ title }) => !title.trim()).map(({ sourcePath }) => sourcePath);
  const titleCounts = new Map<string, number>();
  for (const row of included) {
    const key = row.title.trim().toLocaleLowerCase();
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  }
  const duplicateTitles = [...titleCounts.entries()].filter(([, count]) => count > 1).map(([title]) => title);
  return { duplicateTitles, emptyTitles };
};

// Keep the established Promise-shaped contract while hashing synchronously in insecure LAN contexts.
// eslint-disable-next-line @typescript-eslint/require-await
export const folderAlbumManifestFingerprint = async (rows: FolderAlbumManifestRow[]) => {
  const input = rows
    .filter(({ include }) => include)
    .map(({ assetIds, sourcePath, title }) => ({ assetIds: [...assetIds].sort(), sourcePath, title: title.trim() }))
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  return bytesToHex(sha256(bytes));
};
