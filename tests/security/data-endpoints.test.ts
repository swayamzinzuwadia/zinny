/**
 * Endpoints and files (security review DATA-07, DATA-09, DATA-10):
 *   - /api/storage serves only signed, unexpired links; a stored HTML or SVG file is always a
 *     download, never a page on Zinny's origin; in production it refuses to serve when no
 *     signing secret is set, because the development secret would make links forgeable;
 *   - the cron endpoints need the exact CRON_SECRET;
 *   - the payment webhook refuses unsigned calls;
 *   - the demo seed (a Super Admin and accounts with a known password) refuses production.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { closeDb } from "@/db/client";
import { signLocal } from "@/contracts/storage";
import { storage } from "@/server/core";
import { fileHeaders, inlineType, signingSecretConfigured } from "@/server/storage-serve";
import { seedRefusal } from "@/db/seed";

afterAll(closeDb);
afterEach(() => vi.unstubAllEnvs());

let dir = "";
const before = process.env.STORAGE_DIR;
const UNI = randomUUID();

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "zinny-sec-storage-"));
  process.env.STORAGE_DIR = dir;
});
afterAll(() => {
  if (before === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = before;
  rmSync(dir, { recursive: true, force: true });
});

async function fetchSigned(url: string) {
  const { GET } = await import("@/app/api/storage/[...key]/route");
  const u = new URL(url, "http://localhost");
  const parts = u.pathname.replace(/^\/api\/storage\//, "").split("/");
  return GET(new Request(u), { params: Promise.resolve({ key: parts }) });
}

describe("/api/storage", () => {
  it("serves a signed link, and refuses a forged, altered or expired one", async () => {
    const key = `${UNI}/assignments-polls/sec/answer.pdf`;
    await storage().put({ key, body: Buffer.from("%PDF-1.4 hello"), contentType: "application/pdf" });
    const url = await storage().signedUrl(key, 60);
    expect((await fetchSigned(url)).status).toBe(200);

    const forged = new URL(url, "http://localhost");
    forged.searchParams.set("sig", signLocal(key, Number(forged.searchParams.get("exp")), "").replace(/^./, (c) => (c === "A" ? "B" : "A")));
    expect((await fetchSigned(forged.toString())).status).toBe(403);

    // Another institute's file with this institute's signature.
    const other = new URL(url.replace(UNI, randomUUID()), "http://localhost");
    expect((await fetchSigned(other.toString())).status).toBe(403);

    const expired = new URL(url, "http://localhost");
    const past = Math.floor(Date.now() / 1000) - 10;
    expired.searchParams.set("exp", String(past));
    expired.searchParams.set("sig", signLocal(key, past, ""));
    expect((await fetchSigned(expired.toString())).status).toBe(403);
  });

  it("never serves an HTML or SVG file as a page: it is a download, sandboxed and not sniffed", async () => {
    for (const [name, type, body] of [
      ["evil.html", "text/html", "<script>alert(document.cookie)</script>"],
      ["evil.svg", "image/svg+xml", "<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"],
      ["evil.xml", "application/xhtml+xml", "<html xmlns='http://www.w3.org/1999/xhtml'><script>alert(1)</script></html>"],
    ] as const) {
      const key = `${UNI}/assignments-polls/sec/${name}`;
      await storage().put({ key, body, contentType: type });
      const res = await fetchSigned(await storage().signedUrl(key, 60));
      expect(res.status, name).toBe(200);
      expect(res.headers.get("content-type"), name).toBe("application/octet-stream");
      expect(res.headers.get("content-disposition"), name).toMatch(/^attachment; filename="evil\./);
      expect(res.headers.get("x-content-type-options"), name).toBe("nosniff");
      expect(res.headers.get("content-security-policy"), name).toContain("sandbox");
    }
  });

  it("opens PDFs, images and video inline, as their own type", async () => {
    expect(inlineType("application/pdf")).toBe("application/pdf");
    expect(inlineType("image/PNG")).toBe("image/png");
    expect(inlineType("video/mp4")).toBe("video/mp4");
    expect(inlineType("text/html; charset=utf-8")).toBeNull();
    expect(inlineType("image/svg+xml")).toBeNull();
    const png = fileHeaders({ contentType: "image/png", size: 10 }, `${UNI}/website-builder/a.png`, "");
    expect(png["content-disposition"]).toBeUndefined();
    expect(png["content-security-policy"]).toBe("default-src 'none'; sandbox");
    const named = fileHeaders({ contentType: "application/pdf", size: 10 }, `${UNI}/payments/x.pdf`, 'Invoice "1"\r\nSet-Cookie: a=b.pdf');
    expect(named["content-disposition"]).toBe('attachment; filename="Invoice 1Set-Cookie: a=b.pdf"');
  });

  it("refuses keys that leave the institute's folder", async () => {
    const res = await fetchSigned(`/api/storage/${UNI}/assignments-polls/..%2F..%2Fetc/passwd?exp=9999999999&sig=x`);
    expect([403, 404]).toContain(res.status);
    await expect(storage().put({ key: `${UNI}/assignments-polls/../../escape.txt`, body: "x", contentType: "text/plain" })).rejects.toThrow(/Storage key/);
  });

  it("in production, serves nothing until a real signing secret is set", async () => {
    expect(signingSecretConfigured({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    expect(signingSecretConfigured({ NODE_ENV: "production", STORAGE_SIGNING_SECRET: "s" } as NodeJS.ProcessEnv)).toBe(true);
    expect(signingSecretConfigured({ NODE_ENV: "production", CRON_SECRET: "c" } as NodeJS.ProcessEnv)).toBe(true);
    expect(signingSecretConfigured({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);

    const key = `${UNI}/assignments-polls/sec/prod.pdf`;
    await storage().put({ key, body: Buffer.from("%PDF-1.4"), contentType: "application/pdf" });
    const url = await storage().signedUrl(key, 60);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STORAGE_SIGNING_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    expect((await fetchSigned(url)).status).toBe(503);
  });
});

describe("cron endpoints", () => {
  const call = async (path: "run" | "events", auth?: string, query = "") => {
    const mod = path === "run" ? await import("@/app/api/jobs/run/route") : await import("@/app/api/jobs/events/route");
    const headers: Record<string, string> = auth === undefined ? {} : { authorization: auth };
    return mod.GET(new Request(`http://localhost/api/jobs/${path}${query}`, { headers }));
  };

  it("need the exact CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "correct-horse-battery-staple");
    for (const path of ["run", "events"] as const) {
      expect((await call(path)).status, path).toBe(401);
      expect((await call(path, "Bearer wrong")).status, path).toBe(401);
      expect((await call(path, "Bearer correct-horse-battery-stapl")).status, path).toBe(401);
      expect((await call(path, "correct-horse-battery-staple")).status, path).toBe(401);
    }
    // The right secret gets past the check (an unknown schedule is refused before anything runs).
    expect((await call("run", "Bearer correct-horse-battery-staple", "?every=never")).status).toBe(400);
  });

  it("are closed when CRON_SECRET isn't set, even to an empty bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("run", "Bearer ", "?every=day")).status).toBe(401);
    expect((await call("events", "Bearer ")).status).toBe(401);
  });
});

describe("payment webhook", () => {
  it("refuses calls while Razorpay isn't configured, whatever they claim", async () => {
    const { POST } = await import("@/app/api/payments/razorpay/route");
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_x", order_id: "order_x", amount: 100 } } } });
    const res = await POST(new Request("http://localhost/api/payments/razorpay", { method: "POST", body, headers: { "x-razorpay-signature": "anything" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "razorpay_not_configured" });
  });
});

describe("demo data never reaches production", () => {
  it("the seed refuses production unless it is a demo deployment", () => {
    expect(seedRefusal({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toMatch(/Refusing to seed/);
    expect(seedRefusal({ NODE_ENV: "development", VERCEL_ENV: "production" } as NodeJS.ProcessEnv)).toMatch(/Refusing to seed/);
    expect(seedRefusal({ NODE_ENV: "production", ZINNY_DEMO: "1" } as NodeJS.ProcessEnv)).toBeNull();
    expect(seedRefusal({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBeNull();
  });
});
