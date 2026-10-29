import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { flagCourseAction, markReviewedAction, resolveFlagAction } from "@/modules/zinny-team-panel/actions";
import { BackLink, Fact, NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { canSeeContentFlags } from "@/modules/zinny-team-panel/lib/access";
import { FLAG_CATEGORIES, FLAG_LABEL } from "@/modules/zinny-team-panel/lib/constants";
import { formatDate, formatDateTime, formatINR } from "@/modules/zinny-team-panel/lib/format";
import { coursePreview } from "@/modules/zinny-team-panel/services/content";

export const metadata = { title: "Course preview" };

const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hm = (t: string) => t.slice(0, 5);

export default async function CoursePreviewPage({ params }: { params: Promise<{ courseId: string }> }) {
  const actor = await platformContext();
  if (!canSeeContentFlags(actor)) return <NoAccess section="content review" who="Super Admins, Content QA and Account Managers" />;
  const { courseId } = await params;
  const p = await coursePreview(actor, courseId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const canReview = canPlatform(actor, "platform.content_review");
  const open = p.flags.filter((f) => f.status === "open");
  const c = p.course;

  return (
    <>
      <BackLink href="/platform/content">Content review</BackLink>
      <PageHeader
        title={c.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={c.status === "published" ? "brand" : "neutral"}>{c.status === "published" ? "Published" : c.status === "draft" ? "Draft" : "Archived"}</Badge>
            {open.length > 0 ? <Badge tone="gold">{open.length} open flag{open.length === 1 ? "" : "s"}</Badge> : p.review ? <Badge tone="brand">Reviewed</Badge> : <Badge>Not reviewed</Badge>}
            <span>
              {p.universityName} · {p.departmentName}
            </span>
          </span>
        }
      />
      <p className="-mt-4 mb-6 text-[13px] text-muted">Read-only preview. The Zinny team never edits a university&apos;s content.</p>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardTitle>About the course</CardTitle>
            <p className="whitespace-pre-line text-[14px]">{c.description || <span className="text-faint">No description.</span>}</p>
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
              <Fact label="Price">{c.pricePaise ? formatINR(c.pricePaise) : "Free"}</Fact>
              <Fact label="GST">{c.gstRateBp / 100}%</Fact>
              <Fact label="Certificate">{c.certificateEnabled ? "Yes" : "No"}</Fact>
              <Fact label="Program">{p.programName}</Fact>
              <Fact label="Created">{formatDateTime(c.createdAt)}</Fact>
              <Fact label="Created by">{p.createdByName}</Fact>
            </dl>
          </Card>

          <Card>
            <CardTitle hint={`${p.batches.length} batch${p.batches.length === 1 ? "" : "es"}`}>Batches</CardTitle>
            {p.batches.length === 0 ? (
              <p className="text-[14px] text-muted">No batches yet.</p>
            ) : (
              <ul className="divide-y divide-line text-[14px]">
                {p.batches.map((b) => (
                  <li key={b.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{b.name}</span>
                      <span className="tabular text-muted">
                        {b.taken} of {b.seatLimit} seats
                      </span>
                    </div>
                    <div className="text-[13px] text-muted">
                      {formatDate(b.startDate)} to {formatDate(b.endDate)} ·{" "}
                      {b.slots.map((s) => `${DAY[s.weekday]} ${hm(s.startTime)}–${hm(s.endTime)}`).join(", ") || "No timings"}
                      {b.faculty.length ? ` · ${b.faculty.join(", ")}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardTitle>Flags</CardTitle>
            {p.flags.length === 0 ? (
              <p className="text-[14px] text-muted">No flags on this course.</p>
            ) : (
              <ul className="space-y-3">
                {p.flags.map((f) => (
                  <li key={f.id} className={f.status === "open" ? "rounded-2xl bg-gold-soft p-4 text-[14px]" : "rounded-2xl bg-canvas p-4 text-[14px]"}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{FLAG_LABEL[f.category] ?? f.category}</span>
                      <span className="text-[12.5px] text-muted">
                        {f.authorName ?? "Zinny team"} · {formatDateTime(f.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-line">{f.note}</p>
                    {f.status === "resolved" ? (
                      <p className="mt-2 text-[13px] text-brand-strong">
                        Resolved by {f.resolverName ?? "Zinny team"}: {f.resolutionNote}
                      </p>
                    ) : (
                      canReview && (
                        <ActionForm action={resolveFlagAction} className="mt-3 flex flex-wrap gap-2">
                          <input type="hidden" name="flagId" value={f.id} />
                          <Input name="resolution" placeholder="How it was fixed" required minLength={5} maxLength={1000} className="min-w-[180px] flex-1" />
                          <SubmitButton size="sm" variant="secondary">
                            Resolve flag
                          </SubmitButton>
                        </ActionForm>
                      )
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {canReview && (
            <Card>
              <CardTitle>Flag an issue</CardTitle>
              <ActionForm action={flagCourseAction} className="space-y-3">
                <input type="hidden" name="courseId" value={c.id} />
                <Field label="Kind of issue">
                  <Select name="category" required defaultValue="">
                    <option value="" disabled>
                      Pick one
                    </option>
                    {FLAG_CATEGORIES.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Note for the Account Manager" hint="What is wrong and where, so they can explain it to the university.">
                  <Textarea name="note" required minLength={10} maxLength={2000} />
                </Field>
                <SubmitButton variant="secondary">Add flag</SubmitButton>
              </ActionForm>
            </Card>
          )}

          {canReview && open.length === 0 && (
            <Card>
              <CardTitle>{p.review ? "Reviewed" : "No issues?"}</CardTitle>
              {p.review && (
                <p className="mb-3 text-[14px] text-muted">
                  Reviewed by {p.review.reviewerName ?? "Zinny team"} on {formatDateTime(p.review.reviewedAt)}
                  {p.review.note ? `: ${p.review.note}` : "."}
                </p>
              )}
              <ActionForm action={markReviewedAction} className="space-y-3">
                <input type="hidden" name="courseId" value={c.id} />
                <Field label="Note" hint="Optional">
                  <Input name="note" maxLength={1000} />
                </Field>
                <SubmitButton>{p.review ? "Mark reviewed again" : "Mark reviewed, no issues"}</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
