/**
 * File storage contract (contracts.md section 7).
 *
 *   import { storage } from "@/server/core";
 *   await storage().put({ key: `${universityId}/assignments-polls/${id}/${fileName}`, body, contentType });
 *   const url = await storage().signedUrl(key, 600);   // short-lived link for the browser
 *
 * Keys must start with `<universityId>/<module>/` and use only safe path characters.
 * Two implementations, chosen by env (see `storageFromEnv`):
 *   - local disk under ./.storage (default; gitignored), served by /api/storage with an HMAC-signed URL
 *   - any S3-compatible bucket (Cloudflare R2, AWS S3, MinIO), with presigned URLs (SigV4)
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { MODULE_IDS } from "./module";

export type StoredObject = { body: Buffer; contentType: string; size: number };

export interface Storage {
  /** "local" or "s3". */
  name: string;
  put(o: { key: string; body: Buffer | Uint8Array | string; contentType: string }): Promise<{ key: string; size: number }>;
  /** null when the key doesn't exist. */
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  /** A URL anyone holding it can GET for `expiresInSeconds` (max 7 days). */
  signedUrl(key: string, expiresInSeconds: number, opts?: { downloadName?: string }): Promise<string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEGMENT = /^[A-Za-z0-9._ ()+,=@-]+$/;

/** Throws unless the key is `<universityId>/<module>/<path…>` with safe segments. */
export function assertValidKey(key: string): void {
  const parts = key.split("/");
  const [uni, mod, ...rest] = parts;
  const why =
    !uni || !UUID.test(uni)
      ? "must start with the university id"
      : !mod || !(MODULE_IDS as readonly string[]).includes(mod)
        ? "must have a module id as its second part"
        : rest.length === 0
          ? "needs a file path after the module"
          : parts.some((p) => p === "" || p === "." || p === ".." || !SEGMENT.test(p))
            ? "may only use letters, digits, spaces and . _ - ( ) + , = @ in each part"
            : key.length > 512
              ? "is too long (512 characters at most)"
              : null;
  if (why) throw new Error(`Storage key "${key}" ${why}.`);
}

const clampExpiry = (s: number) => Math.max(1, Math.min(Math.floor(s), 7 * 24 * 3600));
const toBuffer = (b: Buffer | Uint8Array | string) => (typeof b === "string" ? Buffer.from(b) : Buffer.from(b));
const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");

/* ───────────────────────────── Local disk ───────────────────────────── */

function localSecret() {
  return process.env.STORAGE_SIGNING_SECRET || process.env.CRON_SECRET || "zinny-local-storage-dev-secret";
}

/** Signature for a local signed URL: HMAC over key, expiry and download name. */
export function signLocal(key: string, expires: number, downloadName = "") {
  return createHmac("sha256", localSecret()).update(`${key}\n${expires}\n${downloadName}`).digest("base64url");
}

export function verifyLocal(key: string, expires: number, downloadName: string, sig: string, now = Date.now()) {
  if (!Number.isFinite(expires) || expires * 1000 < now) return false;
  const want = Buffer.from(signLocal(key, expires, downloadName));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function localStorage(root = resolve(process.cwd(), ".storage"), publicBase = "/api/storage"): Storage {
  const pathOf = (key: string) => {
    assertValidKey(key);
    const p = resolve(root, ...key.split("/"));
    if (!p.startsWith(root + sep)) throw new Error("Storage key escapes the storage folder.");
    return p;
  };
  return {
    name: "local",
    async put({ key, body, contentType }) {
      const p = pathOf(key);
      const buf = toBuffer(body);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, buf);
      await writeFile(`${p}.meta.json`, JSON.stringify({ contentType }));
      return { key, size: buf.length };
    },
    async get(key) {
      const p = pathOf(key);
      try {
        const body = await readFile(p);
        const meta = JSON.parse(await readFile(`${p}.meta.json`, "utf8").catch(() => "{}")) as { contentType?: string };
        return { body, contentType: meta.contentType ?? "application/octet-stream", size: body.length };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async delete(key) {
      const p = pathOf(key);
      await rm(p, { force: true });
      await rm(`${p}.meta.json`, { force: true });
    },
    async signedUrl(key, expiresInSeconds, opts) {
      assertValidKey(key);
      const expires = Math.floor(Date.now() / 1000) + clampExpiry(expiresInSeconds);
      const name = opts?.downloadName ?? "";
      const q = new URLSearchParams({ exp: String(expires), sig: signLocal(key, expires, name) });
      if (name) q.set("name", name);
      return `${publicBase}/${encodeKey(key)}?${q}`;
    },
  };
}

/* ───────────────────────────── S3-compatible (SigV4) ───────────────────────────── */

export type S3Config = {
  /** e.g. https://<account>.r2.cloudflarestorage.com or https://s3.ap-south-1.amazonaws.com */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

const sha256hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function amzDate(now: Date) {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { stamp: iso, day: iso.slice(0, 8) };
}

function signingKey(secret: string, day: string, region: string) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), "s3"), "aws4_request");
}

