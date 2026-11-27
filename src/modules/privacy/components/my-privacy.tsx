import Link from "next/link";
import { ActionAnchor, Badge, Card, CardTitle, Notice } from "@/components/ui";
import type { FormAction } from "@/components/forms";
import { ESSENTIAL_PURPOSES, OPTIONAL_PURPOSES, PURPOSE_LABEL, PURPOSE_LINE, REQUEST_LABEL, daysLeft, type Purpose } from "../lib/rules";
import type { ConsentRow } from "../services/consents";
import type { MinorState } from "../services/children";
import type { RequestRow } from "../services/requests";
import { AgeForm, OneTap, RequestForm } from "./forms";
import { Disclosure } from "./motion";

export type MyPrivacyProps = {
  /** "institute": this institute's records; "zinny": Zinny's own. */
  scope: "institute" | "zinny";
  fiduciaryName: string;
  consents: (ConsentRow & { fiduciary: "institute" | "zinny" })[];
  requests: RequestRow[];
  minor: MinorState;
  today: string;
  exportHref: string;
  profileHref: string | null;
  grievance: { name: string; email: string; days: number };
  actions: { grant: FormAction; withdraw: FormAction; request: FormAction; age: FormAction; resend: FormAction };
};

const day = (d: Date | string) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(typeof d === "string" ? new Date(`${d}T00:00:00+05:30`) : d);

const STATUS = {
  open: { tone: "gold", label: "Waiting" },
  in_progress: { tone: "gold", label: "Being handled" },
  completed: { tone: "brand", label: "Done" },
  refused: { tone: "danger", label: "Refused" },
} as const;

