import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, gte, lt } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, invoices } from "@/db/schema";
import type { ReportDefinition, ReportParams, ZinnyModule } from "@/contracts/module";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { setTestModules } from "@/server/registry";
import { ENROLMENTS_REPORT, runEnrolments, runTransactions, TRANSACTIONS_REPORT } from "@/modules/reports-board/reports";
import {
  canOpenReports,
  exportReport,
  filterOptions,
  ReportFailed,
  reportErrorMessage,
  runnableReports,
  runReport,
} from "@/modules/reports-board/service";
import { parseQuery } from "@/modules/reports-board/lib/query";
import { setupReports, type ReportsWorld } from "./setup";

afterAll(closeDb);
afterEach(() => setTestModules([]));

let w: ReportsWorld;
beforeAll(async () => {
  w = await setupReports();
});

const SEP_OCT = { from: "2026-09-01", to: "2026-10-31" };
const q = (report: string, extra: Record<string, string> = {}) =>
  parseQuery({ report, range: "custom", from: SEP_OCT.from, to: SEP_OCT.to, ...extra });

describe("who can open the Reports page", () => {
  it("lets in admins, Board / Owner, Accounts & Fees and Heads of Department", () => {
    for (const a of [w.admin, w.board, w.accounts, w.hod, w.mehul]) expect(canOpenReports(a)).toBe(true);
  });

  it("keeps faculty and students out, even though faculty hold some report actions", async () => {
    for (const a of [w.faculty, w.studentOnly]) {
      expect(canOpenReports(a)).toBe(false);
      expect(() => runnableReports(a)).toThrow(ForbiddenError);
      await expect(runReport(a, q(ENROLMENTS_REPORT), "2026-10-29")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(exportReport(a, q(ENROLMENTS_REPORT), "csv")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(filterOptions(a, "enrolment.view")).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("lists only the reports each person may run", () => {
    const ids = (a: typeof w.admin) => runnableReports(a).map((r) => r.id);
    expect(ids(w.admin)).toEqual(expect.arrayContaining([ENROLMENTS_REPORT, TRANSACTIONS_REPORT]));
    expect(ids(w.board)).toEqual(expect.arrayContaining([ENROLMENTS_REPORT, TRANSACTIONS_REPORT]));
    expect(ids(w.accounts)).toEqual([TRANSACTIONS_REPORT]);
    expect(ids(w.hod)).toContain(ENROLMENTS_REPORT);
    expect(ids(w.hod)).not.toContain(TRANSACTIONS_REPORT);
  });
});

describe("enrolments report", () => {
  it("shows the whole university to an admin and to Board / Owner, newest first", async () => {
    for (const a of [w.admin, w.board]) {
      const { rows, columns } = await runEnrolments(a, SEP_OCT);
      expect(columns.map((c) => c.key)).toEqual(["enrolledOn", "student", "email", "department", "course", "batch", "status"]);
      expect(rows.map((r) => `${r.student} / ${r.course}`)).toEqual([
        "Meera Nair / Digital Marketing",
        '=HYPERLINK("http://evil.example","Click") / Data Analytics',
        "Aditi Rao / Data Analytics",
        "Riya Sharma / Digital Marketing",
        "Kabir Mehta / Data Analytics",
        "Riya Sharma / Data Analytics",
      ]);
      expect(rows[0]).toMatchObject({ enrolledOn: "2026-10-25", department: "Marketing", batch: "Evening", status: "Active" });
    }
  });

  it("leaves out seat holds that were never paid", async () => {
    const { rows } = await runEnrolments(w.admin, SEP_OCT);
    expect(rows.find((r) => r.student === "Ishaan Gupta")).toBeUndefined();
  });

  it("uses the university's time zone for the date range", async () => {
    // Kabir paid at 18:45 UTC on 1 Oct, which is 00:15 on 2 Oct in India.
    const day2 = await runEnrolments(w.admin, { from: "2026-10-02", to: "2026-10-02" });
    expect(day2.rows.map((r) => r.student)).toEqual(["Kabir Mehta"]);
    expect(day2.rows[0].enrolledOn).toBe("2026-10-02");
    expect((await runEnrolments(w.admin, { from: "2026-10-01", to: "2026-10-01" })).rows).toEqual([]);
  });

  it("filters by department, course and batch", async () => {
    const byDept = await runEnrolments(w.admin, { ...SEP_OCT, departmentId: w.mkt.id });
    expect(byDept.rows.map((r) => r.student).sort()).toEqual(["Meera Nair", "Riya Sharma"]);
    const byCourse = await runEnrolments(w.admin, { ...SEP_OCT, courseId: w.course.id });
    expect(byCourse.rows).toHaveLength(4);
    const byBatch = await runEnrolments(w.admin, { ...SEP_OCT, batchId: w.dmEvening.id });
    expect(byBatch.rows).toHaveLength(2);
  });

  it("shows a HOD only their own department", async () => {
    const { rows } = await runEnrolments(w.hod, SEP_OCT);
    expect(rows.length).toBe(4);
    expect(new Set(rows.map((r) => r.department))).toEqual(new Set(["Computer Science"]));
    const mehul = await runEnrolments(w.mehul, SEP_OCT);
    expect(new Set(mehul.rows.map((r) => r.department))).toEqual(new Set(["Marketing"]));
  });

  it("shows a HOD only their own department even when they pass another department's ids", async () => {
    const tries: ReportParams[] = [
      { ...SEP_OCT, departmentId: w.mkt.id },
      { ...SEP_OCT, courseId: w.dm.id },
      { ...SEP_OCT, batchId: w.dmEvening.id },
    ];
    for (const params of tries) {
      // The report itself never returns another department's rows…
      expect((await runEnrolments(w.hod, params)).rows).toEqual([]);
    }
    // …and the Reports page refuses the filter with a message.
    const others: Record<string, string>[] = [{ dept: w.mkt.id }, { course: w.dm.id }, { batch: w.dmEvening.id }];
    for (const extra of others) {
      const err = await runReport(w.hod, q(ENROLMENTS_REPORT, extra), "2026-10-29").catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err.message).toBe("That filter is outside what you can see. Pick one from the list.");
    }
    // Their own department still works through the page.
    const own = await runReport(w.hod, q(ENROLMENTS_REPORT, { dept: w.cs.id }), "2026-10-29");
    expect(own.rows).toHaveLength(4);
  });

  it("is refused to Accounts & Fees", async () => {
    await expect(runEnrolments(w.accounts, SEP_OCT)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runReport(w.accounts, q(ENROLMENTS_REPORT), "2026-10-29")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("limits faculty to their own batches when the report is called directly", async () => {
    // Faculty hold enrolment.view for their own batch only; the page is closed to them anyway.
    const { rows } = await runEnrolments(w.faculty, SEP_OCT);
    expect(new Set(rows.map((r) => r.batch))).toEqual(new Set(["Weekday morning"]));
    expect(new Set(rows.map((r) => r.course))).toEqual(new Set(["Data Analytics"]));
  });
});

describe("transactions report", () => {
  it("runs for Accounts & Fees, Board / Owner and admins", async () => {
    for (const a of [w.accounts, w.board, w.admin]) {
      const run = await runReport(a, q(TRANSACTIONS_REPORT), "2026-10-29");
      expect(run.rows).toHaveLength(5);
    }
  });

  it("is refused to a Head of Department", async () => {
    await expect(runTransactions(w.hod, SEP_OCT)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(runReport(w.hod, q(TRANSACTIONS_REPORT), "2026-10-29")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("shows invoice, GST split, status and refunds", async () => {
    const { rows, columns } = await runTransactions(w.accounts, SEP_OCT);
    expect(columns.map((c) => c.key)).toEqual([
      "date", "invoice", "student", "email", "department", "course", "batch", "status",
      "taxableValue", "cgst", "sgst", "igst", "total", "refund", "paymentReference",
    ]);
    const kabir = rows.find((r) => r.student === "Kabir Mehta")!;
    expect(kabir).toMatchObject({
      date: "2026-10-02",
      status: "Paid",
      taxableValue: 10_000_00,
      cgst: 900_00,
      sgst: 900_00,
      igst: 0,
      total: 11_800_00,
      refund: null,
      department: "Computer Science",
    });
    expect(String(kabir.invoice)).toMatch(/^TU\/\d\d-\d\d\/\d{5}$/);
    expect(rows.find((r) => r.student === "Aditi Rao")).toMatchObject({ status: "Refunded", total: 11_800_00, refund: 11_800_00 });
    // Awaiting payment: no invoice, so no money columns.
    expect(rows.find((r) => r.student === "Ishaan Gupta")).toMatchObject({
      status: "Awaiting payment",
      invoice: null,
      taxableValue: null,
      total: null,
      date: "2026-10-10",
    });
    for (const r of rows.filter((r) => r.total !== null)) {
      expect(Number(r.taxableValue) + Number(r.cgst) + Number(r.sgst) + Number(r.igst)).toBe(r.total);
    }
  });

  it("has totals equal to the sum of invoices issued in the range", async () => {
    const ranges = [SEP_OCT, { from: "2026-10-01", to: "2026-10-31" }, { from: "2026-10-02", to: "2026-10-20" }, { from: "2026-11-01", to: "2026-11-30" }];
    for (const range of ranges) {
      const { rows } = await runTransactions(w.accounts, range);
      const sum = (k: string) => rows.reduce((n, r) => n + (r[k] === null ? 0 : Number(r[k])), 0);
      const issued = await systemDb()
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.universityId, w.uni.id),
            gte(invoices.issuedAt, new Date(`${range.from}T00:00:00+05:30`)),
            lt(invoices.issuedAt, new Date(new Date(`${range.to}T00:00:00+05:30`).getTime() + 86_400_000)),
          ),
        );
      const expected = (k: "totalPaise" | "basePaise" | "cgstPaise" | "sgstPaise" | "igstPaise") => issued.reduce((n, i) => n + i[k], 0);
      expect(sum("total")).toBe(expected("totalPaise"));
      expect(sum("taxableValue")).toBe(expected("basePaise"));
      expect(sum("cgst")).toBe(expected("cgstPaise"));
      expect(sum("sgst")).toBe(expected("sgstPaise"));
      expect(sum("igst")).toBe(expected("igstPaise"));
    }
    // October holds Kabir, Aditi (refunded, still invoiced) and one more paid order.
    const oct = await runTransactions(w.accounts, { from: "2026-10-01", to: "2026-10-31" });
    expect(oct.rows.reduce((n, r) => n + Number(r.total ?? 0), 0)).toBe(3 * 11_800_00);
  });

  it("filters by department", async () => {
    expect((await runTransactions(w.admin, { ...SEP_OCT, departmentId: w.mkt.id })).rows).toEqual([]);
    expect((await runTransactions(w.admin, { ...SEP_OCT, departmentId: w.cs.id })).rows).toHaveLength(5);
  });
});

describe("the runner", () => {
  it("explains bad input", async () => {
    await expect(runReport(w.admin, q("nope.report"), "2026-10-29")).rejects.toBeInstanceOf(NotFoundError);
    const badId = await runReport(w.admin, q(ENROLMENTS_REPORT, { dept: "not-a-uuid" }), "2026-10-29").catch((e) => e);
    expect(badId).toBeInstanceOf(ValidationError);
    expect(badId.message).toBe("That filter isn't valid. Pick it again from the list.");
    const backwards = await runReport(w.admin, q(ENROLMENTS_REPORT, { from: "2026-10-31", to: "2026-10-01" }), "2026-10-29").catch((e) => e);
    expect(backwards).toBeInstanceOf(ValidationError);
    await expect(runEnrolments(w.admin, { from: "2026-13-01" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("defaults to the last 30 days of the university's calendar", async () => {
    const run = await runReport(w.admin, parseQuery({ report: ENROLMENTS_REPORT }), "2026-10-29");
    expect(run.range).toEqual({ from: "2026-09-30", to: "2026-10-29" });
    expect(run.rows.map((r) => r.enrolledOn).every((d) => String(d) >= "2026-09-30")).toBe(true);
    expect(run.rows).toHaveLength(5);
  });

  it("runs another module's report with only the filters it declares", async () => {
    const seen: ReportParams[] = [];
    const scores: ReportDefinition = {
      id: "assessments.test-scores",
      label: "Test scores",
      description: "Scores, with negative marking.",
      action: "assess.view_results",
      filters: ["dateRange", "batch"],
      run: async (_actor, params) => {
        seen.push(params);
        return {
          columns: [
            { key: "student", label: "Student", type: "text" },
            { key: "marks", label: "Marks", type: "number" },
            { key: "score", label: "Score", type: "percent" },
          ],
          rows: [{ student: "Riya Sharma", marks: -2.5, score: -6.25 }],
        };
      },
    };
    setTestModules([{ id: "assessments", reports: [scores] } as ZinnyModule], { only: true });
    expect(runnableReports(w.hod).map((r) => r.id)).toContain("assessments.test-scores");
    expect(runnableReports(w.board).map((r) => r.id)).toContain("assessments.test-scores");
    expect(runnableReports(w.accounts).map((r) => r.id)).not.toContain("assessments.test-scores");

    const run = await runReport(w.board, q("assessments.test-scores", { dept: w.cs.id, course: w.course.id, batch: w.batch.id }), "2026-10-29");
    expect(seen.at(-1)).toEqual({ ...SEP_OCT, batchId: w.batch.id });
    expect(run.rows[0]).toEqual({ student: "Riya Sharma", marks: -2.5, score: -6.25 });

    const csv = await exportReport(w.board, q("assessments.test-scores"), "csv");
    expect(String(csv.body).split("\r\n")[1]).toBe("Riya Sharma,-2.5,-6.25");
  });

  it("turns a failing or malformed module report into a plain message", async () => {
    const broken = (id: string, run: ReportDefinition["run"]): ReportDefinition => ({
      id, label: id, description: "", action: "enrolment.view", filters: [], run,
    });
    setTestModules([
      {
        id: "content-progress",
        reports: [
          broken("content-progress.throws", async () => {
            throw new Error("relation does not exist");
          }),
          broken("content-progress.garbage", async () => ({ columns: [{ key: "x", label: "X", type: "chart" }], rows: [] }) as never),
          broken("content-progress.forbidden", async () => {
            throw new ForbiddenError("Not your batch.");
          }),
        ],
      } as ZinnyModule,
    ]);
    const err = (id: string) => runReport(w.admin, parseQuery({ report: id }), "2026-10-29").catch((e) => e);
    const thrown = await err("content-progress.throws");
    expect(thrown).toBeInstanceOf(ReportFailed);
    expect(reportErrorMessage(thrown)).toMatch(/^This report couldn't run\./);
    expect(await err("content-progress.garbage")).toBeInstanceOf(ReportFailed);
    const forbidden = await err("content-progress.forbidden");
    expect(reportErrorMessage(forbidden)).toBe("Not your batch.");
    expect(reportErrorMessage(new Error("secret SQL detail"))).not.toContain("SQL");
  });

  it("offers only in-scope departments, courses and batches as filters", async () => {
    const hod = await filterOptions(w.hod, "enrolment.view");
    expect(hod.departments.map((d) => d.name)).toEqual(["Computer Science"]);
    expect(hod.courses.map((c) => c.title)).toEqual(["Data Analytics"]);
    expect(hod.batches.map((b) => b.name)).toEqual(["Weekday morning"]);
    const board = await filterOptions(w.board, "enrolment.view");
    expect(board.departments.map((d) => d.name)).toEqual(["Computer Science", "Marketing"]);
    expect(board.courses.map((c) => c.title)).toEqual(["Data Analytics", "Digital Marketing"]);
    // A HOD holds no finance.view, so a transactions-style action gives them nothing to pick.
    expect(await filterOptions(w.hod, "finance.view")).toEqual({ departments: [], courses: [], batches: [] });
  });
});

describe("downloads", () => {
  it("escapes formula-looking names in CSV and records the export in the audit log", async () => {
    const file = await exportReport(w.accounts, q(TRANSACTIONS_REPORT), "csv");
    expect(file.filename).toBe("transactions-2026-09-01-to-2026-10-31.csv");
    expect(file.contentType).toBe("text/csv; charset=utf-8");
    const body = String(file.body);
    expect(body).toContain(`"'=HYPERLINK(""http://evil.example"",""Click"")"`);
    expect(body).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(body.split("\r\n")[0]).toContain("Invoice total (₹)");

    const logged = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.universityId, w.uni.id), eq(auditLog.action, "report.exported"), eq(auditLog.actorUserId, w.accounts.userId)));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ entity: "report", entityId: TRANSACTIONS_REPORT, data: { format: "csv", rows: 5 } });
  });

  it("builds an XLSX file", async () => {
    const file = await exportReport(w.board, q(ENROLMENTS_REPORT), "xlsx");
    expect(file.filename).toBe("enrolments-2026-09-01-to-2026-10-31.xlsx");
    const bytes = file.body as Uint8Array;
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]); // "PK", a zip
    expect(file.rows).toBe(6);
  });
});

describe("tenant isolation", () => {
  it("never shows another university's enrolments or orders, whatever ids are passed", async () => {
    const other = await setupReports("Other University");
    const mine = await runEnrolments(w.admin, SEP_OCT);
    expect(mine.rows).toHaveLength(6);
    expect((await runEnrolments(w.admin, { ...SEP_OCT, departmentId: other.cs.id })).rows).toEqual([]);
    expect((await runTransactions(w.admin, { ...SEP_OCT, batchId: other.batch.id })).rows).toEqual([]);
    expect((await runTransactions(other.accounts, SEP_OCT)).rows).toHaveLength(5);
    const viaPage = await runReport(w.hod, q(ENROLMENTS_REPORT, { dept: other.cs.id }), "2026-10-29").catch((e) => e);
    expect(viaPage).toBeInstanceOf(ForbiddenError);
  });
});