/**
 * A presigned SigV4 URL (query-string auth). `url` is the full object URL.
 * Exported for tests (checked against the AWS documentation example).
 */
export function presignUrl(o: {
  method: string;
  url: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresInSeconds: number;
  now?: Date;
  extraQuery?: Record<string, string>;
}) {
  const u = new URL(o.url);
  const { stamp, day } = amzDate(o.now ?? new Date());
  const scope = `${day}/${o.region}/s3/aws4_request`;
  const params: Record<string, string> = {
    ...o.extraQuery,
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${o.accessKeyId}/${scope}`,
    "X-Amz-Date": stamp,
    "X-Amz-Expires": String(clampExpiry(o.expiresInSeconds)),
    "X-Amz-SignedHeaders": "host",
  };
  const query = Object.keys(params)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(params[k])}`)
    .join("&");
  const canonical = [o.method, u.pathname, query, `host:${u.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256hex(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(o.secretAccessKey, day, o.region)).update(toSign).digest("hex");
  return `${u.origin}${u.pathname}?${query}&X-Amz-Signature=${signature}`;
}

/** Headers for a signed S3 request (header auth). */
function signedHeaders(o: { method: string; url: URL; region: string; accessKeyId: string; secretAccessKey: string; body: Buffer; contentType?: string }) {
  const { stamp, day } = amzDate(new Date());
  const scope = `${day}/${o.region}/s3/aws4_request`;
  const payloadHash = sha256hex(o.body);
  const headers: Record<string, string> = { host: o.url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp };
  if (o.contentType) headers["content-type"] = o.contentType;
  const names = Object.keys(headers).sort();
  const canonical = [
    o.method,
    o.url.pathname,
    "",
    names.map((n) => `${n}:${headers[n]}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256hex(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(o.secretAccessKey, day, o.region)).update(toSign).digest("hex");
  const { host: _host, ...rest } = headers;
  void _host;
  return { ...rest, authorization: `AWS4-HMAC-SHA256 Credential=${o.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

export function s3Storage(c: S3Config): Storage {
  const urlOf = (key: string) => {
    assertValidKey(key);
    return new URL(`${c.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(c.bucket)}/${encodeKey(key)}`);
  };
  const send = async (method: string, key: string, body = Buffer.alloc(0), contentType?: string) => {
    const url = urlOf(key);
    const headers = signedHeaders({ method, url, region: c.region, accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, body, contentType });
    return fetch(url, { method, headers, body: method === "PUT" ? new Uint8Array(body) : undefined });
  };
  return {
    name: "s3",
    async put({ key, body, contentType }) {
      const buf = toBuffer(body);
      const res = await send("PUT", key, buf, contentType);
      if (!res.ok) throw new Error(`Storage upload failed: ${res.status} ${await res.text()}`);
      return { key, size: buf.length };
    },
    async get(key) {
      const res = await send("GET", key);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Storage download failed: ${res.status} ${await res.text()}`);
      const body = Buffer.from(await res.arrayBuffer());
      return { body, contentType: res.headers.get("content-type") ?? "application/octet-stream", size: body.length };
    },
    async delete(key) {
      const res = await send("DELETE", key);
      if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed: ${res.status} ${await res.text()}`);
    },
    async signedUrl(key, expiresInSeconds, opts) {
      const extraQuery: Record<string, string> = opts?.downloadName
        ? { "response-content-disposition": `attachment; filename="${opts.downloadName.replace(/["\\\r\n]/g, "")}"` }
        : {};
      return presignUrl({
        method: "GET",
        url: urlOf(key).toString(),
        region: c.region,
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
        expiresInSeconds,
        extraQuery,
      });
    },
  };
}

/**
 * Picks the implementation from env:
 *   STORAGE_DRIVER=s3 with S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 *   (and S3_REGION, default "auto" for R2) → S3-compatible bucket
 *   anything else → local disk under STORAGE_DIR (default ./.storage)
 */
export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): Storage {
  if (env.STORAGE_DRIVER === "s3") {
    const missing = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !env[k]);
    if (missing.length) throw new Error(`STORAGE_DRIVER=s3 needs ${missing.join(", ")}.`);
    return s3Storage({
      endpoint: env.S3_ENDPOINT!,
      region: env.S3_REGION || "auto",
      bucket: env.S3_BUCKET!,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    });
  }
  return localStorage(env.STORAGE_DIR ? resolve(env.STORAGE_DIR) : join(process.cwd(), ".storage"));
}
