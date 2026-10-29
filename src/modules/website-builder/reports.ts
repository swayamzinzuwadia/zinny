/** Reports this module adds to the Reports page (contracts.md section 4). */
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { courses } from "@/db/schema";
import type { ReportDefinition } from "@/contracts/module";
import { peopleLite, universityLite, withTenant } from "@/server/core";
import { assertManage } from "./access";
import { dateIn } from "./format";
import { siteEnquiries } from "./schema";

const STATUS: Record<string, string> = { new: "New", contacted: "Contacted", closed: "Closed" };

/** Next day, "YYYY-MM-DD". */
const dayAfter = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export const enquiriesReport: ReportDefinition = {
  id: "website-builder.enquiries",
  label: "Website enquiries",
  description: "Every enquiry from the website form, with the course asked about, its status and who has it.",
  action: "website.manage",
  filters: ["dateRange"],
  async run(actor, params) {
    assertManage(actor);
    return withTenant(actor, async (tx) => {
      const { timezone } = await universityLite(tx);
      // Date bounds are days in the university's time zone; compare on the stored instant.
      const tzStart = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() - offsetMs(timezone, d));
      const rows = await tx
        .select({ e: siteEnquiries, courseTitle: courses.title })
        .from(siteEnquiries)
        .leftJoin(courses, eq(courses.id, siteEnquiries.courseId))
        .where(
          and(
            params.from ? gte(siteEnquiries.createdAt, tzStart(params.from)) : undefined,
            params.to ? lt(siteEnquiries.createdAt, tzStart(dayAfter(params.to))) : undefined,
          ),
        )
        .orderBy(desc(siteEnquiries.createdAt));
      const people = await peopleLite(tx, rows.flatMap((r) => (r.e.assigneeUserId ? [r.e.assigneeUserId] : [])));
      const nameOf = new Map(people.map((p) => [p.id, p.name]));
      return {
        columns: [
          { key: "received", label: "Received", type: "date" },
          { key: "name", label: "Name", type: "text" },
          { key: "email", label: "Email", type: "text" },
          { key: "phone", label: "Phone", type: "text" },
          { key: "course", label: "Course", type: "text" },
          { key: "status", label: "Status", type: "text" },
          { key: "assignee", label: "Assigned to", type: "text" },
        ],
        rows: rows.map(({ e, courseTitle }) => ({
          received: dateIn(e.createdAt, timezone),
          name: e.name,
          email: e.email,
          phone: e.phone ?? "",
          course: courseTitle ?? "",
          status: STATUS[e.status] ?? e.status,
          assignee: e.assigneeUserId ? (nameOf.get(e.assigneeUserId) ?? "") : "",
        })),
      };
    });
  },
};

/** The time zone's offset from UTC at midnight of a date, in ms (e.g. +5:30 for Asia/Kolkata). */
function offsetMs(timezone: string, date: string): number {
  const at = new Date(`${date}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - at.getTime();
}
