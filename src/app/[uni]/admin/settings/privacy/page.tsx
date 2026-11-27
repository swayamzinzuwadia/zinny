import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, PageHeader, Stat, Tabs, Td, Table } from "@/components/ui";
import { can, todayIn } from "@/server/core";
import { spaceContext } from "@/server/context";
import { RequestQueue } from "@/modules/privacy/components/request-queue";
import { OneTap } from "@/modules/privacy/components/forms";
import { grievanceOfficer } from "@/modules/privacy/lib/notice";
import { ERASURE_NOTICE_HOURS, INVOICE_RETENTION_YEARS, LOG_RETENTION_DAYS, PURPOSE_LABEL, noticeServed } from "@/modules/privacy/lib/rules";
import { consentSummary } from "@/modules/privacy/services/consents";
import { listRequests } from "@/modules/privacy/services/requests";
import { getRetentionSettings, listRetentionFlags } from "@/modules/privacy/services/retention";
import { decideRequestAction, resolveFlagAction, saveRetentionAction } from "./actions";

export const metadata = { title: "Privacy" };

const TABS = ["requests", "consents", "retention", "processing"] as const;
type Tab = (typeof TABS)[number];

const day = (d: Date) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(d);

/**
 * The institute's privacy desk (privacy.manage): its learners' requests with due dates, the
 * consents it holds, retention of inactive accounts, and how Zinny processes data for it.
 */
