/*
 * The mess on an institute's desk, and what each scrap becomes in Zinny. Every piece is drawn
 * in HTML so it stays sharp at any size, and each one flies into its tile as the page scrolls.
 * x and y place a piece on wide screens, mx and my on phones, both as % of the screen.
 */

export type Piece = {
  id: string;
  tile: string;
  note: string;
  x: number;
  y: number;
  mx: number;
  my: number;
  tilt: number;
  width: number;
  depth: number;
  Face: () => React.ReactNode;
};

const paper = "rounded-[3px] bg-white text-[#2a2a2a] shadow-[0_18px_40px_-14px_rgb(20_38_31/0.45),0_2px_4px_rgb(20_38_31/0.12)]";
const app = "overflow-hidden rounded-xl bg-white text-[#1f2933] shadow-[0_24px_50px_-16px_rgb(20_38_31/0.5),0_0_0_1px_rgb(20_38_31/0.08)]";

function Fees() {
  const rows = [
    ["Rohit S", "12,000", "PAID?"],
    ["Ananya K", "6,000", "half"],
    ["Imran M", "12,000", "call dad"],
    ["Pooja D", "??", "UPI ss"],
    ["Karan V", "12,000", "paid"],
  ];
  return (
    <div className={app}>
      <div className="flex items-center gap-2 bg-[#1d6f42] px-3 py-1.5 text-[11px] font-medium text-white">
        <span className="truncate">Fees_FINAL_v3_new(2).xlsx</span>
      </div>
      <table className="w-full border-collapse text-[11px]">
        <tbody>
          {rows.map((r, i) => (
            <tr key={r[0]} className="border-b border-[#e3e5e8]">
              <td className="w-6 border-r border-[#e3e5e8] bg-[#f3f4f6] text-center text-[#8a8f98]">{i + 2}</td>
              <td className="border-r border-[#e3e5e8] px-2 py-1">{r[0]}</td>
              <td className="border-r border-[#e3e5e8] px-2 py-1 tabular-nums">{r[1]}</td>
              <td className={`px-2 py-1 ${i === 2 || i === 3 ? "bg-[#fde2dd] text-[#b4321f]" : ""}`}>{r[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Parents() {
  return (
    <div className={app}>
      <div className="flex items-center justify-between bg-[#075e54] px-3 py-2 text-white">
        <span className="text-[12px] font-medium">Batch B parents</span>
        <span data-unread className="rounded-full bg-[#25d366] px-1.5 text-[10px] font-semibold text-[#063a2f]">
          142
        </span>
      </div>
      <div className="space-y-1.5 bg-[#ece5dd] p-2 text-[11px] leading-snug">
        <p className="w-fit max-w-[92%] rounded-lg bg-white px-2 py-1">Sir class is at 6 or 7 today?</p>
        <p className="w-fit max-w-[92%] rounded-lg bg-white px-2 py-1">Please send fees receipt again</p>
        <p className="ml-auto w-fit max-w-[92%] rounded-lg bg-[#dcf8c6] px-2 py-1">Timetable sent yesterday</p>
        <p className="w-fit max-w-[92%] rounded-lg bg-white px-2 py-1">Which timetable sir</p>
      </div>
    </div>
  );
}

function Register() {
  const names = ["Riya", "Kabir", "Tara", "Arjun", "Meera"];
  const marks = ["P P A P P P", "P A P P P A", "P P P L P P", "A P P P P P", "P P A A P P"];
  return (
    <div className={`${paper} bg-[#fdfaf0] p-3`} style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0 21px, #bfd3ea 21px 22px)" }}>
      <p className="mb-1 text-[11px] font-semibold text-[#a8402c]">Attendance. Oct. Batch C</p>
      {names.map((n, i) => (
        <p key={n} className="flex h-[22px] items-center justify-between font-serif text-[13px] text-[#20417a] italic">
          <span>{n}</span>
          <span className="tracking-[0.12em]">{marks[i]}</span>
        </p>
      ))}
    </div>
  );
}

function Sticky() {
  return (
    <div className="bg-[#fde98a] p-3 font-serif text-[15px] leading-snug text-[#3a3320] italic shadow-[0_14px_26px_-10px_rgb(20_38_31/0.45)]">
      Assignment 3 due??
      <br />
      ask Farah ma&apos;am
    </div>
  );
}

function AdmissionForm() {
  return (
    <div className={app}>
      <div className="h-1.5 bg-[#673ab7]" />
      <div className="p-3">
        <p className="text-[13px] font-medium">Admission form (Responses)</p>
        <p className="mt-0.5 text-[11px] text-[#6b7280]">212 responses · 38 duplicates</p>
        <div className="mt-2 space-y-1">
          {[88, 72, 94].map((w) => (
            <div key={w} className="h-2 rounded-sm bg-[#e5e7eb]" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PaperTimetable() {
  return (
    <div className={`${paper} p-3`}>
      <p className="text-center text-[11px] font-bold">TIMETABLE (NEW) (REVISED)</p>
      <div className="mt-2 grid grid-cols-4 gap-px bg-[#2a2a2a] text-center text-[10px]">
        {["Mon", "Tue", "Wed", "Thu", "DA", "ML", "PY", "DA", "PY", "DA", "ML", "PY"].map((c, i) => (
          <span key={i} className={`bg-white py-1 ${i === 6 ? "text-[#b4321f] line-through" : ""}`}>
            {c}
          </span>
        ))}
      </div>
      <p className="mt-1.5 font-serif text-[12px] text-[#b4321f] italic">Wed moved to Thu!!</p>
    </div>
  );
}

function MeetingLink() {
  return (
    <div className={app}>
      <div className="bg-[#2d8cff] px-3 py-1.5 text-[11px] font-medium text-white">Yesterday&apos;s class</div>
      <div className="p-3">
        <p className="text-[12px] font-medium">Is the link the same as yesterday?</p>
        <p className="mt-1 truncate text-[11px] text-[#2d6fd2] underline">meet.link/abc-defg-hij</p>
        <p className="mt-1 text-[11px] text-[#6b7280]">Attendance: ask students to reply</p>
      </div>
    </div>
  );
}

function Marks() {
  return (
    <div className={`${paper} p-3`}>
      <p className="text-[11px] font-bold">Mock test marks</p>
      <div className="mt-1.5 space-y-0.5 font-serif text-[13px] text-[#20417a] italic">
        <p>Riya 34 / 40</p>
        <p>Kabir 29 / 40</p>
        <p className="text-[#b4321f] line-through">Tara 31 / 40</p>
        <p>Tara 33 / 40 (rechecked)</p>
      </div>
    </div>
  );
}

function WordCertificate() {
  return (
    <div className={app}>
      <div className="bg-[#2b579a] px-3 py-1.5 text-[11px] font-medium text-white">
        <span className="block truncate">Certificate_Riya_EDITED.docx</span>
      </div>
      <div className="p-3 text-center">
        <p className="font-serif text-[14px]">Certificate of Completion</p>
        <p className="mt-1 text-[11px] text-[#b4321f]">[STUDENT NAME HERE]</p>
      </div>
    </div>
  );
}

function Pamphlet() {
  return (
    <div className={`${paper} bg-[#fff4d6] p-3 text-center`}>
      <p className="text-[12px] font-black leading-tight">ADMISSIONS OPEN!!</p>
      <p className="mt-1 text-[10px] leading-snug">Limited seats. Call 98XXX XXXXX. Near bus stand.</p>
    </div>
  );
}

function Notebook() {
  return (
    <div className={`${paper} p-3 font-serif text-[13px] leading-[1.45] text-[#20417a] italic`}>
      <p>Oct total = ?</p>
      <p>4,12,000 + 88,500</p>
      <p>
        − refunds <span className="text-[#b4321f] not-italic">(check)</span>
      </p>
      <p className="border-t border-[#20417a]/40">= ask Arun</p>
    </div>
  );
}

function Recordings() {
  return (
    <div className="relative">
      <div className="h-3 w-1/2 rounded-t-lg bg-[#e0a92e]" />
      <div className="rounded-lg rounded-tl-none bg-[#f3c34b] p-3 text-[#3a2a06] shadow-[0_20px_40px_-14px_rgb(20_38_31/0.5)]">
        <p className="text-[13px] font-semibold">Recordings_old</p>
        <p className="mt-0.5 text-[11px]">214 lectures. Never opened.</p>
      </div>
    </div>
  );
}

/** In reading order of the tiles. `Recordings` comes last: it's where the page turns to the marketplace. */
export const PIECES: Piece[] = [
  { id: "admissions", tile: "Admissions", note: "One form, no duplicates", x: 67, y: 17, mx: 74, my: 17, tilt: 3, width: 230, depth: 0.5, Face: AdmissionForm },
  { id: "timetable", tile: "Timetable", note: "Built from your batches", x: 89, y: 74, mx: 78, my: 74, tilt: -5, width: 220, depth: 0.8, Face: PaperTimetable },
  { id: "classes", tile: "Live classes", note: "Join from the timetable", x: 31, y: 85, mx: 24, my: 89, tilt: 6, width: 220, depth: 0.6, Face: MeetingLink },
  { id: "attendance", tile: "Attendance", note: "Marked as they join", x: 11, y: 70, mx: 24, my: 74, tilt: 4, width: 240, depth: 1, Face: Register },
  { id: "tests", tile: "Tests", note: "Timed, graded, results shared", x: 69, y: 86, mx: 74, my: 88, tilt: -3, width: 190, depth: 0.7, Face: Marks },
  { id: "assignments", tile: "Assignments", note: "Due dates everyone can see", x: 33, y: 16, mx: 18, my: 25, tilt: -8, width: 170, depth: 0.9, Face: Sticky },
  { id: "fees", tile: "Fees and GST", note: "An invoice for every rupee", x: 14, y: 26, mx: 30, my: 17, tilt: -6, width: 290, depth: 1.1, Face: Fees },
  { id: "certificates", tile: "Certificates", note: "With a QR anyone can check", x: 7, y: 48, mx: 16, my: 71, tilt: 5, width: 220, depth: 0.5, Face: WordCertificate },
  { id: "messages", tile: "Messages", note: "To the right people, once", x: 88, y: 29, mx: 82, my: 25, tilt: 5, width: 250, depth: 1.2, Face: Parents },
  { id: "website", tile: "Your website", note: "With live seat counts", x: 95, y: 52, mx: 86, my: 70, tilt: 7, width: 170, depth: 0.6, Face: Pamphlet },
  { id: "reports", tile: "Reports", note: "The numbers, already added up", x: 50, y: 14, mx: 50, my: 8, tilt: 2, width: 180, depth: 0.4, Face: Notebook },
  { id: "recordings", tile: "Recordings", note: "Ready to sell on the marketplace", x: 50, y: 88, mx: 50, my: 95, tilt: -2, width: 210, depth: 0.9, Face: Recordings },
];

/** ₹1,499, with Indian digit grouping. */
export const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
