import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/* ─────────────── Brand ─────────────── */

export function LogoMark({ size = 36, className }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/zinny-mark.png" alt="" width={size} height={size} className={className} />;
}

/** Full lockup. `tone="cream"` for dark green backgrounds. */
export function Logo({ height = 32, tone = "green" }: { height?: number; tone?: "green" | "cream" }) {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="Zinny">
      <LogoMark size={height} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={tone === "cream" ? "/brand/zinny-wordmark-cream.png" : "/brand/zinny-wordmark.png"}
        alt="zinny"
        style={{ height: height * 0.95, width: "auto" }}
      />
    </span>
  );
}

/* ─────────────── Layout ─────────────── */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[30px] font-semibold leading-tight">{title}</h1>
        {subtitle && <div className="mt-1.5 max-w-2xl text-[15px] text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={cx("rounded-[22px] border border-line bg-surface p-6", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="text-[17px] font-medium">{children}</h2>
      {hint && <span className="text-[13px] text-muted">{hint}</span>}
    </div>
  );
}

type Tone = "neutral" | "brand" | "gold" | "warn" | "danger";
const TONES: Record<Tone, string> = {
  neutral: "bg-canvas text-muted ring-1 ring-line",
  brand: "bg-brand-soft text-brand-strong",
  gold: "bg-gold-soft text-gold-strong",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium", TONES[tone])}>{children}</span>;
}

export function Notice({ tone = "brand", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={cx("rounded-2xl px-4 py-3 text-[14px]", TONES[tone])}>{children}</div>;
}

/* ─────────────── Controls ─────────────── */

const BTN = {
  primary: "bg-brand text-canvas hover:bg-brand-strong",
  gold: "bg-gold text-brand-deep hover:bg-[#c99a1c]",
  secondary: "border border-line bg-surface text-ink hover:border-brand/40",
  ghost: "text-brand hover:bg-brand-soft",
  danger: "border border-line bg-surface text-danger hover:bg-danger-soft",
  onDark: "border border-canvas/25 text-canvas hover:bg-canvas/10",
};
export type ButtonVariant = keyof typeof BTN;
export const buttonClass = (v: ButtonVariant = "primary", size: "md" | "sm" = "md") =>
  cx(
    "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    size === "md" ? "h-10 px-5 text-[14px]" : "h-8 px-3.5 text-[13px]",
    BTN[v],
  );

export function ButtonLink({ href, variant = "primary", size = "md", children }: { href: string; variant?: ButtonVariant; size?: "md" | "sm"; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClass(variant, size)}>
      {children}
    </Link>
  );
}

export const inputClass =
  "h-10 w-full rounded-xl border border-line bg-surface px-3 text-[14px] outline-none transition placeholder:text-faint focus:border-brand focus:ring-4 focus:ring-gold-soft";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Select({ children, ...props }: ComponentProps<"select">) {
  return (
    <select {...props} className={cx(inputClass, "pr-8", props.className)}>
      {children}
    </select>
  );
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(inputClass, "h-auto min-h-24 py-2.5 text-[13px] leading-relaxed", props.className)} />;
}

/* ─────────────── Content ─────────────── */

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[22px] border border-dashed border-line px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-[14px] text-muted">{children}</div>}
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[22px] border border-line bg-surface">
      <table className="w-full min-w-[640px] text-left text-[14px]">
        <thead className="border-b border-line text-[13px] text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-5 py-3 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cx("px-5 py-3.5 align-top", className)}>{children}</td>;
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <nav className="mb-7 flex gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cx(
            "whitespace-nowrap rounded-full px-4 py-1.5 text-[14px]",
            t.key === active ? "bg-brand font-medium text-canvas" : "text-muted hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className={cx("ml-1.5", t.key === active ? "text-gold" : "text-faint")}>{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-[22px] border border-line bg-surface px-5 py-4">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="tabular mt-1 text-[30px] font-semibold leading-none">{value}</div>
      {hint && <div className="mt-1.5 text-[12px] text-muted">{hint}</div>}
    </div>
  );
}

const AVATAR = ["bg-brand-soft text-brand-strong", "bg-gold-soft text-gold-strong", "bg-[#e6ebf3] text-[#2f4a72]", "bg-[#f1e6ee] text-[#7a3d66]"];

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const tone = AVATAR[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR.length];
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-medium", tone)}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/**
 * A batch's seats as a little seat map: filled = enrolled, gold = someone paying right now,
 * outline = free. Large batches fall back to a bar.
 */
export function SeatMap({ limit, taken, held = 0 }: { limit: number; taken: number; held?: number }) {
  if (limit > 60) {
    const pct = (n: number) => `${Math.min(100, (n / limit) * 100)}%`;
    return (
      <div className="flex h-2.5 overflow-hidden rounded-full bg-line" role="img" aria-label={`${taken} of ${limit} seats taken`}>
        <div className="bg-brand" style={{ width: pct(taken) }} />
        <div className="bg-gold" style={{ width: pct(held) }} />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-[5px]" role="img" aria-label={`${taken} of ${limit} seats taken${held ? `, ${held} being paid for` : ""}`}>
      {Array.from({ length: limit }, (_, i) => (
        <span
          key={i}
          className={cx(
            "h-[11px] w-[11px] rounded-[4px]",
            i < taken ? "bg-brand" : i < taken + held ? "bg-gold" : "border border-[#d9cfb6] bg-transparent",
          )}
        />
      ))}
    </div>
  );
}
