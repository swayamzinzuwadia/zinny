/**
 * Renders module UI registered into core pages (contracts.md section 3).
 * Server components only. Every slot area renders nothing when nothing is registered,
 * and one failing module never takes the page down: its area shows a short notice
 * (with the error in development) and the error is logged.
 */
import { unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import type { SlotComponent } from "@/contracts/module";
import { Notice } from "./ui";

async function renderEntry<P>(slot: string, key: string, component: SlotComponent<P>, props: P): Promise<ReactNode> {
  try {
    // Server components are plain (async) functions: calling it here lets us catch its errors.
    return await component(props);
  } catch (e) {
    unstable_rethrow(e); // notFound(), redirect() and Next's dynamic-rendering signals pass through
    console.error(`[slots] ${slot}.${key} failed:`, e);
    return (
      <Notice tone="danger">
        This part of the page couldn&apos;t load. Refresh to try again.
        {process.env.NODE_ENV !== "production" && e instanceof Error && (
          <span className="mt-1 block font-mono text-[12px]">
            {slot}.{key}: {e.message}
          </span>
        )}
      </Notice>
    );
  }
}

/** One slot entry (used for the selected tab). */
export async function SlotOutlet<P>({ slot, entry, props }: { slot: string; entry: { key: string; component: SlotComponent<P> }; props: P }) {
  return <div data-slot={slot} data-slot-key={entry.key}>{await renderEntry(slot, entry.key, entry.component, props)}</div>;
}

/** Every entry of a slot, in order. Renders nothing at all when the list is empty. */
export async function SlotList<P>({
  slot,
  entries,
  props,
  className = "space-y-6",
}: {
  slot: string;
  entries: { key: string; component: SlotComponent<P> }[];
  props: P;
  className?: string;
}) {
  if (entries.length === 0) return null;
  const rendered = await Promise.all(entries.map((e) => renderEntry(slot, e.key, e.component, props)));
  const shown = entries.map((e, i) => ({ key: e.key, node: rendered[i] })).filter((x) => x.node !== null && x.node !== undefined && x.node !== false);
  if (shown.length === 0) return null;
  return (
    <div className={className} data-slot={slot}>
      {shown.map((x) => (
        <div key={x.key} data-slot-key={x.key}>
          {x.node}
        </div>
      ))}
    </div>
  );
}
