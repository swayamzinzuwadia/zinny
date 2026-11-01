import { display } from "../fonts";
import css from "../landing.module.css";
import { Reveal } from "./Reveal";

/*
 * Everything Zinny does, written up as a timetable on the chalkboard. Columns are subjects,
 * blocks are features, and tall blocks are the ones an institute spends the most time in.
 */

type Block = { title: string; note: string; tall?: boolean; star?: boolean };

const SUBJECTS: { name: string; blocks: Block[] }[] = [
  {
    name: "Run",
    blocks: [
      { title: "Courses and batches", note: "Departments, programs, real seat limits", tall: true },
      { title: "Timetables", note: "Built from batches, updated on any change" },
      { title: "People", note: "Invitations, bulk import, self sign-up" },
      { title: "Roles", note: "Built-in or your own, down to one batch" },
      { title: "Today board", note: "What's on now, and what needs you" },
    ],
  },
  {
    name: "Teach",
    blocks: [
      { title: "Live classes", note: "Join from the timetable", tall: true },
      { title: "Attendance", note: "Marked as students join" },
      { title: "Lessons", note: "Video, PDF and text, on a schedule" },
      { title: "Assignments", note: "Submissions, grades and late rules" },
      { title: "Polls", note: "A quick read of the room" },
    ],
  },
  {
    name: "Assess",
    blocks: [
      { title: "Tests", note: "Five question types and shared pools", tall: true },
      { title: "Test series", note: "Practice sets for exam preparation" },
      { title: "Proctoring", note: "Full-screen exits and tab switches" },
      { title: "Progress", note: "Lesson by lesson, course by course" },
      { title: "Certificates", note: "Your design, with a QR check" },
    ],
  },
  {
    name: "Earn",
    blocks: [
      { title: "Marketplace", note: "Sell recorded courses and lectures to anyone", tall: true, star: true },
      { title: "Checkout", note: "UPI, cards and netbanking" },
      { title: "GST invoices", note: "On every paid order" },
      { title: "Refunds", note: "Tracked against the invoice" },
      { title: "Sales reports", note: "Built for accounts staff" },
    ],
  },
  {
    name: "Grow",
    blocks: [
      { title: "Your website", note: "Courses, faculty, reviews and a blog", tall: true },
      { title: "Enquiries", note: "All in one inbox" },
      { title: "XP and leaderboards", note: "Badges and challenges for every batch" },
      { title: "Messages", note: "Email, SMS and WhatsApp" },
      { title: "Insights", note: "The numbers the board asks for" },
    ],
  },
];

export function Timetable() {
  return (
    <section id="everything" aria-labelledby="everything-title" className={`scroll-mt-20 px-5 pt-20 pb-24 text-canvas sm:px-8 md:pb-36 lg:px-12 ${css.chalkboard}`}>
      <div className="mx-auto max-w-[1296px]">
        <Reveal className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-end lg:gap-14">
          <div>
            <p className="text-[15px] text-gold">Everything it does</p>
            <h2 id="everything-title" className={`${display.className} ${css.heading} mt-4 text-[clamp(2.75rem,6.4vw,6rem)] leading-[0.98] tracking-[-0.022em]`}>
              The whole app, <em className="text-gold">on one timetable.</em>
            </h2>
          </div>
          <p className={`max-w-md text-[17px] leading-relaxed text-canvas/70 ${css.pretty}`}>All of it sits in one place, so nobody at your institute needs a second tool or a shared spreadsheet.</p>
        </Reveal>

        <div className="mt-12 grid gap-x-3 gap-y-8 sm:grid-cols-2 lg:mt-16 lg:grid-cols-5">
          {SUBJECTS.map((s, i) => (
            <Reveal key={s.name} delay={i * 0.06}>
              <h3 className="border-b border-canvas/20 pb-3 text-[15px] font-medium">{s.name}</h3>
              {/* Two across on phones, so the whole timetable stays a quick read. */}
              <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-1">
                {s.blocks.map((b) => (
                  <li
                    key={b.title}
                    className={`flex flex-col rounded-2xl p-3.5 ${b.tall ? "col-span-2 sm:col-span-1 sm:min-h-[136px]" : ""} ${b.star ? "bg-canvas text-brand-deep" : "bg-canvas/[0.07]"}`}
                  >
                    <span className={b.tall ? `${display.className} ${css.accent} text-[23px] leading-[1.12]` : "text-[15px] font-medium"}>{b.title}</span>
                    <span className={`mt-auto pt-1.5 text-[13px] leading-snug ${b.star ? "text-brand-deep/70" : "text-canvas/60"}`}>{b.note}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