export default async function InstitutePrivacyPage({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  if (!can(actor, "privacy.manage", { universityId: university.id })) notFound();
  const tab: Tab = TABS.includes((await searchParams).tab as Tab) ? ((await searchParams).tab as Tab) : "requests";
  const base = `/${uni}/admin/settings/privacy`;
  const today = todayIn(university.timezone);

  const [requests, summary, settings, flags] = await Promise.all([listRequests(actor), consentSummary(actor), getRetentionSettings(actor), listRetentionFlags(actor)]);
  const open = requests.filter((r) => r.status === "open" || r.status === "in_progress");
  const late = open.filter((r) => r.dueOn < today);
  const officer = grievanceOfficer();

  return (
    <>
      <PageHeader
        title="Privacy"
        subtitle={`${university.name} is the Data Fiduciary for its learners under India's DPDP Act. Answer their requests here before the due date.`}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open requests" value={open.length} hint={late.length ? <span className="text-danger">{late.length} past due</span> : "None past due"} />
        <Stat label="Learners with news on" value={summary.find((s) => s.purpose === "marketing")?.live ?? 0} />
        <Stat label="Inactive, flagged" value={flags.length} />
        <Stat label="Retention" value={`${Math.round(settings.inactiveDays / 30.4375)} months`} hint={settings.retentionAction === "anonymise" ? "Then anonymised" : "Then flagged for you"} />
      </div>
      <Tabs
        active={tab}
        tabs={[
          { key: "requests", label: "Requests", href: base, count: open.length },
          { key: "consents", label: "Consents", href: `${base}?tab=consents` },
          { key: "retention", label: "Retention", href: `${base}?tab=retention`, count: flags.length },
          { key: "processing", label: "Data processing", href: `${base}?tab=processing` },
        ]}
      />
      <div className="mt-5">
        {tab === "requests" && <RequestQueue rows={requests} today={today} decide={decideRequestAction.bind(null, uni)} canDecide={() => true} />}

        {tab === "consents" && (
          <Card className="p-5 sm:p-6">
            <CardTitle hint="Each purpose is consented to separately">Consents your learners gave</CardTitle>
            {summary.length === 0 ? (
              <Empty title="No consents recorded yet">They are recorded when learners sign up, fill in their KYC, or switch on news.</Empty>
            ) : (
              <Table head={["Purpose", "Given and live", "Withdrawn"]}>
                {summary.map((s) => (
                  <tr key={s.purpose}>
                    <Td>{PURPOSE_LABEL[s.purpose]}</Td>
                    <Td className="tabular">{s.live}</Td>
                    <Td className="tabular">{s.withdrawn}</Td>
                  </tr>
                ))}
              </Table>
            )}
            <p className="mt-4 text-[13px] text-muted">
              Send news only to learners with &ldquo;News and offers&rdquo; on. Every consent is stored with the notice version shown and a scrambled IP address, and kept at least{" "}
              {LOG_RETENTION_DAYS} days after it is withdrawn.
            </p>
          </Card>
        )}

        {tab === "retention" && (
          <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
            <Card className="p-5 sm:p-6">
              <CardTitle>Retention and grievance contact</CardTitle>
              <ActionForm action={saveRetentionAction.bind(null, uni)} resetOnSuccess={false} className="space-y-4">
                <Field label="Keep inactive learner accounts for (months)" hint="36 months is the period the DPDP Rules use. Between 6 and 120.">
                  <Input name="inactiveMonths" type="number" min={6} max={120} defaultValue={Math.round(settings.inactiveDays / 30.4375)} />
                </Field>
                <fieldset className="space-y-2 text-[14px]">
                  <legend className="mb-1 font-medium">Then</legend>
                  <label className="flex items-start gap-2.5">
                    <input type="radio" name="retentionAction" value="flag" defaultChecked={settings.retentionAction === "flag"} className="mt-1 accent-[var(--color-brand)]" />
                    <span>Flag the account for me to decide</span>
                  </label>
                  <label className="flex items-start gap-2.5">
                    <input type="radio" name="retentionAction" value="anonymise" defaultChecked={settings.retentionAction === "anonymise"} className="mt-1 accent-[var(--color-brand)]" />
                    <span>Anonymise it automatically, {ERASURE_NOTICE_HOURS} hours after telling the learner</span>
                  </label>
                </fieldset>
                <Field label="Your grievance contact (optional)" hint={`Learners see it on their privacy page. Leave empty to use Zinny's: ${officer.email}.`}>
                  <Input name="grievanceName" placeholder="Name or role" defaultValue={settings.grievanceName ?? ""} />
                </Field>
                <Input name="grievanceEmail" type="email" placeholder="privacy@your-institute.edu" defaultValue={settings.grievanceEmail ?? ""} aria-label="Grievance contact email" />
                <SubmitButton icon="check">Save retention settings</SubmitButton>
              </ActionForm>
            </Card>
            <Card className="p-5 sm:p-6">
              <CardTitle hint="Checked every day">Inactive accounts</CardTitle>
              {flags.length === 0 ? (
                <Empty title="Nothing flagged">Learners who don&apos;t sign in or learn for longer than your retention period show here. They are told first, and signing in again keeps their account.</Empty>
              ) : (
                <ul className="divide-y divide-line">
                  {flags.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="font-medium">{f.name}</p>
                        <p className="text-[13px] text-muted">
                          Last active {day(f.lastActiveAt)} · flagged {day(f.flaggedAt)}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <OneTap action={resolveFlagAction.bind(null, uni)} name="flagId" value={f.id} extra={{ outcome: "kept" }} label="Keep account" icon="check" />
                        {noticeServed(f.flaggedAt) ? (
                          <OneTap action={resolveFlagAction.bind(null, uni)} name="flagId" value={f.id} extra={{ outcome: "anonymised" }} label="Remove personal data" icon="delete" variant="quietDanger" />
                        ) : (
                          <Badge tone="gold">Notice period running</Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}

        {tab === "processing" && (
          <Card className="max-w-3xl p-5 sm:p-7">
            <CardTitle>How Zinny processes your learners&apos; data</CardTitle>
            <div className="space-y-3 text-[15px] leading-relaxed">
              <p>
                <span className="font-medium">{university.name} is the Data Fiduciary</span> for its learners, staff and parents: you decide why their data is collected and what it is used
                for. <span className="font-medium">Zinny is your Data Processor</span> (DPDP Act s.8(2)): we process that data only to run Zinny for you, on your instructions, under your
                agreement with us.
              </p>
              <ul className="list-disc space-y-1.5 pl-5 text-[14px]">
                <li>We store data in India (Mumbai region), encrypted in transit; PANs are also encrypted at rest and never shown in full.</li>
                <li>Your space is walled off from every other institute&apos;s by row-level security in the database.</li>
                <li>Zinny support staff enter your space only through time-limited support mode, and every change they make is in your activity log. Direct database access is limited to Zinny Super Admins.</li>
                <li>Our sub-processors: hosting and database, Razorpay for payments, and email and SMS delivery providers.</li>
                <li>If a breach affects your learners, we tell you and them without delay and report it to the Data Protection Board within 72 hours.</li>
                <li>When your agreement ends, we return or erase your data, except invoices ({INVOICE_RETENTION_YEARS} years, GST law) and logs we must keep ({LOG_RETENTION_DAYS} days).</li>
              </ul>
              <p className="text-[14px] text-muted">
                As Fiduciary you answer your learners&apos; requests (the Requests tab), keep your notice to them accurate, and send news only with consent. Learners under 18 need a
                parent&apos;s consent for anything beyond their education. A data processing agreement setting this out is part of your Zinny contract; ask your account manager for a copy.
              </p>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
