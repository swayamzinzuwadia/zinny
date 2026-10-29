import Link from "next/link";
import type { ReactNode } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Badge, cx } from "@/components/ui";
import { DIFFICULTY_LABEL, KIND_LABEL, TYPE_LABEL, fmtMarks } from "../lib/labels";
import { correctOptionIds } from "../lib/marking";
import type { Difficulty, QuestionAnswer, QuestionOption, QuestionType, TestKind } from "../schema";

export function KindBadge({ kind }: { kind: TestKind }) {
  return <Badge tone={kind === "mock_test" ? "brand" : "neutral"}>{KIND_LABEL[kind]}</Badge>;
}

export function StatusBadge({ status }: { status: "draft" | "published" }) {
  return status === "published" ? <Badge tone="brand">Published</Badge> : <Badge>Draft</Badge>;
}

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return <Badge tone={difficulty === "hard" ? "warn" : "neutral"}>{DIFFICULTY_LABEL[difficulty]}</Badge>;
}

/** One question with its options; correct options marked when `answer` is given (staff only). */
export function QuestionPreview({
  q,
  showAnswer = true,
  compact = false,
}: {
  q: { type: QuestionType; prompt: string; options: QuestionOption[]; answer?: QuestionAnswer; marks: number; negativeMarks: number; difficulty?: Difficulty; tags?: string[]; explanation?: string };
  showAnswer?: boolean;
  compact?: boolean;
}) {
  const correct = showAnswer && q.answer ? new Set(correctOptionIds(q.answer)) : new Set<string>();
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
        <Badge>{TYPE_LABEL[q.type]}</Badge>
        {q.difficulty && <DifficultyBadge difficulty={q.difficulty} />}
        <span className="text-muted">
          {fmtMarks(q.marks)} mark{q.marks === 1 ? "" : "s"}
          {q.negativeMarks > 0 && `, −${fmtMarks(q.negativeMarks)} if wrong`}
        </span>
        {q.tags?.map((t) => (
          <span key={t} className="rounded-full bg-canvas px-2 py-px text-muted ring-1 ring-line">
            {t}
          </span>
        ))}
      </div>
      <p className={cx("whitespace-pre-wrap text-[14px]", !compact && "font-medium")}>{q.prompt}</p>
      {!compact && q.options.length > 0 && (
        <ul className="mt-2 grid gap-1 text-[13px] sm:grid-cols-2">
          {q.options.map((o, i) => (
            <li key={o.id} className={cx("flex gap-2 rounded-xl px-2.5 py-1.5", correct.has(o.id) ? "bg-brand-soft text-brand-strong" : "bg-canvas")}>
              <span className="text-muted">{String.fromCharCode(65 + i)}</span>
              <span className="min-w-0 flex-1">{o.text}</span>
              {correct.has(o.id) && <span className="font-medium">Correct</span>}
            </li>
          ))}
        </ul>
      )}
      {!compact && showAnswer && q.answer && "value" in q.answer && (
        <p className="mt-2 text-[13px] text-brand-strong">
          Answer: {q.answer.value}
          {q.answer.tolerance > 0 && ` (±${q.answer.tolerance})`}
        </p>
      )}
      {!compact && showAnswer && q.answer && "guide" in q.answer && q.answer.guide && <p className="mt-2 text-[13px] text-muted">Guide: {q.answer.guide}</p>}
    </div>
  );
}

/** A small one-button form (move, remove). */
export function InlineAction({
  action,
  fields,
  children,
  variant = "ghost",
  confirm,
}: {
  action: FormAction;
  fields: Record<string, string>;
  children: ReactNode;
  variant?: "ghost" | "danger" | "secondary";
  confirm?: string;
}) {
  return (
    <ActionForm action={action} resetOnSuccess={false} confirm={confirm} className="inline">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton size="sm" variant={variant} pendingText="…">
        {children}
      </SubmitButton>
    </ActionForm>
  );
}

export function FilterLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cx(
        "whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] transition-colors",
        active ? "bg-brand font-medium text-canvas" : "border border-line bg-surface text-muted hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

/** A horizontal bar for "% correct". */
export function PercentBar({ value, tone = "brand" }: { value: number; tone?: "brand" | "gold" }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-line" role="img" aria-label={`${Math.round(value)}%`}>
        <div className={tone === "gold" ? "h-full bg-gold" : "h-full bg-brand"} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="tabular text-[13px]">{Math.round(value)}%</span>
    </div>
  );
}
