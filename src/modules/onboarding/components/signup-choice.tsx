import Link from "next/link";
import { ActionIcon } from "@/components/ui";
import { TRIAL_DAYS } from "../lib/constants";
import { Morph } from "./motion";

/** The view-transition name the institute card shares with the sign-up wizard, so the card grows into it. */
export const INSTITUTE_MORPH = "onb-institute-signup";
export const STUDENT_MORPH = "onb-student-signup";

const CHOICES = [
  {
    href: "/signup/institute",
    morph: INSTITUTE_MORPH,
    title: "Sign up as institute",
    body: `Run your courses, batches, tests and fees on Zinny. Free for ${TRIAL_DAYS} days, no card needed.`,
    points: ["Your own space for staff and students", "GST invoices for your students", "Choose a plan when you're ready"],
  },
  {
    href: "/signup?as=student",
    morph: STUDENT_MORPH,
    title: "Sign up as student",
    body: "Join your institute with its joining code, or buy recorded courses on the marketplace.",
    points: ["Your classes, tests and timetable", "Courses from institutes across India", "Sign up with email or mobile number"],
  },
] as const;

/** /signup: the two ways in. Each card grows into the page it opens. */
export function SignupChoice() {
  return (
    <div>
      <h1 className="text-[clamp(2.1rem,6vw,3.2rem)] leading-[1.05] font-medium tracking-[-0.02em]">Create your Zinny account</h1>
      <p className="mt-3 max-w-[34rem] text-[16px] text-muted">Tell us who you are, and we&apos;ll take you to the right sign-up.</p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {CHOICES.map((c) => (
          <li key={c.href}>
            <Morph name={c.morph}>
              <Link
                href={c.href}
                className="group flex h-full flex-col rounded-[22px] bg-surface p-6 ring-1 ring-line transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_50px_-28px_rgb(6_58_47/0.45)] hover:ring-brand/40 focus-visible:ring-4 focus-visible:ring-gold-soft motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <h2 className="text-[24px] leading-tight font-semibold">{c.title}</h2>
                <p className="mt-2 text-[14px] text-muted">{c.body}</p>
                <ul className="mt-4 flex-1 space-y-2 text-[14px]">
                  {c.points.map((p) => (
                    <li key={p} className="flex gap-2">
                      <span className="text-brand">
                        <ActionIcon name="check" />
                      </span>
                      {p}
                    </li>
                  ))}
                </ul>
                <span className="mt-6 inline-flex h-10 items-center justify-center gap-1.5 self-start rounded-full bg-brand px-5 text-[14px] font-medium text-canvas transition-colors group-hover:bg-brand-strong">
                  <ActionIcon name="forward" />
                  {c.title}
                </span>
              </Link>
            </Morph>
          </li>
        ))}
      </ul>
    </div>
  );
}
