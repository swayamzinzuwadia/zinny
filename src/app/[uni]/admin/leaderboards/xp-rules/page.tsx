import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, Notice, PageHeader, Select, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { applyRuleAction, createRuleAction, setRuleActiveAction, updateRuleAction } from "@/modules/gamification/actions";
import { TRIGGERS } from "@/modules/gamification/catalog";
import { NoAccess, SectionNav, unlessForbidden } from "@/modules/gamification/components/staff";
import { TriggerFields } from "@/modules/gamification/components/trigger-fields";
import { listRules } from "@/modules/gamification/rules";
import { plural } from "@/modules/gamification/util";

export const metadata = { title: "XP rules" };

export default async function XpRulesPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const data = await unlessForbidden(listRules(actor));
  if (!data) return <NoAccess title="XP rules" />;
  const { rules, scopes } = data;
  const canCreate = scopes.universityWide || scopes.departments.length > 0;
  const on = rules.filter((r) => r.active);
  const off = rules.filter((r) => !r.active);

  return (
    <>
      <SectionNav uni={uni} active="/xp-rules" />
      <PageHeader
        title="XP rules"
        subtitle="What earns points. Each lesson, test, class or assignment earns XP once per rule, and a daily cap limits how much one student can earn from a rule in a day."
      />
      <div className={cx("grid gap-6", canCreate && "xl:grid-cols-[1fr_360px]")}>
        <div className="min-w-0 space-y-4">
          {rules.length === 0 && (
            <Empty title="No XP rules yet">{canCreate ? "Add the first rule on the right, like 10 XP for finishing a lesson." : "Rules your institute sets up will show here."}</Empty>
          )}
          {[...on, ...off].map((r) => (
            <Card key={r.id} className={cx("p-5", !r.active && "bg-canvas/60")}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className={cx("text-[16px] font-medium", !r.active && "text-muted")}>{r.name}</h2>
                    <Badge tone={r.departmentId ? "neutral" : "brand"}>{r.scopeName}</Badge>
                    {!r.active && <Badge tone="warn">Off</Badge>}
                  </div>
                  <p className="mt-1 text-[14px] text-muted">
                    {r.description}
                    {r.dailyCap ? `. Up to ${r.dailyCap} a day per student (${(r.dailyCap * r.points).toLocaleString("en-IN")} XP)` : ". No daily cap"}.
                  </p>
                  <p className="mt-2 text-[13px] text-faint">
                    {r.awards === 0
                      ? "Not given yet."
                      : `Given ${plural(r.awards, "time", "times")} to ${plural(r.students, "student", "students")}, ${r.pointsAwarded.toLocaleString("en-IN")} XP in all.`}
                  </p>
                </div>
                <div className="tabular shrink-0 text-right">
                  <div className={cx("text-[26px] font-semibold leading-none", r.active ? "text-brand" : "text-faint")}>+{r.points}</div>
                  <div className="text-[12px] text-muted">XP</div>
                </div>
              </div>

              {r.canManage && (
                <div className="mt-4 flex flex-wrap items-start gap-2 border-t border-line pt-4">
                  <details className="group w-full sm:w-auto sm:flex-1">
                    <summary className="inline-flex h-8 cursor-pointer list-none items-center rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium hover:border-brand/40">
                      Edit rule
                    </summary>
                    <ActionForm action={updateRuleAction} resetOnSuccess={false} className="mt-3 grid gap-3 sm:grid-cols-2">
                      <input type="hidden" name="uni" value={uni} />
                      <input type="hidden" name="ruleId" value={r.id} />
                      <Field label="Name">
                        <Input name="name" defaultValue={r.name} required />
                      </Field>
                      <Field label="XP">
                        <Input name="points" type="number" min={1} max={1000} defaultValue={r.points} required />
                      </Field>
                      <Field label="Daily cap" hint="Empty for no cap">
                        <Input name="dailyCap" type="number" min={1} max={100} defaultValue={r.dailyCap ?? ""} />
                      </Field>
                      {r.condition === "min_score" && (
                        <Field label="Minimum score (%)">
                          <Input name="minScore" type="number" min={1} max={100} defaultValue={r.minScore ?? 80} required />
                        </Field>
                      )}
                      <div className="sm:col-span-2">
                        <SubmitButton size="sm">Save rule</SubmitButton>
                      </div>
                    </ActionForm>
                  </details>
                  {r.active && (
                    <ActionForm
                      action={applyRuleAction}
                      resetOnSuccess={false}
                      confirm={`Give XP for ${r.name.toLowerCase()} to everything that already happened? Students never get it twice.`}
                    >
                      <input type="hidden" name="uni" value={uni} />
                      <input type="hidden" name="ruleId" value={r.id} />
                      <SubmitButton size="sm" variant="secondary" pendingText="Applying…">
                        Apply to past activity
                      </SubmitButton>
                    </ActionForm>
                  )}
                  <ActionForm action={setRuleActiveAction} resetOnSuccess={false}>
                    <input type="hidden" name="uni" value={uni} />
                    <input type="hidden" name="ruleId" value={r.id} />
                    <input type="hidden" name="active" value={r.active ? "false" : "true"} />
                    <SubmitButton size="sm" variant={r.active ? "danger" : "secondary"}>
                      {r.active ? "Turn off" : "Turn on"}
                    </SubmitButton>
                  </ActionForm>
                </div>
              )}
            </Card>
          ))}
        </div>

        {canCreate && (
          <div className="space-y-4">
            <Card className="h-fit">
              <CardTitle>New rule</CardTitle>
              <ActionForm action={createRuleAction} className="space-y-4">
                <input type="hidden" name="uni" value={uni} />
                <Field label="Name" hint="Students see this next to the XP they earn.">
                  <Input name="name" placeholder="Lesson finished" required maxLength={80} />
                </Field>
                <TriggerFields triggers={TRIGGERS.map((t) => ({ key: t.key, label: t.label, needsScore: t.needsScore }))} defaultKey="lesson" />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="XP">
                    <Input name="points" type="number" inputMode="numeric" min={1} max={1000} defaultValue={10} required />
                  </Field>
                  <Field label="Daily cap" hint="Most a day, per student">
                    <Input name="dailyCap" type="number" inputMode="numeric" min={1} max={100} placeholder="No cap" />
                  </Field>
                </div>
                <Field label="Applies to">
                  <Select name="departmentId" defaultValue={scopes.universityWide ? "" : scopes.departments[0]?.id}>
                    {scopes.universityWide && <option value="">Whole university</option>}
                    {scopes.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} only
                      </option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton>Add rule</SubmitButton>
              </ActionForm>
            </Card>
            <Notice tone="neutral">
              A department rule only counts activity in that department&apos;s courses. New rules count activity from now on. Use Apply to past
              activity to include what already happened.
            </Notice>
          </div>
        )}
      </div>
    </>
  );
}
