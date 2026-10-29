/** YouTube links → video ids. Accepts watch, short, embed, shorts and live links, or a bare id. */

const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com", "youtu.be"]);

export function youtubeId(input: string): string | null {
  const raw = input.trim();
  if (ID.test(raw)) return raw;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!HOSTS.has(u.hostname.toLowerCase())) return null;
  if (u.hostname.toLowerCase() === "youtu.be") {
    const id = u.pathname.split("/")[1] ?? "";
    return ID.test(id) ? id : null;
  }
  const v = u.searchParams.get("v");
  if (v && ID.test(v)) return v;
  const [, kind, id] = u.pathname.split("/");
  if (["embed", "shorts", "live", "v"].includes(kind ?? "") && ID.test(id ?? "")) return id!;
  return null;
}

export const youtubeThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const youtubeWatch = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const youtubeEmbed = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
