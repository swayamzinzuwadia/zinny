import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Empty, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { platformContext } from "@/server/context";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { Countdown } from "@/modules/privacy/components/countdown";
import { OneTap } from "@/modules/privacy/components/forms";
import { Disclosure } from "@/modules/privacy/components/motion";
import { breachClock, instituteChoices, listBreaches, type BreachRow } from "@/modules/privacy/services/breaches";
import { canPlatformPrivacy } from "@/modules/privacy/services/access";
import { breachStepAction, logBreachAction } from "../actions";

export const metadata = { title: "Breach register" };

const when = (d: Date) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(d);

const STATUS = {
  open: { tone: "danger", label: "Open" },
  contained: { tone: "gold", label: "Contained" },
  closed: { tone: "neutral", label: "Closed" },
} as const;

const nowIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 16);

function Incident({ b }: { b: BreachRow }) {
  const clock = breachClock(b);
  const steps: { step: string; label: string; show: boolean }[] = [
    { step: "board_intimated", label: "Mark Board intimated", show: !b.boardIntimatedAt },
    { step: "principals_notified", label: "Mark people told", show: !b.principalsNotifiedAt },
    { step: "board_report", label: "Mark report sent to Board", show: !b.boardReportAt },
    { step: "contained", label: "Mark contained", show: b.status === "open" },
    { step: "closed", label: "Close incident", show: b.status !== "closed" && !!b.boardReportAt && !!b.principalsNotifiedAt },
    { step: "reopen", label: "Reopen incident", show: b.status === "closed" },
  ];
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-semibold">{b.title}</h2>
            <Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge>
          </div>
          <p className="mt-1 text-[13px] text-muted">
            Zinny became aware {when(b.detectedAt)}
            {b.occurredAt && <> · happened {when(b.occurredAt)}</>}
            {b.principalsAffected !== null && <> · {b.principalsAffected} people affected</>}
            {b.affectedInstitutes.length > 0 && <> · {b.affectedInstitutes.map((i) => i.name).join(", ")}</>}
          </p>
        </div>
      </div>
      <p className="mt-3 text-[14px]">{b.description}</p>
      {b.dataCategories && <p className="mt-1 text-[13px] text-muted">Data: {b.dataCategories}</p>}
      {b.measures && <p className="mt-1 text-[13px] text-muted">Measures: {b.measures}</p>}

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className={b.boardIntimatedAt ? "rounded-2xl border border-line bg-surface px-3.5 py-3" : "rounded-2xl border border-gold/60 bg-gold-soft/60 px-3.5 py-3"}>
          <p className="text-[12px] text-muted">First intimation to the Board</p>
          <p className="mt-0.5 text-[14px] font-medium">{b.boardIntimatedAt ? `Done ${when(b.boardIntimatedAt)}` : "Not yet: send without delay"}</p>
        </div>
        <Countdown label="Detailed report to the Board" due={clock.board.due.toISOString()} done={b.boardReportAt?.toISOString() ?? null} />
        <Countdown label="Affected people told" due={clock.principals.due.toISOString()} done={b.principalsNotifiedAt?.toISOString() ?? null} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {steps
          .filter((s) => s.show)
          .map((s) => (
            <OneTap key={s.step} action={breachStepAction} name="step" value={s.step} extra={{ breachId: b.id }} label={s.label} icon={s.step === "reopen" ? "restore" : s.step === "closed" ? "archive" : "check"} />
          ))}
      </div>
    </Card>
  );
}

/**
 * The breach register (DPDP Act s.8(6), Rule 7): every incident, with the two 72-hour clocks
 * from the moment Zinny became aware: the detailed report to the Data Protection Board, and
 * telling every affected person.
 */
export default async function BreachRegisterPage() {
  const actor = await platformContext();
  if (!canPlatformPrivacy(actor)) return <NoAccess section="the breach register" who="Super Admins and Account Managers" />;
  const [rows, institutes] = await Promise.all([listBreaches(actor), instituteChoices(actor)]);
  const open = rows.filter((r) => r.status !== "closed");

  return (
    <>
      <PageHeader
        title="Breach register"
        subtitle="Log any personal data breach as soon as Zinny knows of it. Tell the Data Protection Board without delay, send it a full report within 72 hours, and tell every affected person."
      />
      <div className="mb-6">
        <Disclosure label="Log an incident" openLabel="Close the form" icon="add" variant="primary">
          <Card className="p-5 sm:p-6">
            <ActionForm action={logBreachAction} className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="What happened, in a line">
                  <Input name="title" placeholder="Attendance export emailed to the wrong address" />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Details" hint="What data, how it was exposed, how you found out, and what you have done so far.">
                  <Textarea name="description" rows={4} />
                </Field>
              </div>
              <Field label="When Zinny became aware (India time)" hint="The 72-hour clocks start here.">
                <Input name="detectedAt" type="datetime-local" defaultValue={nowIst()} />
              </Field>
              <Field label="When it happened, if known">
                <Input name="occurredAt" type="datetime-local" />
              </Field>
              <Field label="Kinds of personal data">
                <Input name="dataCategories" placeholder="Names, emails, attendance" />
              </Field>
              <Field label="People affected, roughly">
                <Input name="principalsAffected" type="number" min={0} inputMode="numeric" />
              </Field>
              <div className="sm:col-span-2">
                <p className="mb-1.5 text-[14px] font-medium">Institutes affected</p>
                <div className="max-h-44 overflow-y-auto rounded-xl border border-line bg-surface p-2">
                  {institutes.map((i) => (
                    <label key={i.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[14px] hover:bg-canvas">
                      <input type="checkbox" name="instituteIds" value={i.id} className="accent-[var(--color-brand)]" />
                      {i.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2">
                <Field label="Measures taken (optional)">
                  <Textarea name="measures" rows={2} />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <SubmitButton icon="add">Log incident</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        </Disclosure>
      </div>

      {rows.length === 0 ? (
        <Empty title="No incidents logged">Every personal data breach goes here, however small, with what was done about it.</Empty>
      ) : (
        <div className="space-y-4">
          {open.length > 0 && <p className="text-[14px] text-muted">{open.length} open</p>}
          {rows.map((b) => (
            <Incident key={b.id} b={b} />
          ))}
        </div>
      )}
    </>
  );
}
