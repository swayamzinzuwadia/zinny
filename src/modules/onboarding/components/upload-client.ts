/**
 * Sends one document to /[uni]/admin/choose-plan/documents/upload in parts (browser only):
 * start → each part → finish. Resolves with the document id, or throws an Error whose
 * message says what went wrong.
 */
export async function uploadDocument(uni: string, kind: string, file: File, onProgress?: (fraction: number) => void): Promise<string> {
  const base = `/${encodeURIComponent(uni)}/admin/choose-plan/documents/upload`;
  const call = async (query: Record<string, string>, body: BodyInit, type: string) => {
    const res = await fetch(`${base}?${new URLSearchParams(query)}`, { method: "POST", body, headers: { "content-type": type }, credentials: "same-origin" });
    const data = (await res.json().catch(() => ({}))) as { error?: string; documentId?: string; parts?: number; partBytes?: number };
    if (!res.ok) throw new Error(data.error || `${file.name} didn't upload. Check your connection and try again.`);
    return data;
  };
  onProgress?.(0);
  const started = await call({ op: "start" }, JSON.stringify({ kind, fileName: file.name, size: file.size, contentType: file.type }), "application/json");
  const id = started.documentId!;
  const parts = started.parts ?? 1;
  const size = started.partBytes ?? file.size;
  for (let i = 0; i < parts; i++) {
    await call({ op: "part", id, index: String(i) }, file.slice(i * size, Math.min(file.size, (i + 1) * size)), "application/octet-stream");
    onProgress?.((i + 1) / (parts + 1));
  }
  await call({ op: "finish", id }, "{}", "application/json");
  onProgress?.(1);
  return id;
}
