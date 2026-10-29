/**
 * Watched parts of a video. The player reports the second ranges it played; the server
 * keeps their union, so watching the same minute twice counts once and skipping ahead
 * doesn't count at all. A lesson completes at 90% of the video watched.
 */
import type { WatchedRange } from "./kinds";

export const VIDEO_COMPLETE_SHARE = 0.9;
/** Gaps up to this many seconds between reported ranges are joined (players report in steps). */
const JOIN_GAP = 1.5;

const round = (n: number) => Math.round(n * 10) / 10;

/** Valid ranges only, clipped to [0, duration], sorted and merged. */
export function mergeRanges(ranges: readonly WatchedRange[], duration: number): WatchedRange[] {
  const clean = ranges
    .filter((r) => Array.isArray(r) && r.length === 2 && Number.isFinite(r[0]) && Number.isFinite(r[1]))
    .map(([a, b]) => [Math.max(0, Math.min(a, duration)), Math.max(0, Math.min(b, duration))] as WatchedRange)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const out: WatchedRange[] = [];
  for (const [a, b] of clean) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + JOIN_GAP) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out.map(([a, b]) => [round(a), round(b)]);
}

export function watchedSeconds(ranges: readonly WatchedRange[]): number {
  return ranges.reduce((n, [a, b]) => n + (b - a), 0);
}

/** Parts of [a, b) not yet covered by `merged` (which must be merged). */
function uncovered(merged: readonly WatchedRange[], a: number, b: number): WatchedRange[] {
  const out: WatchedRange[] = [];
  let cur = a;
  for (const [x, y] of merged) {
    if (y <= cur) continue;
    if (x >= b) break;
    if (x > cur) out.push([cur, Math.min(x, b)]);
    cur = Math.max(cur, y);
    if (cur >= b) break;
  }
  if (cur < b) out.push([cur, b]);
  return out;
}

/**
 * Adds newly reported ranges, but never more new watched time than `allowance` seconds.
 * The allowance comes from the wall-clock time since the last report (playback can't
 * cover more video than time has passed, allowing for 2x speed), so a forged report of
 * the whole video in one go only counts as the little time that really passed.
 */
export function addWatched(existing: readonly WatchedRange[], incoming: readonly WatchedRange[], duration: number, allowance: number) {
  let merged = mergeRanges(existing, duration);
  const before = watchedSeconds(merged);
  let budget = Math.max(0, allowance);
  for (const [a, b] of mergeRanges(incoming, duration)) {
    if (budget <= 0) break;
    for (const [x, y] of uncovered(merged, a, b)) {
      if (budget <= 0) break;
      const take = Math.min(y - x, budget);
      merged = mergeRanges([...merged, [x, x + take]], duration);
      budget -= take;
    }
  }
  const after = watchedSeconds(merged);
  return { ranges: merged, watched: after, added: round(after - before) };
}

/** Whole percent watched, 0–100. */
export function watchedPercent(watched: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.max(0, Math.min(100, Math.floor((watched / duration) * 100)));
}

export function reachedCompletion(watched: number, duration: number): boolean {
  return duration > 0 && watched / duration >= VIDEO_COMPLETE_SHARE - 1e-9;
}
