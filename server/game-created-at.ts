import { execFile } from 'child_process';

/**
 * When each game file was first added to git, for the admin games list's
 * "Zuletzt erstellt" sort. A file's own birthtime is useless here: game saves
 * write a tmp file and rename it over the original, so birthtime is the last
 * save. See specs/admin-games-list.md.
 */

const CACHE_TTL_MS = 60_000;
const GIT_TIMEOUT_MS = 5_000;

let cache: { at: number; times: Map<string, number> } | null = null;

/**
 * Parse `git log --reverse --format=%x00%at --name-status -M --diff-filter=AR -- <dir>`
 * into `fileName (no .json) → first-added epoch ms`. Renames carry the original
 * add time over to the new name. Only `<dir>/<name>.json` at the top level counts.
 */
export function parseGitAddLog(output: string, dir: string): Map<string, number> {
  const prefix = `${dir.replace(/\/+$/, '')}/`;
  const nameOf = (p: string): string | null => {
    if (!p.startsWith(prefix) || !p.endsWith('.json')) return null;
    const rest = p.slice(prefix.length, -'.json'.length);
    return rest.includes('/') ? null : rest;
  };
  const times = new Map<string, number>();
  let commitMs = 0;
  for (const line of output.split('\n')) {
    if (line.startsWith('\0')) {
      commitMs = Number(line.slice(1)) * 1000;
      continue;
    }
    const parts = line.split('\t');
    const status = parts[0] ?? '';
    if (status === 'A' && parts[1]) {
      const name = nameOf(parts[1]);
      if (name && !times.has(name)) times.set(name, commitMs);
    } else if (status.startsWith('R') && parts[1] && parts[2]) {
      const from = nameOf(parts[1]);
      const to = nameOf(parts[2]);
      if (!to) continue;
      const original = from ? times.get(from) : undefined;
      times.set(to, original ?? commitMs);
    }
  }
  return times;
}

/**
 * First-added times of `<repoDir>/<dir>/*.json`, cached for 60 s. Resolves to an
 * empty map when git is missing, times out or the directory is not in a repo.
 */
export function gameCreatedTimes(repoDir: string, dir = 'games'): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return Promise.resolve(cache.times);
  return new Promise(resolve => {
    execFile(
      'git',
      ['log', '--reverse', '--format=%x00%at', '--name-status', '-M', '--diff-filter=AR', '--', dir],
      { cwd: repoDir, timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        const times = err ? new Map<string, number>() : parseGitAddLog(stdout, dir);
        cache = { at: Date.now(), times };
        resolve(times);
      },
    );
  });
}

/** Test hook: drop the cached lookup. */
export function resetGameCreatedTimesCache(): void {
  cache = null;
}
