import Link from "next/link";
import { Badge, cx, Table, Td } from "@/components/ui";
import { CHANNEL_LABEL, CHANNELS, STATE_LABEL } from "../kinds";
import type { ChannelState } from "../schema";
import type { KindSummary } from "../service";

const STATE_TONE: Record<ChannelState, string> = {
  on: "bg-brand-soft text-brand-strong",
  optional: "bg-canvas text-ink ring-1 ring-line",
  off: "text-faint",
};

function State({ state }: { state: ChannelState }) {
  return <span className={cx("inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium", STATE_TONE[state])}>{STATE_LABEL[state]}</span>;
}

/** Every kind with its channel defaults. Each row opens the editor. */
export function KindsTable({ kinds, hrefFor }: { kinds: KindSummary[]; hrefFor: (kind: string) => string }) {
  const groups = [
    { title: "For learners", rows: kinds.filter((k) => k.core && k.audience === "learners") },
    { title: "For staff", rows: kinds.filter((k) => k.core && k.audience === "staff") },
    { title: "From other parts of Zinny", rows: kinds.filter((k) => !k.core && !k.security) },
    { title: "Security messages", rows: kinds.filter((k) => k.security) },
  ].filter((g) => g.rows.length > 0);

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.title}>
          <h3 className="mb-2 px-1 text-[13px] text-muted">{g.title}</h3>
          <Table head={["Notification", ...CHANNELS.map((c) => CHANNEL_LABEL[c]), ""]}>
            {g.rows.map((k) => (
              <tr key={k.kind} className="hover:bg-canvas/60">
                <Td>
                  <Link href={hrefFor(k.kind)} className="font-medium hover:text-brand">
                    {k.label}
                  </Link>
                  <div className="mt-0.5 max-w-md text-[12.5px] leading-snug text-muted">{k.description}</div>
                </Td>
                {k.security ? (
                  <td colSpan={CHANNELS.length} className="px-5 py-3.5 align-top text-[13px] text-muted">
                    Always sent, at any hour, on the channel the sender uses
                  </td>
                ) : (
                  CHANNELS.map((c) => (
                    <Td key={c}>
                      <State state={k.channels[c]} />
                    </Td>
                  ))
                )}
                <Td className="text-right">
                  <span className="inline-flex items-center gap-2">
                    {k.customized && <Badge tone="brand">Custom text</Badge>}
                    <Link href={hrefFor(k.kind)} className="text-[13px] font-medium text-brand hover:underline">
                      Edit
                    </Link>
                  </span>
                </Td>
              </tr>
            ))}
          </Table>
        </section>
      ))}
    </div>
  );
}
