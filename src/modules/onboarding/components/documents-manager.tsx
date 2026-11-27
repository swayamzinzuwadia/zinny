"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ActionIcon, Badge, buttonClass, cx } from "@/components/ui";
import { DOCUMENT_ACCEPT, DOCUMENT_KINDS, DOCUMENT_TYPES, documentProblem, formatBytes } from "../lib/constants";
import { FileDrop } from "./file-drop";
import { uploadDocument } from "./upload-client";
import "./motion.css";

/** What the page knows about a document on file. Safe to send to the browser. */
export type DocumentOnFile = {
  id: string;
  kind: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: "uploading" | "pending" | "approved" | "rejected";
  reviewerNote: string | null;
  uploadedOn: string;
};

const STATUS: Record<string, { tone: "brand" | "gold" | "danger" | "neutral"; label: string }> = {
  pending: { tone: "gold", label: "Waiting for review" },
  approved: { tone: "brand", label: "Approved" },
  rejected: { tone: "danger", label: "Needs a new file" },
};

type Busy = { kind: string; file: File; fraction: number };

/**
 * The institute's documents in its admin: what is on file and what the Zinny team said, with
 * Open, Replace and Remove; and a drop zone for each kind not sent yet. A chosen file goes up
 * straight away. The PAN card can be replaced but not removed.
 */
export function DocumentsManager({
  uni,
  documents,
  remove,
}: {
  uni: string;
  documents: DocumentOnFile[];
  remove: (documentId: string) => Promise<{ ok?: string; error?: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [done, setDone] = useState<string | null>(null);
  const [removing, startRemove] = useTransition();
  const pickers = useRef<Record<string, HTMLInputElement | null>>({});

  const send = async (kind: string, file: File) => {
    const problem = documentProblem(file);
    setErrors((e) => ({ ...e, [kind]: problem }));
    setDone(null);
    if (problem) return;
    setBusy({ kind, file, fraction: 0 });
    try {
      await uploadDocument(uni, kind, file, (fraction) => setBusy({ kind, file, fraction }));
      setDone(`${file.name} is uploaded. The Zinny team will review it.`);
      router.refresh();
    } catch (e) {
      setErrors((er) => ({ ...er, [kind]: e instanceof Error ? e.message : "This file didn't upload. Try again." }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {done && (
        <p role="status" className="onb-pop rounded-xl bg-brand-soft px-4 py-3 text-[14px] text-brand-strong">
          {done}
        </p>
      )}
      <ul className="grid gap-4 lg:grid-cols-2">
        {DOCUMENT_KINDS.map((k) => {
          const onFile = documents.filter((d) => d.kind === k.key);
          const sending = busy?.kind === k.key ? busy : null;
          return (
            <li key={k.key} className="rounded-2xl bg-surface p-5 ring-1 ring-line">
              <input
                ref={(el) => {
                  pickers.current[k.key] = el;
                }}
                type="file"
                accept={DOCUMENT_ACCEPT}
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void send(k.key, f);
                }}
              />
              {onFile.length === 0 || sending ? (
                <FileDrop
                  label={k.label}
                  hint={k.hint}
                  required={k.required}
                  file={sending?.file ?? null}
                  progress={sending?.fraction ?? null}
                  error={errors[k.key]}
                  onChange={(file) => {
                    if (file) void send(k.key, file);
                    else setErrors((e) => ({ ...e, [k.key]: null }));
                  }}
                />
              ) : (
                <div>
                  <div className="mb-3 flex items-baseline justify-between gap-3">
                    <h3 className="text-[14px] font-medium">{k.label}</h3>
                    {k.required ? <Badge tone="neutral">Required</Badge> : <span className="text-[12px] text-muted">Optional</span>}
                  </div>
                  <ul className="space-y-3">
                    {onFile.map((d) => {
                      const st = STATUS[d.status] ?? STATUS.pending;
                      return (
                        <li key={d.id} className="onb-pop rounded-xl border border-line bg-canvas/60 p-3">
                          <div className="flex items-center gap-3">
                            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-[11px] font-semibold text-brand-strong">
                              {DOCUMENT_TYPES[d.contentType]?.label ?? "File"}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[14px] font-medium" title={d.fileName}>
                                {d.fileName}
                              </div>
                              <div className="text-[12px] text-muted">
                                {formatBytes(d.sizeBytes)} · uploaded {d.uploadedOn}
                              </div>
                            </div>
                            <Badge tone={st.tone}>{st.label}</Badge>
                          </div>
                          {d.status === "rejected" && d.reviewerNote && (
                            <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">The Zinny team says: {d.reviewerNote}</p>
                          )}
                          {d.status === "approved" && d.reviewerNote && <p className="mt-2 text-[13px] text-muted">Note from the Zinny team: {d.reviewerNote}</p>}
                          <div className="mt-2 flex flex-wrap gap-1">
                            <a href={`/${uni}/admin/choose-plan/documents/${d.id}`} target="_blank" rel="noopener" className={buttonClass("quiet", "sm")}>
                              <ActionIcon name="open" />
                              Open
                            </a>
                            <button type="button" onClick={() => pickers.current[k.key]?.click()} disabled={!!busy} className={buttonClass("quiet", "sm")}>
                              <ActionIcon name="upload" />
                              {k.key === "registration" ? "Upload another" : "Replace"}
                            </button>
                            {k.key !== "pan" && (
                              <button
                                type="button"
                                disabled={removing || !!busy}
                                onClick={() =>
                                  startRemove(async () => {
                                    if (!window.confirm(`Remove ${d.fileName}? The Zinny team keeps a record of it.`)) return;
                                    const res = await remove(d.id);
                                    if (res.error) setErrors((e) => ({ ...e, [k.key]: res.error! }));
                                    else {
                                      setDone(res.ok ?? "Removed.");
                                      router.refresh();
                                    }
                                  })
                                }
                                className={buttonClass("quietDanger", "sm")}
                              >
                                <ActionIcon name="delete" />
                                Remove
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {errors[k.key] && (
                    <p role="alert" className={cx("onb-pop mt-2 text-[13px] text-danger")}>
                      {errors[k.key]}
                    </p>
                  )}
                  <p className="mt-2 text-[12px] text-muted">{k.hint}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
