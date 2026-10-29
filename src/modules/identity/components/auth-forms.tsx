"use client";
/**
 * Forms for the sign-in screens. Each one keeps what was typed when the server answers
 * with an error (React resets uncontrolled forms after an action, so values come back
 * from the action state), and shows a state that fits the error: a locked account, an
 * expired link, a wrong code.
 */
import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cx, inputClass } from "@/components/ui";

export type AuthState = { ok?: string; error?: string; code?: string; email?: string; at?: number } | null;
type Action = (prev: AuthState, data: FormData) => Promise<AuthState>;

/* ───────────────────────────── Pieces ───────────────────────────── */

export function Submit({ children, pendingText, variant = "primary", full = true }: { children: ReactNode; pendingText: string; variant?: "primary" | "secondary" | "ghost"; full?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className={cx(buttonClass(variant), full && "h-11 w-full text-[15px]")}>
      {pending ? pendingText : children}
    </button>
  );
}

function Label({ htmlFor, children, aside }: { htmlFor: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-[13px] font-medium">
        {children}
      </label>
      {aside}
    </div>
  );
}

/** A password box with a Show / Hide button. */
export function PasswordField({
  name,
  label,
  autoComplete,
  hint,
  aside,
  autoFocus,
}: {
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  hint?: string;
  aside?: ReactNode;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div>
      <Label htmlFor={id} aside={aside}>
        {label}
      </Label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus={autoFocus}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={cx(inputClass, "h-11 pr-16 text-[15px]")}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={shown}
          className="absolute inset-y-1 right-1 rounded-lg px-3 text-[13px] font-medium text-brand hover:bg-brand-soft"
        >
          {shown ? "Hide" : "Show"}
        </button>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-[12px] text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

function TextField({
  name,
  label,
  type = "text",
  defaultValue,
  autoComplete,
  inputMode,
  placeholder,
  autoFocus,
  aside,
  hint,
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  autoComplete?: string;
  inputMode?: "email" | "tel" | "numeric";
  placeholder?: string;
  autoFocus?: boolean;
  aside?: ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div>
      <Label htmlFor={id} aside={aside}>
        {label}
      </Label>
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        inputMode={inputMode}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoCapitalize="none"
        spellCheck={false}
        required
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cx(inputClass, "h-11 text-[15px]")}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-[12px] text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/** An error, or a calmer notice for states that aren't the person's mistake (a lock, an expired code). */
export function Alert({ tone, title, children }: { tone: "danger" | "gold" | "brand"; title?: string; children: ReactNode }) {
  const tones = {
    danger: "bg-danger-soft text-danger",
    gold: "bg-gold-soft text-gold-strong",
    brand: "bg-brand-soft text-brand-strong",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} aria-live="polite" className={cx("rounded-2xl px-4 py-3 text-[14px] leading-relaxed", tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

/** "Resend code in 0:24", then a button. Counts on the client from the server's time. */
function useSecondsUntil(when: number) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((when - Date.now()) / 1000)));
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((when - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [when]);
  return left;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/* ───────────────────────────── Email and password ───────────────────────────── */

export function PasswordSignInForm({ action, next, defaultEmail, resetHref }: { action: Action; next: string; defaultEmail?: string; resetHref: string }) {
  const [state, formAction] = useActionState(action, null);
  const email = state?.email ?? defaultEmail ?? "";
  const resetWithEmail = email ? `${resetHref}${resetHref.includes("?") ? "&" : "?"}email=${encodeURIComponent(email)}` : resetHref;
  return (
    <form action={formAction} className="space-y-4" noValidate={false}>
      <input type="hidden" name="next" value={next} />
      <TextField key={`e-${state?.at ?? 0}`} name="email" label="Email" type="email" inputMode="email" autoComplete="username" defaultValue={email} autoFocus={!email} />
      <PasswordField
        key={`p-${state?.at ?? 0}`}
        name="password"
        label="Password"
        autoComplete="current-password"
        autoFocus={!!email}
        aside={
          <Link href={resetWithEmail} className="text-[13px] text-brand hover:underline">
            Forgot password?
          </Link>
        }
      />
      {state?.error && state.code === "locked" && (
        <Alert tone="gold" title="This account is paused for now">
          <p>{state.error}</p>
          <Link href={resetWithEmail} className="mt-2 inline-block font-medium text-brand-strong underline underline-offset-2">
            Reset your password
          </Link>
        </Alert>
      )}
      {state?.error && state.code === "network_locked" && (
        <Alert tone="gold" title="Too many attempts">
          {state.error}
        </Alert>
      )}
      {state?.error && state.code !== "locked" && state.code !== "network_locked" && <Alert tone="danger">{state.error}</Alert>}
      <Submit pendingText="Signing in…">Sign in</Submit>
    </form>
  );
}

/* ───────────────────────────── Phone ───────────────────────────── */

export function PhoneNumberForm({ action, uni, next }: { action: Action; uni: string; next: string }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="next" value={next} />
      <TextField
        name="phone"
        label="Mobile number"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="98200 11001"
        autoFocus
        hint="The number your institute has for you. We'll text you a 6-digit code."
      />
      {state?.error && <Alert tone={state.code === "locked" || state.code === "rate_limited" ? "gold" : "danger"}>{state.error}</Alert>}
      <Submit pendingText="Sending code…">Send code</Submit>
    </form>
  );
}

export function PhoneCodeForm({
  verify,
  resend,
  restart,
  uni,
  next,
  masked,
  resendAt,
  expiresAt,
  attemptsLeft,
  sendsLeft,
}: {
  verify: Action;
  resend: Action;
  restart: (data: FormData) => Promise<void>;
  uni: string;
  next: string;
  masked: string;
  resendAt: number;
  expiresAt: number;
  attemptsLeft: number;
  sendsLeft: number;
}) {
  const [state, verifyAction] = useActionState(verify, null);
  const [resent, resendAction] = useActionState(resend, null);
  const [sentAt, setSentAt] = useState(resendAt);
  const [expiry, setExpiry] = useState(expiresAt);
  const codeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (resent?.ok) {
      setSentAt(Date.now() + 30_000);
      setExpiry(Date.now() + 5 * 60_000);
      codeRef.current?.focus();
    }
  }, [resent]);
  const waitResend = useSecondsUntil(sentAt);
  const expiresIn = useSecondsUntil(expiry);
  const expired = expiresIn === 0;
  const terminal = state?.code === "too_many_attempts" || state?.code === "code_expired";
  const restartNeeded = state?.code === "restart" || state?.code === "locked" || resent?.code === "restart";
  const id = useId();

  return (
    <div className="space-y-5">
      <p className="text-[15px] text-muted">
        Enter the 6-digit code we sent to <span className="font-medium text-ink">{masked}</span>.
      </p>
      <form action={verifyAction} className="space-y-4">
        <input type="hidden" name="uni" value={uni} />
        <input type="hidden" name="next" value={next} />
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor={id} className="text-[13px] font-medium">
              Code
            </label>
            <span className={cx("tabular text-[12px]", expired ? "text-gold-strong" : "text-muted")} aria-live="polite">
              {expired ? "Code expired" : `Expires in ${mmss(expiresIn)}`}
            </span>
          </div>
          <input
            key={state?.at ?? 0}
            ref={codeRef}
            id={id}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            required
            autoFocus
            aria-describedby={`${id}-left`}
            className={cx(inputClass, "tabular h-14 text-center text-[26px] font-semibold tracking-[0.4em]")}
          />
          <p id={`${id}-left`} className="mt-1 text-[12px] text-muted">
            {attemptsLeft < 5 && !state ? `${attemptsLeft} tries left for this code.` : "You have 5 tries for each code."}
          </p>
        </div>
        {state?.error && (
          <Alert
            tone={state.code === "wrong_code" || state.code === "invalid_code" ? "danger" : "gold"}
            title={state.code === "wrong_code" ? "Wrong code" : state.code === "locked" ? "Phone sign-in is paused" : terminal ? "Ask for a new code" : undefined}
          >
            {state.error}
          </Alert>
        )}
        {expired && !state?.error && <Alert tone="gold" title="This code has expired">Ask for a new code below.</Alert>}
        {!restartNeeded && <Submit pendingText="Checking code…">Sign in</Submit>}
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-[14px]">
        {!restartNeeded && sendsLeft > 0 ? (
          <form action={resendAction}>
            {waitResend > 0 ? (
              <span className="tabular text-muted">Resend code in {mmss(waitResend)}</span>
            ) : (
              <ResendButton />
            )}
          </form>
        ) : (
          <span className="text-muted">{restartNeeded ? "Start again to get a new code." : "No more codes for this sign-in."}</span>
        )}
        <form action={restart}>
          <input type="hidden" name="uni" value={uni} />
          <input type="hidden" name="next" value={next} />
          <button className="font-medium text-brand hover:underline">Use a different number</button>
        </form>
      </div>
      {resent?.ok && <Alert tone="brand">{resent.ok}</Alert>}
      {resent?.error && <Alert tone="gold">{resent.error}</Alert>}
    </div>
  );
}

function ResendButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="font-medium text-brand hover:underline disabled:opacity-50">
      {pending ? "Sending…" : "Resend code"}
    </button>
  );
}

