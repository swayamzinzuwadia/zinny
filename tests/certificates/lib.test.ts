import { describe, expect, it } from "vitest";
import {
  addMonths,
  downloadName,
  effectiveStatus,
  formatCode,
  newCode,
  normalizeCode,
  validUntilFor,
  verifyBaseUrl,
} from "@/modules/certificates/lib";
import { clientKey, createRateLimiter } from "@/modules/certificates/rate-limit";
import { imageInfo, qrMatrix, renderCertificatePdf, renderCertificateSvg } from "@/modules/certificates/render";
import { measurer } from "@/modules/certificates/render/fonts";
import { accentFrom, fitBlock } from "@/modules/certificates/render/scene";
import { signaturePng } from "@/modules/certificates/render/signature";

describe("certificate codes", () => {
  it("are 12 characters of Crockford base32 and practically unique", () => {
    const codes = new Set(Array.from({ length: 5000 }, newCode));
    expect(codes.size).toBe(5000);
    for (const c of [...codes].slice(0, 200)) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
  });

  it("normalise what people type, and reject anything that can't be a code", () => {
    expect(normalizeCode("7k3p-9qxa-m2d4")).toBe("7K3P9QXAM2D4");
    expect(normalizeCode(" 7K3P 9QXA M2D4 ")).toBe("7K3P9QXAM2D4");
    expect(normalizeCode("7K3P-9QXA-M2DO")).toBe("7K3P9QXAM2D0");
    expect(normalizeCode("7K3P-9QXA-M2DI")).toBe("7K3P9QXAM2D1");
    expect(normalizeCode("7K3P-9QXA-M2D")).toBeNull();
    expect(normalizeCode("7K3P-9QXA-M2DU")).toBeNull();
    expect(normalizeCode("7K3P%")).toBeNull();
    expect(normalizeCode(null)).toBeNull();
    expect(formatCode("7K3P9QXAM2D4")).toBe("7K3P-9QXA-M2D4");
  });
});

describe("validity and status", () => {
  it("adds calendar months and ends the day before", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(validUntilFor("2026-10-12", 12)).toBe("2027-10-11");
    expect(validUntilFor("2026-10-12", null)).toBeNull();
  });

  it("revoked wins, then expired after the last valid day", () => {
    expect(effectiveStatus({ status: "valid", validUntil: null }, "2099-01-01")).toBe("valid");
    expect(effectiveStatus({ status: "valid", validUntil: "2027-10-11" }, "2027-10-11")).toBe("valid");
    expect(effectiveStatus({ status: "valid", validUntil: "2027-10-11" }, "2027-10-12")).toBe("expired");
    expect(effectiveStatus({ status: "expired", validUntil: "2027-10-11" }, "2020-01-01")).toBe("expired");
    expect(effectiveStatus({ status: "revoked", validUntil: "2027-10-11" }, "2027-12-01")).toBe("revoked");
  });
});

describe("links and names", () => {
  it("uses CERTIFICATE_VERIFY_BASE_URL, and refuses to guess in production", () => {
    expect(verifyBaseUrl({ CERTIFICATE_VERIFY_BASE_URL: "https://app.zinny.in/" } as unknown as NodeJS.ProcessEnv)).toBe("https://app.zinny.in");
    expect(verifyBaseUrl({ PORT: "3105" } as unknown as NodeJS.ProcessEnv)).toBe("http://localhost:3105");
    expect(() => verifyBaseUrl({ NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toThrow(/CERTIFICATE_VERIFY_BASE_URL/);
    expect(() => verifyBaseUrl({ CERTIFICATE_VERIFY_BASE_URL: "javascript:alert(1)" } as unknown as NodeJS.ProcessEnv)).toThrow();
  });

  it("download names are plain ASCII", () => {
    expect(downloadName("Certificate", "Data Analytics", "Riya Śharmā")).toBe("Certificate - Data Analytics - Riya Sharma.pdf");
    expect(downloadName('a"b\r\n', "")).toBe("ab -.pdf");
    expect(downloadName("रिया")).toBe("Certificate.pdf");
  });
});

describe("rate limiter", () => {
  it("allows the limit per window and per key", () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 1000 });
    expect([1, 2, 3].map(() => rl.take("a", 0).ok)).toEqual([true, true, true]);
    expect(rl.take("a", 10)).toEqual({ ok: false, retryAfterSeconds: 1 });
    expect(rl.take("b", 10).ok).toBe(true);
    expect(rl.take("a", 1001).ok).toBe(true);
  });

  it("keeps a bounded number of keys", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
    rl.take("a", 0);
    rl.take("b", 0);
    rl.take("c", 0);
    expect(rl.take("a", 1).ok).toBe(true); // "a" was evicted
  });

  it("reads the visitor from forwarding headers", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientKey(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientKey(new Headers())).toBe("unknown");
  });
});

describe("rendering", () => {
  it("reads PNG sizes and refuses other files", () => {
    const png = signaturePng("Asha Admin", 480, 150);
    expect(imageInfo(png)).toMatchObject({ mime: "image/png", width: 480, height: 150 });
    expect(imageInfo(Buffer.from("GIF89a....."))).toBeNull();
    // A minimal JPEG header with a SOF0 frame of 640×200.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0xc8, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00]);
    expect(imageInfo(jpeg)).toMatchObject({ mime: "image/jpeg", width: 640, height: 200 });
  });

  it("brand colours fall back to Zinny green", () => {
    expect(accentFrom("#1A2B3C")).toBe("#1a2b3c");
    expect(accentFrom("#abc")).toBe("#aabbcc");
    expect(accentFrom("red; background:url(x)")).toBe("#0b5e4c");
    expect(accentFrom(undefined)).toBe("#0b5e4c");
  });

  it("wraps long text instead of overflowing", async () => {
    const m = await measurer();
    const r = fitBlock(m, "sansBold", "Advanced Professional Certificate Programme in Business Analytics and Machine Learning", { max: 24, min: 14, maxWidth: 400, maxLines: 2 });
    expect(r.lines).toHaveLength(2);
    for (const l of r.lines) expect(m("sansBold", l, r.size)).toBeLessThanOrEqual(400);
  });

  it("draws every design as a PDF with the text in it and as matching SVG", async () => {
    for (const design of ["classic", "modern", "minimal"] as const) {
      const c = {
        design,
        universityName: "Demo University",
        logo: null,
        accentColor: "#0b5e4c",
        heading: "Certificate of completion",
        intro: "This is to certify that",
        body: "has successfully completed the course",
        studentName: "Riya Sharma",
        courseTitle: "Python Basics",
        completedOn: "2026-10-12",
        validUntil: "2028-10-11",
        code: "7K3P-9QXA-M2D4",
        verifyUrl: "https://app.zinny.in/verify/7K3P-9QXA-M2D4",
        signatories: [{ name: "Asha Admin", title: "Director", image: imageInfo(signaturePng("Asha Admin")) }],
      };
      const pdf = Buffer.from(await renderCertificatePdf(c));
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      const svg = await renderCertificateSvg(c);
      expect(svg).toContain("Riya Sharma");
      expect(svg).toContain("7K3P-9QXA-M2D4");
      expect(svg).toContain('viewBox="0 0 841.89 595.28"');
    }
    expect(qrMatrix("https://app.zinny.in/verify/7K3P-9QXA-M2D4").size).toBeGreaterThanOrEqual(21);
  });
});
