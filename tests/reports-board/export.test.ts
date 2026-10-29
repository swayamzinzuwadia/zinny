import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { ReportColumn } from "@/contracts/module";
import { csvHeader, csvValue, guardFormula, toCsv } from "@/modules/reports-board/lib/csv";
import {
  columnTotal,
  fitBatchLabel,
  fitLabel,
  formatCell,
  formatHours,
  formatMoney,
  formatMoneyShort,
  niceScale,
} from "@/modules/reports-board/lib/format";
import { columnLetter, escapeXml, excelDate, sheetName, toXlsx, xlsxParts } from "@/modules/reports-board/lib/xlsx";

const COLS: ReportColumn[] = [
  { key: "name", label: "Student", type: "text" },
  { key: "marks", label: "Marks", type: "number" },
  { key: "fee", label: "Fee", type: "money" },
  { key: "score", label: "Score", type: "percent" },
  { key: "on", label: "Date", type: "date" },
];

describe("CSV formula injection guard", () => {
  it.each(["=1+1", "+91 98200 00000", "-2+3", "@SUM(A1:A2)", "\tcmd", "\rcmd", " =HYPERLINK(\"x\")", "＝1+1"])(
    "escapes a text cell starting with %j",
    (text) => {
      expect(guardFormula(text)).toBe(`'${text}`);
      expect(csvValue(text, "text").startsWith("'")).toBe(true);
    },
  );

  it("leaves ordinary text alone", () => {
    expect(guardFormula("Riya Sharma")).toBe("Riya Sharma");
    expect(guardFormula("a=b")).toBe("a=b");
    expect(guardFormula("")).toBe("");
  });

  it("keeps negative numbers in numeric columns as numbers (negative marking)", () => {
    expect(csvValue(-2.5, "number")).toBe("-2.5");
    expect(csvValue(-12.5, "percent")).toBe("-12.5");
    expect(csvValue(-50000, "money")).toBe("-500.00");
    expect(csvValue("-3", "number")).toBe("-3");
  });

  it("escapes a formula smuggled into a numeric or date column", () => {
    expect(csvValue("=cmd|' /C calc'!A0", "number")).toBe("'=cmd|' /C calc'!A0");
    expect(csvValue("-1+1", "money")).toBe("'-1+1");
    expect(csvValue("@x", "date")).toBe("'@x");
  });

  it("escapes header labels too", () => {
    expect(csvHeader({ key: "x", label: "=evil", type: "text" })).toBe("'=evil");
    expect(csvHeader({ key: "x", label: "Total", type: "money" })).toBe("Total (₹)");
    expect(csvHeader({ key: "x", label: "Score", type: "percent" })).toBe("Score (%)");
  });

  it("writes RFC 4180 rows with a BOM, CRLF and quoting, after escaping", () => {
    const csv = toCsv(COLS, [
      { name: '=HYPERLINK("http://x")', marks: -1, fee: 1200050, score: 45.5, on: "2026-10-29" },
      { name: "Rao, Aditi", marks: null, fee: undefined, score: "", on: new Date("2026-04-01T10:00:00Z") },
      { name: "Line\nbreak", marks: 0, fee: 0, score: 0, on: null },
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("Student,Marks,Fee (₹),Score (%),Date");
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://x"")",-1,12000.50,45.5,2026-10-29`);
    expect(lines[2]).toBe(`"Rao, Aditi",,,,2026-04-01`);
    expect(lines[3]).toBe(`"Line\nbreak",0,0.00,0,`);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("cell formatting", () => {
  it("formats money in rupees with Indian grouping, including negatives", () => {
    expect(formatMoney(12_00_000_00)).toBe("₹12,00,000");
    expect(formatMoney(1050)).toBe("₹10.50");
    expect(formatMoney(-50000)).toBe("-₹500");
    expect(formatMoneyShort(1_20_000_00)).toBe("₹1.2L");
    expect(formatMoneyShort(45_000_00)).toBe("₹45K");
    expect(formatMoneyShort(-3_40_00_000_00)).toBe("-₹3.4Cr");
  });

  it("formats each column type and keeps negatives", () => {
    expect(formatCell(1200000, "money")).toBe("₹12,000");
    expect(formatCell(-2.5, "number")).toBe("-2.5");
    expect(formatCell(-12.25, "percent")).toBe("-12.3%");
    expect(formatCell(66.666, "percent")).toBe("66.7%");
    expect(formatCell("2026-10-29", "date")).toBe("29 Oct 2026");
    expect(formatCell(new Date("2026-04-01T00:00:00Z"), "date")).toBe("1 Apr 2026");
    expect(formatCell(null, "money")).toBe("—");
    expect(formatCell("", "text")).toBe("—");
    expect(formatCell("n/a", "number")).toBe("n/a");
  });

  it("totals a column, skipping blanks, with negatives", () => {
    expect(columnTotal([{ a: 100 }, { a: null }, { a: -30 }, { a: "5" }], "a")).toBe(75);
    expect(columnTotal([{ a: null }], "a")).toBeNull();
  });

  it("picks round chart ticks that include zero, negatives too", () => {
    expect(niceScale(0, 29, { integer: true }).ticks).toEqual([0, 10, 20, 30]);
    expect(niceScale(0, 3, { integer: true }).ticks).toEqual([0, 1, 2, 3]);
    expect(niceScale(0, 0, { integer: true }).ticks).toEqual([0, 1]);
    expect(niceScale(0, 100).ticks).toEqual([0, 25, 50, 75, 100]);
    expect(niceScale(-2.5, 10).ticks).toEqual([-5, 0, 5, 10]);
    expect(niceScale(-12, 0).ticks).toEqual([-15, -10, -5, 0]);
    expect(niceScale(0, 29_200_000).ticks).toEqual([0, 10_000_000, 20_000_000, 30_000_000]);
  });

  it("shortens chart labels, keeping the batch name", () => {
    expect(fitLabel("Machine Learning Foundations", 12)).toBe("Machine Lea…");
    expect(fitBatchLabel("Data Analytics", "Weekday evening", 40)).toBe("Data Analytics · Weekday evening");
    expect(fitBatchLabel("Machine Learning Foundations", "Weekday evening", 26)).toBe("Machine… · Weekday evening");
    expect(fitBatchLabel("Machine Learning Foundations", "A very long batch name here", 26)).toBe("Machine Learning Foundati…");
  });

  it("says hours in plain words", () => {
    expect(formatHours(1)).toBe("1 hour");
    expect(formatHours(1.5)).toBe("1.5 hours");
    expect(formatHours(26)).toBe("26 hours");
  });
});

describe("XLSX writer", () => {
  it("names columns and sheets the way Excel wants", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(sheetName("Course / batch progress: [all]")).toBe("Course batch progress all");
    expect(sheetName("A very long report name that goes on and on")).toHaveLength(31);
    expect(sheetName("''")).toBe("Report");
    expect(excelDate("2026-10-29")).toBe(46324);
    expect(excelDate("1900-03-01")).toBe(61);
  });

  it("escapes XML and drops characters XML forbids, keeping emoji", () => {
    expect(escapeXml(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
    expect(escapeXml("bell\u0007 and \uD800 lone, 🎓 kept")).toBe("bell and  lone, 🎓 kept");
  });

  it("writes a valid package with typed cells", () => {
    const rows = [
      { name: "=SUM(A1:A9)", marks: -2.5, fee: 1200050, score: 45.5, on: "2026-10-29" },
      { name: " Aditi & co ", marks: null, fee: null, score: null, on: null },
    ];
    const zip = unzipSync(toXlsx("Test scores", COLS, rows));
    expect(Object.keys(zip).sort()).toEqual(
      ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"].sort(),
    );
    const sheet = strFromU8(zip["xl/worksheets/sheet1.xml"]);
    // Header row in bold, frozen, with filters over the data.
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1"><is><t>Student</t></is></c>');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<autoFilter ref="A1:E3"/>');
    // A formula-looking name stays text: an inline string, never an <f> formula.
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t>=SUM(A1:A9)</t></is></c>');
    expect(sheet).not.toContain("<f>");
    // Numbers stay numbers, negatives included; money in rupees; percent as a fraction; dates as serials.
    expect(sheet).toContain('<c r="B2"><v>-2.5</v></c>');
    expect(sheet).toContain('<c r="C2" s="2"><v>12000.5</v></c>');
    expect(sheet).toContain('<c r="D2" s="4"><v>0.455</v></c>');
    expect(sheet).toContain('<c r="E2" s="3"><v>46324</v></c>');
    // Blanks are left out; whitespace is preserved; & is escaped.
    expect(sheet).toContain('<row r="3"><c r="A3" t="inlineStr"><is><t xml:space="preserve"> Aditi &amp; co </t></is></c></row>');
    const book = strFromU8(zip["xl/workbook.xml"]);
    expect(book).toContain('<sheet name="Test scores" sheetId="1" r:id="rId1"/>');
    expect(book).toContain("'Test scores'!$A$1:$E$3");
    expect(strFromU8(zip["xl/styles.xml"])).toContain("&quot;₹&quot;#,##0.00");
  });

  it("handles a report with no rows", () => {
    const parts = xlsxParts("Empty", COLS, []);
    expect(parts["xl/worksheets/sheet1.xml"]).toContain('<sheetData><row r="1">');
    expect(parts["xl/worksheets/sheet1.xml"]).toContain('<autoFilter ref="A1:E1"/>');
  });
});
