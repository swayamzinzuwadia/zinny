import { ButtonLink, PageHeader, Stat } from "@/components/ui";
import type { Insights } from "../insights";
import { formatDay, formatDayShort, formatMonth, formatWeek } from "../lib/dates";
import { formatHours, formatMoney, formatNumber, formatPercent } from "../lib/format";
import {
  batchFillTakeaway,
  completionTakeaway,
  enrolmentsTakeaway,
  facultyTakeaway,
  revenueCourseTakeaway,
  revenueMonthTakeaway,
} from "../lib/takeaways";
import { ChartCard, ChartEmpty } from "./chart-card";
import { BarList, ColumnChart, type Datum } from "./charts";

/** Long lists draw their top entries; the table under the chart lists everyone. */
const CHART_LIMIT = 12;

const limitHint = (base: string, total: number) => (total > CHART_LIMIT ? `${base} · top ${CHART_LIMIT} of ${total}` : base);

export function InsightsView({ data, reportsHref }: { data: Insights; reportsHref: string | null }) {
  const { stats, revenue } = data;

  const weeks: Datum[] = data.enrolmentsByWeek.map((w) => ({
    label: w.label,
    value: w.count,
    highlight: w.current,
    note: w.current ? "This week" : `Week of ${formatWeek(w.start)}`,
  }));

  const completion: Datum[] = data.completion.slice(0, CHART_LIMIT).map((c) => ({
    label: c.title,
    value: c.rate,
    note: `${formatNumber(c.completed)} of ${formatNumber(c.enrolled)} completed`,
  }));

  const fill: Datum[] = data.batchFill.slice(0, CHART_LIMIT).map((b) => ({
    label: `${b.course} · ${b.batch}`,
    value: b.fill,
    note: `${b.taken} of ${b.limit} seats taken${b.held ? `, ${b.held} being paid for` : ""}${b.startsOn ? `. Starts ${formatDay(b.startsOn)}` : ""}`,
  }));

  const load = data.facultyLoad.slice(0, CHART_LIMIT);
  const faculty: Datum[] = load.map((f) => ({
    label: f.name,
    value: f.thisWeek,
    note: `${f.batches === 1 ? "1 batch" : `${f.batches} batches`} this week · next week ${formatHours(f.nextWeek)}`,
  }));

  return (
    <>
      <PageHeader
        title="Insights"
        subtitle={`Enrolment, completion, ${revenue ? "revenue " : ""}and faculty load for ${data.scopeLabel}.`}
        actions={reportsHref ? <ButtonLink href={reportsHref} variant="secondary">Open reports</ButtonLink> : undefined}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Active learners" value={formatNumber(stats.activeLearners)} hint="Enrolled and learning now" />
        <Stat label="Enrolments this week" value={formatNumber(stats.enrolmentsThisWeek)} hint={`Week of ${formatDayShort(data.weekOf)}`} />
        <Stat
          label="Completion rate"
          value={stats.completionRate === null ? "—" : formatPercent(stats.completionRate)}
          hint="Completed out of everyone enrolled"
        />
        {stats.revenueThisMonthPaise !== null ? (
          <Stat label="Revenue this month" value={formatMoney(stats.revenueThisMonthPaise)} hint="Before GST, refunds left out" />
        ) : (
          <Stat label="Open batches" value={formatNumber(stats.openBatches)} hint="Taking enrolments now" />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          className="lg:col-span-2"
          title="Enrolments per week"
          hint="Last 12 weeks · gold is this week"
          chart={<ColumnChart data={weeks} format="count" />}
          takeaway={enrolmentsTakeaway(data.enrolmentsByWeek)}
          table={{
            caption: "Enrolments per week, last 12 weeks",
            head: ["Week", "Enrolments"],
            rows: data.enrolmentsByWeek.map((w) => [`${formatWeek(w.start)}${w.current ? " (this week)" : ""}`, formatNumber(w.count)]),
            numeric: [1],
            current: data.enrolmentsByWeek.flatMap((w, i) => (w.current ? [i] : [])),
          }}
        />

        <ChartCard
          title="Completion rate by course"
          hint={limitHint("Completed out of enrolled", data.completion.length)}
          chart={completion.length ? <BarList data={completion} format="percent" max={100} /> : <ChartEmpty>No enrolments yet.</ChartEmpty>}
          takeaway={completionTakeaway(data.completion)}
          table={{
            caption: "Completion rate by course",
            head: ["Course", "Department", "Enrolled", "Completed", "Learning now", "Completion rate"],
            rows: data.completion.map((c) => [
              c.title,
              c.department,
              formatNumber(c.enrolled),
              formatNumber(c.completed),
              formatNumber(c.learning),
              formatPercent(c.rate),
            ]),
            numeric: [2, 3, 4, 5],
          }}
        />

        <ChartCard
          title="Batch fill"
          hint={limitHint("Seats taken out of the limit", data.batchFill.length)}
          chart={fill.length ? <BarList data={fill} format="percent" max={100} labelWidth={200} /> : <ChartEmpty>No batches running or open.</ChartEmpty>}
          takeaway={batchFillTakeaway(data.batchFill)}
          table={{
            caption: "Batch fill: seats taken against the seat limit",
            head: ["Batch", "Seats taken", "Being paid for", "Seat limit", "Fill"],
            rows: data.batchFill.map((b) => [
              `${b.course} · ${b.batch}${b.startsOn ? ` (starts ${formatDay(b.startsOn)})` : ""}`,
              formatNumber(b.taken),
              formatNumber(b.held),
              formatNumber(b.limit),
              formatPercent(b.fill),
            ]),
            numeric: [1, 2, 3, 4],
          }}
        />

        {revenue && (
          <>
            <ChartCard
              title="Revenue per month"
              hint="Last 12 months, before GST · gold is this month"
              chart={
                <ColumnChart
                  format="money"
                  data={revenue.byMonth.map((m) => ({
                    label: m.label,
                    value: m.paise,
                    highlight: m.current,
                    note: m.current ? "This month so far" : formatMonth(m.start, true),
                  }))}
                />
              }
              takeaway={revenueMonthTakeaway(revenue.byMonth)}
              table={{
                caption: "Revenue per month before GST, last 12 months",
                head: ["Month", "Revenue before GST"],
                rows: revenue.byMonth.map((m) => [`${formatMonth(m.start, true)}${m.current ? " (so far)" : ""}`, formatMoney(m.paise)]),
                numeric: [1],
                current: revenue.byMonth.flatMap((m, i) => (m.current ? [i] : [])),
              }}
            />
            <ChartCard
              title="Revenue by course"
              hint={limitHint("Last 12 months, before GST", revenue.byCourse.length)}
              chart={
                revenue.byCourse.length ? (
                  <BarList format="money" data={revenue.byCourse.slice(0, CHART_LIMIT).map((c) => ({ label: c.title, value: c.paise }))} />
                ) : (
                  <ChartEmpty>No revenue in the last 12 months.</ChartEmpty>
                )
              }
              takeaway={revenueCourseTakeaway(revenue.byCourse)}
              table={{
                caption: "Revenue by course before GST, last 12 months",
                head: ["Course", "Revenue before GST", "Share"],
                rows: (() => {
                  const total = revenue.byCourse.reduce((n, c) => n + c.paise, 0);
                  return revenue.byCourse.map((c) => [c.title, formatMoney(c.paise), total ? formatPercent((c.paise / total) * 100) : "—"]);
                })(),
                numeric: [1, 2],
              }}
            />
          </>
        )}

        <ChartCard
          className="lg:col-span-2"
          title="Faculty load"
          hint={limitHint(`Scheduled teaching hours, week of ${formatDayShort(data.weekOf)}`, data.facultyLoad.length)}
          chart={
            faculty.length ? <BarList data={faculty} format="hours" labelWidth={170} /> : <ChartEmpty>No faculty assigned to running batches.</ChartEmpty>
          }
          takeaway={facultyTakeaway(data.facultyLoad)}
          table={{
            caption: "Scheduled teaching hours per faculty member: last week, this week and next week",
            head: ["Faculty member", "Batches this week", "Last week", "This week", "Next week"],
            rows: data.facultyLoad.map((f) => [
              f.name,
              formatNumber(f.batches),
              formatHours(f.lastWeek),
              formatHours(f.thisWeek),
              formatHours(f.nextWeek),
            ]),
            numeric: [1, 2, 3, 4],
          }}
        />
      </div>
    </>
  );
}