export function PhoneChooseForm({ action, uni, next, accounts }: { action: Action; uni: string; next: string; accounts: { id: string; name: string; email: string }[] }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <div className="space-y-4">
      <p className="text-[15px] text-muted">More than one account uses this number. Choose who is signing in.</p>
      <div className="grid gap-2">
        {accounts.map((a) => (
          <form key={a.id} action={formAction}>
            <input type="hidden" name="uni" value={uni} />
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="userId" value={a.id} />
            <button className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left hover:border-brand/40">
              <span>
                <span className="block font-medium">{a.name}</span>
                <span className="block text-[13px] text-muted">{a.email}</span>
              </span>
              <span className="text-[13px] font-medium text-brand">Sign in</span>
            </button>
          </form>
        ))}
      </div>
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
    </div>
  );
}

/* ───────────────────────────── Reset and invite ───────────────────────────── */

export function ResetRequestForm({ action, defaultEmail }: { action: Action; defaultEmail?: string }) {
  const [state, formAction] = useActionState(action, null);
  if (state?.code === "sent") {
    return (
      <div className="space-y-5" role="status" aria-live="polite">
        <div className="rounded-[22px] border border-line bg-surface p-5">
          <p className="font-medium">Check your email</p>
          <p className="mt-1.5 text-[15px] text-muted">
            If there&apos;s a Zinny account for <span className="font-medium text-ink">{state.email}</span>, we&apos;ve sent it a link to choose a new
            password. The link works once, for 30 minutes.
          </p>
        </div>
        <p className="text-[14px] text-muted">
          Nothing after a few minutes? Check your spam folder, make sure the address is the one your institute registered, or ask your institute&apos;s
          admin to send you a new invitation.
        </p>
        <Link href="/login" className={cx(buttonClass("secondary"), "h-11 w-full text-[15px]")}>
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-4">
      <TextField
        key={state?.at ?? 0}
        name="email"
        label="Email"
        type="email"
        inputMode="email"
        autoComplete="username"
        defaultValue={state?.email ?? defaultEmail}
        autoFocus
      />
      {state?.error && <Alert tone={state.code === "rate_limited" ? "gold" : "danger"}>{state.error}</Alert>}
      <Submit pendingText="Sending link…">Send reset link</Submit>
    </form>
  );
}

const LINK_ERRORS = new Set(["invalid_link", "used_link", "expired_link", "revoked_link", "replaced_link", "no_access", "has_password"]);

/** Choose a password: for a reset link and for an invitation. */
export function NewPasswordForm({
  action,
  token,
  email,
  submitLabel,
  pendingText,
  linkHelp,
}: {
  action: Action;
  token: string;
  email: string;
  submitLabel: string;
  pendingText: string;
  /** Shown when the link turns out to be unusable while the page was open. */
  linkHelp: ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);
  if (state?.code && LINK_ERRORS.has(state.code)) {
    return (
      <div className="space-y-4">
        <Alert tone="gold">{state.error}</Alert>
        {linkHelp}
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {/* Lets password managers save the new password against the right account. */}
      <input type="text" name="username" value={email} autoComplete="username" readOnly hidden />
      <PasswordField key={`n-${state?.at ?? 0}`} name="password" label="New password" autoComplete="new-password" autoFocus hint="At least 8 characters. A short sentence works well." />
      <PasswordField key={`c-${state?.at ?? 0}`} name="confirm" label="Type it again" autoComplete="new-password" />
      {state?.error && <Alert tone="danger">{state.error}</Alert>}
      <Submit pendingText={pendingText}>{submitLabel}</Submit>
    </form>
  );
}
