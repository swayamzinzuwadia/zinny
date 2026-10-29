/**
 * Lesson kinds, their stored content, drip rules and video links. Pure functions only
 * (no database, no server imports), so both server and client code can use them.
 */
import { addDays } from "./dates";

export const LESSON_KINDS = ["video", "pdf", "text", "link", "live"] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export const KIND_LABEL: Record<LessonKind, string> = {
  video: "Video",
  pdf: "PDF",
  text: "Text",
  link: "Link",
  live: "Live class",
};

export const isLessonKind = (v: unknown): v is LessonKind => typeof v === "string" && (LESSON_KINDS as readonly string[]).includes(v);

export type DripMode = "none" | "after_start" | "on_date";
export const DRIP_MODES: readonly DripMode[] = ["none", "after_start", "on_date"];

/** A watched part of a video, in seconds: [start, end). */
export type WatchedRange = [number, number];

/** Stored as jsonb; read it with `readContent`. */
export type LessonContent = Record<string, unknown>;

export type ExternalVideo = { source: "youtube" | "vimeo"; videoId: string; hash?: string; url: string };
export type UploadedVideo = { source: "upload"; key: string; fileName: string; contentType: string; size: number; durationSeconds?: number };
export type VideoContent = ExternalVideo | UploadedVideo;
export type PdfContent = { key: string; fileName: string; size: number };

export type ParsedContent =
  | { kind: "video"; video: VideoContent | null }
  | { kind: "pdf"; pdf: PdfContent | null }
  | { kind: "text"; html: string }
  | { kind: "link"; url: string | null }
  | { kind: "live" };

const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Reads a lesson's stored content safely. Anything malformed reads as "no content yet". */
export function readContent(kind: LessonKind, c: LessonContent | null | undefined): ParsedContent {
  const content = c ?? {};
  switch (kind) {
    case "video": {
      const source = str(content.source);
      if (source === "upload" && str(content.key) && str(content.fileName)) {
        return {
          kind,
          video: {
            source,
            key: str(content.key)!,
            fileName: str(content.fileName)!,
            contentType: str(content.contentType) ?? "video/mp4",
            size: num(content.size) ?? 0,
            ...(num(content.durationSeconds) ? { durationSeconds: num(content.durationSeconds)! } : {}),
          },
        };
      }
      if ((source === "youtube" || source === "vimeo") && str(content.videoId)) {
        return {
          kind,
          video: {
            source,
            videoId: str(content.videoId)!,
            url: str(content.url) ?? "",
            ...(str(content.hash) ? { hash: str(content.hash)! } : {}),
          },
        };
      }
      return { kind, video: null };
    }
    case "pdf":
      return str(content.key) && str(content.fileName)
        ? { kind, pdf: { key: str(content.key)!, fileName: str(content.fileName)!, size: num(content.size) ?? 0 } }
        : { kind, pdf: null };
    case "text":
      return { kind, html: str(content.html) ?? "" };
    case "link":
      return { kind, url: str(content.url) };
    case "live":
      return { kind };
  }
}

/** True when a lesson has what it needs to be shown to students. Live lessons never need content. */
export function hasContent(kind: LessonKind, c: LessonContent | null | undefined): boolean {
  const p = readContent(kind, c);
  switch (p.kind) {
    case "video":
      return !!p.video;
    case "pdf":
      return !!p.pdf;
    case "text":
      return p.html.replace(/<[^>]*>/g, "").trim().length > 0;
    case "link":
      return !!p.url;
    case "live":
      return true;
  }
}

/** Storage key of the lesson's uploaded file, if it has one. */
export function storedFileKey(kind: LessonKind, c: LessonContent | null | undefined): string | null {
  const p = readContent(kind, c);
  if (p.kind === "video" && p.video?.source === "upload") return p.video.key;
  if (p.kind === "pdf" && p.pdf) return p.pdf.key;
  return null;
}