/** A person's privacy page: consents, their data, requests, age. Mobile first. */
export function MyPrivacy(p: MyPrivacyProps) {
  const mine = p.consents.filter((c) => (p.scope === "institute" ? c.fiduciary === "institute" : c.fiduciary === "zinny"));
  const live = new Map<Purpose, (typeof mine)[number]>();
  for (const c of mine) if (!c.withdrawnAt && !live.has(c.purpose)) live.set(c.purpose, c);
  const withdrawn = mine.filter((c) => c.withdrawnAt && !live.has(c.purpose));
  const purposes: Purpose[] = [...ESSENTIAL_PURPOSES, ...(live.has("kyc") ? (["kyc"] as const) : []), ...OPTIONAL_PURPOSES, ...(live.has("guardian") ? (["guardian"] as const) : [])];
  const blocked = p.minor.minor && !p.minor.verified;
  const zinnyLive = p.scope === "institute" ? p.consents.filter((c) => c.fiduciary === "zinny" && !c.withdrawnAt) : [];
  const requests = p.requests.filter((r) => r.kind !== "access");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.01em] sm:text-[30px]">Your privacy</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          What {p.fiduciaryName} holds about you, what you&apos;ve agreed to, and how to change it. Read the{" "}
          <Link href="/privacy" className="text-brand underline underline-offset-2">
            privacy notice
          </Link>
          .
        </p>
      </div>

      {blocked && p.minor.minor && (
        <Card id="guardian" className="scroll-mt-6 border-gold/60 p-5">
          <div className="flex items-start gap-3">
            <span aria-hidden className="dp-pulse mt-2 size-2 shrink-0 rounded-full bg-gold" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Waiting for your parent or guardian</p>
              <p className="mt-1 text-[14px] text-muted">
                We sent {p.minor.guardianName} a link at {p.minor.contact} on {day(p.minor.sentAt)}. Until they confirm, news, analytics and anything that tracks how you learn stay
                off. {p.minor.expiresAt < new Date() ? "The link has expired." : `The link works until ${day(p.minor.expiresAt)}.`}
              </p>
              <div className="mt-3">
                <OneTap action={p.actions.resend} label="Send a new link" icon="resend" variant="secondary" />
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-5 sm:p-6">
        <CardTitle hint={p.scope === "institute" ? p.fiduciaryName : "Zinny"}>What you&apos;ve agreed to</CardTitle>
        <ul className="divide-y divide-line">
          {purposes.map((purpose) => {
            const c = live.get(purpose);
            const essential = ESSENTIAL_PURPOSES.includes(purpose);
            return (
              <li key={purpose} className="flex flex-col gap-2 py-3.5 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{PURPOSE_LABEL[purpose]}</span>
                    {c ? <Badge tone="brand">On since {day(c.grantedAt)}</Badge> : <Badge>Off</Badge>}
                  </div>
                  <p className="mt-1 text-[13px] text-muted">{PURPOSE_LINE[purpose]}</p>
                  {c && <p className="mt-0.5 text-[12px] text-faint">Notice version {c.noticeVersion}</p>}
                </div>
                <div className="shrink-0">
                  {essential ? (
                    <span className="text-[12px] text-muted">{c ? "Needed for your account" : ""}</span>
                  ) : c ? (
                    <OneTap action={p.actions.withdraw} name="consentId" value={c.id} label="Withdraw" icon="close" />
                  ) : OPTIONAL_PURPOSES.includes(purpose) ? (
                    blocked ? (
                      <span className="text-[12px] text-muted">Needs your guardian first</span>
                    ) : (
                      <OneTap action={p.actions.grant} name="purpose" value={purpose} label="Switch on" icon="check" />
                    )
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {withdrawn.length > 0 && (
          <p className="mt-2 text-[13px] text-muted">
            Withdrawn: {withdrawn.map((c) => `${PURPOSE_LABEL[c.purpose]} on ${day(c.withdrawnAt!)}`).join("; ")}. Withdrawing doesn&apos;t undo what was done before.
          </p>
        )}
        {zinnyLive.length > 0 && (
          <p className="mt-3 text-[13px] text-muted">
            Your Zinny account itself (used across institutes and the marketplace) has its own consents.{" "}
            <Link href="/privacy/my" className="text-brand underline underline-offset-2">
              See them
            </Link>
            .
          </p>
        )}
      </Card>

      <Card className="p-5 sm:p-6">
        <CardTitle>Your data</CardTitle>
        <p className="text-[14px] text-muted">
          A file with your profile, {p.scope === "institute" ? "roles, " : ""}enrolments, orders and invoices, KYC status (PAN masked), consents and requests. It downloads straight away.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionAnchor href={p.exportHref} download size="md" className="border border-line">
            Download my data
          </ActionAnchor>
          {p.profileHref && (
            <ActionAnchor href={p.profileHref} icon="edit" size="md">
              Change name or mobile
            </ActionAnchor>
          )}
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <CardTitle hint={`Answered within ${p.grievance.days} days`}>Ask {p.scope === "institute" ? p.fiduciaryName : "Zinny"}</CardTitle>
        <RequestForm action={p.actions.request} />
      </Card>

      {requests.length > 0 && (
        <Card className="p-5 sm:p-6">
          <CardTitle>Your requests</CardTitle>
          <ul className="divide-y divide-line">
            {requests.map((r) => {
              const left = daysLeft(r.dueOn, p.today);
              const open = r.status === "open" || r.status === "in_progress";
              return (
                <li key={r.id} className="py-3 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{REQUEST_LABEL[r.kind]}</span>
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    <span className="text-[12px] text-muted">
                      Sent {day(r.createdAt)}
                      {open ? ` · answer due ${day(r.dueOn)}${left < 0 ? " (late)" : ""}` : r.closedAt ? ` · closed ${day(r.closedAt)}` : ""}
                    </span>
                  </div>
                  {r.details && <p className="mt-1 text-[13px] text-muted">{r.details}</p>}
                  {r.response && <p className="mt-1.5 rounded-xl bg-canvas px-3 py-2 text-[13px]">{r.response}</p>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {!p.minor.minor && (
        <Card className="p-5 sm:p-6">
          <CardTitle>Under 18?</CardTitle>
          <p className="mb-3 text-[14px] text-muted">Learners under 18 need a parent or guardian&apos;s consent. Tell us if that&apos;s you, and we&apos;ll ask them.</p>
          <Disclosure label="Tell us your age" icon="edit" size="sm">
            <div className="rounded-2xl border border-line bg-canvas p-4">
              <AgeForm action={p.actions.age} />
            </div>
          </Disclosure>
        </Card>
      )}

      <Notice tone="neutral">
        Not happy with an answer? Write to {p.grievance.name} at{" "}
        <a href={`mailto:${p.grievance.email}`} className="text-brand underline underline-offset-2">
          {p.grievance.email}
        </a>
        . If that doesn&apos;t resolve it, you can complain to the Data Protection Board of India.
      </Notice>
    </div>
  );
}
