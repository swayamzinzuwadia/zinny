/**
 * What files assignments accept, and how they are named in storage.
 *
 * Keys are `<universityId>/assignments-polls/files/<fileId>/<safe name>`. The content type
 * comes from the extension (never from the browser), and files are always downloaded as
 * attachments, so an uploaded page can't run in the app's origin.
 */
import { ValidationError } from "@/server/errors";

/** The largest single file anyone can upload, in MB. An assignment can set a lower limit. */
export const MAX_UPLOAD_MB = 25;
/** Text answers longer than this are refused. */
export const MAX_TEXT_CHARS = 20_000;

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  txt: "text/plain",
  md: "text/markdown",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  csv: "text/csv",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
  key: "application/vnd.apple.keynote",
  pages: "application/vnd.apple.pages",
  numbers: "application/vnd.apple.numbers",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  zip: "application/zip",
  ipynb: "application/x-ipynb+json",
  py: "text/x-python",
  r: "text/plain",
  sql: "application/sql",
  java: "text/x-java",
  c: "text/x-c",
  cpp: "text/x-c++",
  h: "text/x-c",
  js: "text/plain",
  ts: "text/plain",
  html: "text/plain",
  css: "text/plain",
  json: "application/json",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

/** For the file picker's `accept`. */
export const ACCEPT = Object.keys(TYPES)
  .map((e) => `.${e}`)
  .join(",");

export const ACCEPT_HINT = "PDF, Word, Excel, PowerPoint, images, text, code, zip, audio or video";

function extensionOf(name: string) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** The stored content type for a file name, or null when the kind isn't accepted. */
export function contentTypeFor(name: string): string | null {
  return TYPES[extensionOf(name)] ?? null;
}

/** The name people see: trimmed, without control characters or path parts, at most 200 characters. */
export function displayName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const base = (name ?? "").split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (base.length <= 200) return base || "file";
  const ext = extensionOf(base);
  return ext ? `${base.slice(0, 199 - ext.length)}.${ext}` : base.slice(0, 200);
}

/** A name that storage keys and download headers accept: letters, digits, spaces and . _ - ( ) + , = @ only. */
export function safeFileName(name: string): string {
  const shown = displayName(name);
  const ext = extensionOf(shown);
  const stem = (ext ? shown.slice(0, -(ext.length + 1)) : shown)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._ ()+,=@-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[\s.-]+|[\s.-]+$/g, "")
    .slice(0, 100);
  return `${stem || "file"}${ext ? `.${ext}` : ""}`;
}

export function storageKeyFor(universityId: string, fileId: string, name: string) {
  return `${universityId}/assignments-polls/files/${fileId}/${safeFileName(name)}`;
}

/** Throws a ValidationError a person can act on when the file can't be accepted. */
export function checkUpload(name: string, sizeBytes: number, maxMb: number): string {
  const type = contentTypeFor(name);
  if (!type) throw new ValidationError(`"${displayName(name)}" isn't a file type assignments accept. Upload a ${ACCEPT_HINT} file.`);
  if (sizeBytes <= 0) throw new ValidationError(`"${displayName(name)}" is empty. Choose the file again.`);
  if (sizeBytes > maxMb * 1024 * 1024) throw new ValidationError(`"${displayName(name)}" is larger than ${maxMb} MB. Make it smaller or split it into parts.`);
  return type;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
