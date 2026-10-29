"use client";

/**
 * Shows a lesson PDF inside the page with pdf.js, so it works on phones too (mobile
 * browsers can't show PDFs inline). Pages render at the width of the screen as they
 * scroll into view. If pdf.js can't load the file, it falls back to the browser's viewer
 * and a download link. The file comes from a short-lived signed URL.
 */
import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui";

type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void> };
type PdfPage = {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void>; cancel(): void };
  cleanup(): void;
};

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  return pdfjs;
}

function Page({ doc, n, width }: { doc: PdfDoc; n: number; width: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(n <= 2);
  const [ratio, setRatio] = useState(1.414);

  useEffect(() => {
    const el = holder.current;
    if (!el || visible) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !width) return;
    let task: { cancel(): void } | null = null;
    let cancelled = false;
    void (async () => {
      const page = await doc.getPage(n);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      setRatio(base.height / base.width);
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const viewport = page.getViewport({ scale: (width / base.width) * dpr });
      const c = canvas.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      const t = page.render({ canvasContext: ctx, viewport });
      task = t;
      await t.promise.catch(() => {});
      page.cleanup();
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, n, width, visible]);

  return (
    <div ref={holder} className="relative overflow-hidden rounded-lg bg-white shadow-[0_1px_3px_rgb(20_38_31/0.12)]" style={{ aspectRatio: `1 / ${ratio}` }}>
      <canvas ref={canvas} className="block h-full w-full" aria-label={`Page ${n}`} />
    </div>
  );
}

export function PdfViewer({ src, downloadHref, fileName }: { src: string; downloadHref: string; fileName: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let loaded: PdfDoc | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const task = pdfjs.getDocument({ url: src, isEvalSupported: false, withCredentials: false });
        loaded = (await task.promise) as unknown as PdfDoc;
        if (cancelled) void loaded.destroy();
        else setDoc(loaded);
      } catch (e) {
        console.error("PDF viewer:", e);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
  }, [src]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] text-muted">
          {fileName}
          {doc && ` · ${doc.numPages} page${doc.numPages === 1 ? "" : "s"}`}
        </span>
        <span className="flex gap-2">
          <a href={src} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
            Open full screen
          </a>
          <a href={downloadHref} className={buttonClass("secondary", "sm")}>
            Download
          </a>
        </span>
      </div>
      <div ref={box} className="rounded-[18px] border border-line bg-canvas p-2 sm:rounded-[22px] sm:p-4">
        {failed ? (
          <div className="space-y-3">
            <iframe src={src} title={fileName} className="hidden h-[75vh] w-full rounded-lg bg-white md:block" />
            <p className="px-2 py-6 text-center text-[14px] text-muted md:hidden">
              This PDF can&apos;t be shown here.{" "}
              <a href={src} target="_blank" rel="noreferrer" className="text-brand underline">
                Open it in a new tab
              </a>
              .
            </p>
          </div>
        ) : !doc ? (
          <div className="flex aspect-[1/1.3] items-center justify-center text-[14px] text-muted">Loading the PDF…</div>
        ) : (
          <div className="space-y-3">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <Page key={i} doc={doc} n={i + 1} width={Math.max(0, width - (width < 640 ? 16 : 32))} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
