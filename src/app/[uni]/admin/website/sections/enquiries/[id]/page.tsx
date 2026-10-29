import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Select, Textarea, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { canManageSite } from "@/modules/website-builder/access";
import { assignEnquiryAction, enquiryNoteAction, enquiryStatusAction } from "@/modules/website-builder/actions";
import { ActionButton } from "@/modules/website-builder/components/action-button";
import { NoAccess } from "@/modules/website-builder/components/admin";
import { ENQUIRY_STATUSES, ENQUIRY_STATUS_LABEL, getEnquiry } from "@/modules/website-builder/enquiries";
import { formatMoment } from "@/modules/website-builder/format";

export const metadata = { title: "Enquiry" };

const TONE = { new: "gold", contacted: "brand", closed: "neutral" } as const;

export default async function EnquiryPage({ params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  const { actor, university } = await spaceContext(uni);
  if (!canManageSite(actor)) return <NoAccess uni={uni} />;
  const e = await getEnquiry(actor, id).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const tz = university.timezone;
  const mailSubject = encodeURIComponent(`Your enquiry${e.courseTitle ? ` about ${e.courseTitle}` : ""} at ${university.name}`);

  return (
    <>
      <Link href={`/${uni}/admin/website/sections/enquiries`} className="text-sm text-muted hover:text-ink">
        ← Enquiries
      </Link>
      <div className="mb-8 mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-semibold leading-tight">{e.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[15px] text-muted">
            <Badge tone={TONE[e.status]}>{ENQUIRY_STATUS_LABEL[e.status]}</Badge>
            <span>Received {formatMoment(e.createdAt, tz)}</span>
            <span>{e.source === "course" ? "from a course page" : "from the home page"}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {ENQUIRY_STATUSES.filter((s) => s !== e.status).map((s) => (
            <ActionButton key={s} action={enquiryStatusAction} fields={{ uni, id: e.id, status: s }} variant={s === "contacted" && e.status === "new" ? "primary" : "secondary"} size="md">
              {s === "new" ? "Mark as new" : s === "contacted" ? "Mark as contacted" : "Close enquiry"}
            </ActionButton>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardTitle hint={e.courseTitle ? `About ${e.courseTitle}` : "General enquiry"}>Message</CardTitle>
            {e.message ? <p className="whitespace-pre-line text-[15px] leading-relaxed">{e.message}</p> : <p className="text-muted">They didn&apos;t write a message.</p>}
          </Card>

          <Card>
            <CardTitle>History</CardTitle>
            <ol className="space-y-4">
              <li className="flex gap-3 text-[14px]">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden />
                <div>
                  <div>Enquiry received from the website.</div>
                  <div className="text-[12px] text-muted">{formatMoment(e.createdAt, tz)}</div>
                </div>
              </li>
              {e.notes.map((n) => (
                <li key={n.id} className="flex gap-3 text-[14px]">
                  <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.kind === "note" ? "bg-brand" : "bg-faint")} aria-hidden />
                  <div className="min-w-0">
                    <div className={cx(n.kind === "note" ? "whitespace-pre-line" : "text-muted")}>{n.body}</div>
                    <div className="text-[12px] text-muted">
                      {n.authorName}, {formatMoment(n.createdAt, tz)}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <ActionForm action={enquiryNoteAction} className="mt-6 space-y-3 border-t border-line pt-5">
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="id" value={e.id} />
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium">Add a note</span>
                <Textarea name="body" rows={3} required minLength={2} maxLength={2000} placeholder="Called on Tuesday; wants the weekend batch. Sending the fee details." />
              </label>
              <SubmitButton size="sm" pendingText="Adding…">
                Add note
              </SubmitButton>
            </ActionForm>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle>Contact</CardTitle>
            <dl className="space-y-3 text-[14px]">
              <div>
                <dt className="text-[12px] text-muted">Email</dt>
                <dd>
                  <a href={`mailto:${e.email}?subject=${mailSubject}`} className="text-brand underline underline-offset-2">
                    {e.email}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Phone</dt>
                <dd>
                  {e.phone ? (
                    <a href={`tel:${e.phone.replace(/[^\d+]/g, "")}`} className="text-brand underline underline-offset-2">
                      {e.phone}
                    </a>
                  ) : (
                    <span className="text-muted">Not given</span>
                  )}
                </dd>
              </div>
            </dl>
          </Card>
          <Card>
            <CardTitle>Assigned to</CardTitle>
            <ActionForm action={assignEnquiryAction} resetOnSuccess={false} className="space-y-3">
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="id" value={e.id} />
              <Select name="assigneeUserId" defaultValue={e.assigneeUserId ?? ""} aria-label="Assigned to">
                <option value="">Nobody</option>
                {e.assignees.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.id === actor.userId ? " (you)" : ""}
                  </option>
                ))}
              </Select>
              <SubmitButton variant="secondary" size="sm" pendingText="Saving…">
                Save
              </SubmitButton>
            </ActionForm>
            <p className="mt-3 text-[12px] text-muted">They get a notification. Only people who manage the website can be picked.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