/* ───────────────────────────── Video links ───────────────────────────── */

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Understands the usual YouTube and Vimeo links:
 *   youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed|shorts|live/ID, youtube-nocookie.com/embed/ID
 *   vimeo.com/ID, vimeo.com/ID/HASH (unlisted), vimeo.com/channels/x/ID, player.vimeo.com/video/ID?h=HASH
 * Returns null for anything else.
 */
export function parseVideoUrl(input: string): ExternalVideo | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    const id = parts[0];
    return id && YT_ID.test(id) ? youtube(id) : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    if (parts[0] === "watch") {
      const id = u.searchParams.get("v");
      return id && YT_ID.test(id) ? youtube(id) : null;
    }
    if (["embed", "shorts", "live", "v"].includes(parts[0] ?? "") && parts[1] && YT_ID.test(parts[1])) return youtube(parts[1]);
    return null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const idAt = parts.findIndex((p) => /^\d{5,12}$/.test(p));
    if (idAt < 0) return null;
    const id = parts[idAt];
    const after = parts[idAt + 1];
    const hash = u.searchParams.get("h") ?? (after && /^[0-9a-f]{6,20}$/i.test(after) ? after : null);
    return vimeo(id, hash ?? undefined);
  }
  return null;
}

function youtube(videoId: string): ExternalVideo {
  return { source: "youtube", videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
}

function vimeo(videoId: string, hash?: string): ExternalVideo {
  return { source: "vimeo", videoId, ...(hash ? { hash } : {}), url: hash ? `https://vimeo.com/${videoId}/${hash}` : `https://vimeo.com/${videoId}` };
}

/** The privacy-friendly embed URL for an external video. */
export function embedUrl(v: ExternalVideo): string {
  if (v.source === "youtube") return `https://www.youtube-nocookie.com/embed/${v.videoId}?rel=0&playsinline=1&enablejsapi=1`;
  const q = new URLSearchParams({ dnt: "1", playsinline: "1" });
  if (v.hash) q.set("h", v.hash);
  return `https://player.vimeo.com/video/${v.videoId}?${q}`;
}

/** Only http(s) links are allowed for link lessons. Returns the normalised URL or null. */
export function normaliseLink(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/* ───────────────────────────── Drip ───────────────────────────── */

export type Drip = { dripMode: DripMode; dripDays: number | null; dripDate: string | null };

/**
 * When a lesson opens for a student, "YYYY-MM-DD", or null when it is open from enrolment.
 * after_start: N days after the student's batch starts. on_date: a fixed date.
 */
export function unlockDate(l: Drip, batchStartDate: string): string | null {
  if (l.dripMode === "after_start" && l.dripDays !== null && l.dripDays >= 0) return addDays(batchStartDate, l.dripDays);
  if (l.dripMode === "on_date" && l.dripDate) return l.dripDate;
  return null;
}

/** Locked until the unlock date (inclusive: it opens on that day). */
export function isLocked(unlockOn: string | null, today: string): boolean {
  return unlockOn !== null && today < unlockOn;
}

/** Short description of a drip rule for staff: "Opens 7 days after the batch starts". */
export function describeDrip(l: Drip): string | null {
  if (l.dripMode === "after_start" && l.dripDays !== null) {
    return l.dripDays === 0 ? "Opens when the batch starts" : `Opens ${l.dripDays} day${l.dripDays === 1 ? "" : "s"} after the batch starts`;
  }
  if (l.dripMode === "on_date" && l.dripDate) return `Opens on ${l.dripDate}`;
  return null;
}

/* ───────────────────────────── Progress ───────────────────────────── */

/** Course % = completed required lessons ÷ required lessons, rounded down (0 when nothing is required). */
export function coursePercent(completedRequired: number, totalRequired: number): number {
  if (totalRequired <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((completedRequired * 100) / totalRequired)));
}

/** "1 h 25 min", "40 min". */
export function formatMinutes(total: number): string {
  if (!total || total <= 0) return "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
