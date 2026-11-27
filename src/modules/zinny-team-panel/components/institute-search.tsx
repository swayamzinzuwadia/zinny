"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startTransition } from "react";
import { Combobox, Highlight } from "@/components/combobox";
import { cx } from "@/components/ui";
import { highlightParts } from "./institute-rank";

type Hit = { id: string; name: string; slug: string; status: string; planName: string | null };

const STATUS: Record<string, string> = { active: "Active", suspended: "Suspended", trial: "Trial", frozen: "Frozen" };

async function searchInstitutes(q: string, signal: AbortSignal): Promise<Hit[]> {
  const res = await fetch(`/platform/institutes/search?q=${encodeURIComponent(q)}`, { signal, credentials: "same-origin" });
  if (!res.ok) throw new Error("Search failed");
  return ((await res.json()) as { hits: Hit[] }).hits;
}

/**
 * Finds an institute as you type and opens it. On the institutes page, Enter (or the last
 * row of the list) also filters the table, and clearing the box shows every institute again.
 */
export function InstituteSearch({ variant = "page", className }: { variant?: "page" | "topbar"; className?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const applied = params.get("q") ?? "";
  const onInstitutes = usePathname() === "/platform/institutes";

  function applyToTable(q: string) {
    const next = new URLSearchParams(onInstitutes ? params.toString() : "");
    if (q) next.set("q", q);
    else next.delete("q");
    next.delete("page");
    const href = `/platform/institutes${next.toString() ? `?${next}` : ""}`;
    startTransition(() => (onInstitutes ? router.replace(href, { scroll: false }) : router.push(href)));
  }

  return (
    <Combobox<Hit>
      label="Search institutes"
      placeholder={variant === "topbar" ? "Find an institute" : "Search by name or web address"}
      initialValue={variant === "page" && onInstitutes ? applied : ""}
      search={searchInstitutes}
      itemKey={(h) => h.id}
      hotkey={variant === "topbar" ? "/" : undefined}
      size={variant === "topbar" ? "sm" : "md"}
      className={cx(variant === "topbar" ? "w-full max-w-[340px]" : "w-full sm:w-[340px]", className)}
      renderItem={(h, q) => (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[14px] text-ink">
              <Highlight parts={highlightParts(h.name, q)} />
            </div>
            <div className="truncate text-[12.5px] text-muted">
              zinny.app/<Highlight parts={highlightParts(h.slug, q)} />
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5 text-[12px] text-muted">
            <span>{h.planName ?? "No licence"}</span>
            <span className={h.status === "suspended" ? "text-danger" : undefined}>{STATUS[h.status] ?? h.status}</span>
          </div>
        </div>
      )}
      onChoose={(h) => startTransition(() => router.push(`/platform/institutes/${h.id}`))}
      onSubmit={applyToTable}
      submitLabel={(q) => (onInstitutes ? `Show every institute matching “${q}” in the table` : `See every institute matching “${q}”`)}
      onClear={() => {
        if (variant === "page" && onInstitutes && applied) applyToTable("");
      }}
      emptyText={(q) => `No institute matches “${q}”. Check the spelling, or try part of its web address.`}
    />
  );
}
