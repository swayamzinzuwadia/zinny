import Link from "next/link";
import { Card, CardTitle, PageHeader, Select, Stat, Table, Td, buttonClass } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { BarChart } from "@/modules/zinny-team-panel/components/bar-chart";
import { NoAccess, StatusBadge } from "@/modules/zinny-team-panel/components/bits";
import { formatCount, formatDate, formatINR, formatINRShort, formatMonth } from "@/modules/zinny-team-panel/lib/format";
import { analytics } from "@/modules/zinny-team-panel/services/analytics";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ university?: string }> }) {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.view_analytics")) return <NoAccess section="Analytics" who="Super Admins, Account Managers and Support Agents" />;
  const { university } = await searchParams;
  const a = await analytics(actor, { universityId: university });
  const scopeName = a.universityId ? (a.perUniversity.find((u) => u.id === a.universityId)?.name ?? "This university") : "All universities";
  const lastWeek = a.weeks.length - 1;
  const lastMonth = a.months.length - 1;

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Across every university, in India time. Weeks start on Monday. Money collected counts payments universities received from students, before refunds."
        actions={
          <form className="flex gap-2">
            <Select name="university" defaultValue={a.universityId ?? ""} aria-label="University" className="w-60">
              <option value="">All universities</option>
              {a.perUniversity.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
            <button className={buttonClass("secondary")}>Show</button>
          </form>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Universities" value={formatCount(a.universities.active)} hint={a.universities.suspended ? `${a.universities.suspended} suspended` : `${formatCount(a.universities.total)} in total`} />
        <Stat label="Active students" value={formatCount(a.activeStudents)} hint={`${formatCount(a.students)} with a student role`} />
        <Stat label="Enrolments this week" value={formatCount(a.weeks[lastWeek]?.enrolments ?? 0)} hint={`${formatCount(a.weeks.reduce((s, w) => s + w.enrolments, 0))} in 12 weeks`} />
        <Stat label="Collected this month" value={formatINRShort(a.months[lastMonth]?.paise ?? 0)} hint={`${formatINRShort(a.months.reduce((s, m) => s + m.paise, 0))} in 12 months`} />
      </div>
      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle hint={scopeName}>Enrolments per week</CardTitle>
          <BarChart
            title={`Enrolments per week, ${scopeName}`}
            emptyText="No enrolments in the last 12 weeks"
            bars={a.weeks.map((w, i) => ({ key: w.week, label: formatDate(w.week, { year: false }), value: w.enrolments, display: formatCount(w.enrolments), current: i === lastWeek }))}
          />
        </Card>
        <Card>
          <CardTitle hint={scopeName}>Money collected per month</CardTitle>
          <BarChart
            title={`Money collected per month, ${scopeName}`}
            emptyText="No payments in the last 12 months"
            bars={a.months.map((m, i) => ({ key: m.month, label: formatMonth(m.month, { year: false }), value: m.paise, display: formatINRShort(m.paise), current: i === lastMonth }))}
          />
        </Card>
      </div>
      <h2 className="mb-3 text-[17px] font-medium">By university</h2>
      <Table head={["University", "Status", "Students", "Active students", "Enrolments, 12 weeks", "Collected this month", "Collected, 12 months"]}>
        {a.perUniversity.map((u) => (
          <tr key={u.id} className={u.id === a.universityId ? "bg-gold-soft/40" : "hover:bg-canvas/60"}>
            <Td>
              <Link href={`/platform/analytics?university=${u.id}`} className="font-medium text-ink hover:text-brand">
                {u.name}
              </Link>
            </Td>
            <Td>
              <StatusBadge status={u.status} />
            </Td>
            <Td className="tabular">{formatCount(u.students)}</Td>
            <Td className="tabular">{formatCount(u.activeStudents)}</Td>
            <Td className="tabular">{formatCount(u.enrolments12w)}</Td>
            <Td className="tabular">{formatINR(u.collectedMonth)}</Td>
            <Td className="tabular">{formatINR(u.collected12m)}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
