"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { ActionIcon, Badge, Notice, Select, Textarea, buttonClass, cx, inputClass } from "@/components/ui";
import { DOCUMENT_KINDS, GST_STATES, INSTITUTE_TYPES, TRIAL_DAYS, documentType, slugFrom } from "../lib/constants";
import type { InstituteSignupInput, SignupStep } from "../services/signup";
import { FileDrop } from "./file-drop";
import { Grow } from "./motion";
import { uploadDocument } from "./upload-client";
import "./motion.css";

const STEPS: { key: SignupStep; label: string; title: string; lead: string }[] = [
  { key: "institute", label: "Institute", title: "About your institute", lead: "This goes on your invoices and your institute's Zinny space." },
  { key: "account", label: "Your account", title: "Your admin account", lead: "You'll sign in with this email and password to run the institute." },
  { key: "gst", label: "GST", title: "GST on your courses", lead: "This decides whether the invoices your students get include GST." },
  { key: "documents", label: "Documents", title: "Your documents", lead: "We need your PAN card to start. Add the others now or later from your admin." },
];

type Values = Omit<InstituteSignupInput, "documents" | "source">;
type CheckResult = { step: SignupStep; message: string } | null;
export type StartResult = { ok: true; slug: string; trialEndsAt: string } | { ok: false; step: SignupStep | null; message: string };
/** Consent to each purpose on its own (DPDP Act s.6, recorded by the privacy module): account and service are needed, news is optional and off. */
export type SignupConsents = { account: boolean; service: boolean; marketing: boolean };

const EMPTY: Values = {
  name: "",
  legalName: "",
  instituteType: "",
  city: "",
  stateCode: "",
  address: "",
  slug: "",
  contactName: "",
  email: "",
  phone: "",
  password: "",
  confirm: "",
  gstApplies: "",
  gstin: "",
};

const field = cx(inputClass, "h-11 text-[16px] sm:text-[15px]");

function Label({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px] font-medium">
      {children}
      {hint && <span className="text-[12px] font-normal text-muted">{hint}</span>}
    </label>
  );
}

type Sending = { phase: "creating" } | { phase: "uploading"; kind: string; fraction: number } | { phase: "done" };

/**
 * The institute self sign-up wizard: institute, account, GST, documents. Each "Continue"
 * asks the server to check the steps so far, so problems show on the step that has them.
 * "Start my free trial" makes the institute and signs the admin in; then the documents
 * go up one by one, and the admin lands on their documents page.
 */
export function InstituteSignup({
  checkStep,
  start,
  source,
}: {
  checkStep: (input: InstituteSignupInput, step: SignupStep) => Promise<CheckResult>;
  start: (input: InstituteSignupInput, consents: SignupConsents) => Promise<StartResult>;
  source: "signup" | "book-a-demo";
}) {
  const id = useId();
  const router = useRouter();
  const [v, setV] = useState<Values>(EMPTY);
  const [slugEdited, setSlugEdited] = useState(false);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string | null>>({});
  const [sending, setSending] = useState<Sending | null>(null);
  const [created, setCreated] = useState<{ slug: string } | null>(null);
  const [consents, setConsents] = useState<SignupConsents>({ account: false, service: false, marketing: false });
  const agreed = consents.account && consents.service;
  const [pending, startTransition] = useTransition();
  const top = useRef<HTMLDivElement>(null);

  const set = (k: keyof Values) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    setV((old) => {
      const next = { ...old, [k]: value };
      if (k === "name" && !slugEdited) next.slug = slugFrom(value);
      return next;
    });
  };

  const input = (): InstituteSignupInput => ({
    ...v,
    source,
    documents: Object.entries(files)
      .filter((e): e is [string, File] => !!e[1])
      .map(([kind, f]) => ({ kind, fileName: f.name, size: f.size, type: documentType(f.name, f.type) ?? f.type })),
  });

  const go = (to: number) => {
    setDir(to > step ? "forward" : "back");
    setStep(to);
    setError(null);
    top.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const showProblem = (p: { step: SignupStep | null; message: string }) => {
    const at = p.step ? STEPS.findIndex((s) => s.key === p.step) : step;
    if (at !== step) go(at);
    setError(p.message);
  };

  const next = () =>
    startTransition(async () => {
      const problem = await checkStep(input(), STEPS[step].key);
      if (problem) return showProblem(problem);
      go(step + 1);
    });

  const finish = () =>
    startTransition(async () => {
      if (Object.values(fileErrors).some(Boolean)) return setError("Fix or remove the files marked in red first.");
      let slug = created?.slug;
      if (!slug) {
        setSending({ phase: "creating" });
        if (!agreed) {
          setSending(null);
          return setError("Tick both boxes to agree to how Zinny uses your details. News is optional.");
        }
        const res = await start(input(), consents);
        if (!res.ok) {
          setSending(null);
          return showProblem(res);
        }
        slug = res.slug;
        setCreated({ slug });
      }
      const failed: string[] = [];
      for (const [kind, file] of Object.entries(files)) {
        if (!file) continue;
        setSending({ phase: "uploading", kind, fraction: 0 });
        try {
          await uploadDocument(slug, kind, file, (fraction) => setSending({ phase: "uploading", kind, fraction }));
          setFiles((f) => ({ ...f, [kind]: null }));
        } catch (e) {
          failed.push(kind);
          setFileErrors((fe) => ({ ...fe, [kind]: e instanceof Error ? e.message : "This file didn't upload. Try again." }));
        }
      }
      if (failed.length) {
        setSending(null);
        setError("Your institute is created and your trial has started, but some files didn't upload. Try them again, or upload them later from your admin.");
        return;
      }
      setSending({ phase: "done" });
      router.push(`/${slug}/admin/choose-plan/documents?welcome=1`);
    });

  const s = STEPS[step];
  const busy = pending || (sending !== null && sending.phase !== "done");
  const panOnFile = !!files.pan;

  return (
    <div ref={top} className="scroll-mt-6">
      <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Sign-up steps">
        {STEPS.map((st, i) => (
          <li key={st.key} aria-current={i === step ? "step" : undefined}>
            <div className={cx("h-1.5 rounded-full transition-colors duration-300", i < step ? "bg-brand" : i === step ? "bg-gold" : "bg-line")} />
            <span className={cx("mt-2 block truncate text-[12px] sm:text-[13px]", i === step ? "font-medium text-ink" : "text-muted")}>
              <span className="sr-only">Step {i + 1}: </span>
              {st.label}
            </span>
          </li>
        ))}
      </ol>

      <section className="rounded-[22px] bg-surface p-5 shadow-[0_24px_50px_-28px_rgb(6_58_47/0.45)] ring-1 ring-line sm:p-8">
        <div key={s.key} className={dir === "forward" ? "onb-step-forward" : "onb-step-back"}>
          <h2 className="text-[26px] leading-tight font-semibold sm:text-[30px]">{s.title}</h2>
          <p className="mt-1.5 text-[15px] text-muted">{s.lead}</p>

          {error && (
            <div role="alert" className="onb-pop mt-5">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}

          <div className="mt-6 space-y-4">
            {s.key === "institute" && (
              <>
                <div>
                  <Label htmlFor={`${id}-name`}>Institute name</Label>
                  <input id={`${id}-name`} value={v.name} onChange={set("name")} autoComplete="organization" placeholder="Sunrise Academy" className={field} />
                </div>
                <div>
                  <Label htmlFor={`${id}-legal`} hint="As on your PAN card">
                    Legal name
                  </Label>
                  <input id={`${id}-legal`} value={v.legalName} onChange={set("legalName")} placeholder="Sunrise Education Services LLP" className={field} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`${id}-type`}>Type of institute</Label>
                    <Select id={`${id}-type`} value={v.instituteType} onChange={set("instituteType")} className={field}>
                      <option value="">Pick one</option>
                      {INSTITUTE_TYPES.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`${id}-city`}>City</Label>
                    <input id={`${id}-city`} value={v.city} onChange={set("city")} autoComplete="address-level2" placeholder="Pune" className={field} />
                  </div>
                </div>
                <div>
                  <Label htmlFor={`${id}-state`} hint="Sets the GST state code">
                    State
                  </Label>
                  <Select id={`${id}-state`} value={v.stateCode} onChange={set("stateCode")} className={field}>
                    <option value="">Pick your state</option>
                    {GST_STATES.map((st) => (
                      <option key={st.code} value={st.code}>
                        {st.name} ({st.code})
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor={`${id}-address`}>Address</Label>
                  <Textarea id={`${id}-address`} value={v.address} onChange={set("address")} rows={3} autoComplete="street-address" placeholder="Building, street, area and PIN code" className="text-[16px] sm:text-[15px]" />
                </div>
                <div>
                  <Label htmlFor={`${id}-slug`} hint="Letters, digits and hyphens">
                    Web address
                  </Label>
                  <div className={cx(field, "flex items-center gap-0 px-0 focus-within:border-brand focus-within:ring-4 focus-within:ring-gold-soft")}>
                    <span className="pl-3 text-muted select-none">zinny.app/</span>
                    <input
                      id={`${id}-slug`}
                      value={v.slug}
                      onChange={(e) => {
                        setSlugEdited(true);
                        set("slug")({ target: { value: e.target.value.toLowerCase() } });
                      }}
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="sunrise-academy"
                      className="h-full min-w-0 flex-1 bg-transparent pr-3 outline-none"
                    />
                  </div>
                  <p className="mt-1.5 text-[12px] text-muted">Your students and staff sign in at this address.</p>
                </div>
              </>
            )}

            {s.key === "account" && (
              <>
                <div>
                  <Label htmlFor={`${id}-contact`}>Your name</Label>
                  <input id={`${id}-contact`} value={v.contactName} onChange={set("contactName")} autoComplete="name" className={field} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`${id}-email`}>Email</Label>
                    <input id={`${id}-email`} type="email" value={v.email} onChange={set("email")} autoComplete="email" inputMode="email" className={field} />
                  </div>
                  <div>
                    <Label htmlFor={`${id}-phone`}>Mobile number</Label>
                    <input id={`${id}-phone`} type="tel" value={v.phone} onChange={set("phone")} autoComplete="tel" inputMode="tel" placeholder="98200 11001" className={field} />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`${id}-password`}>Password</Label>
                    <input id={`${id}-password`} type="password" value={v.password} onChange={set("password")} autoComplete="new-password" className={field} />
                  </div>
                  <div>
                    <Label htmlFor={`${id}-confirm`}>Type the password again</Label>
                    <input id={`${id}-confirm`} type="password" value={v.confirm} onChange={set("confirm")} autoComplete="new-password" className={field} />
                  </div>
                </div>
                <p className="text-[12px] text-muted">At least 8 characters. A short sentence is easy to remember and hard to guess.</p>
              </>
            )}

            {s.key === "gst" && (
              <fieldset>
                <legend className="mb-3 text-[15px] font-medium">When you sell a course, does GST apply to your institute?</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { value: "yes", title: "Yes", body: "We're registered for GST. Add GST to our students' invoices." },
                    { value: "no", title: "No", body: "GST doesn't apply to us. Invoices go out without GST." },
                  ].map((o) => (
                    <label
                      key={o.value}
                      className={cx(
                        "flex cursor-pointer gap-3 rounded-2xl border p-4 transition-[border-color,background-color] duration-150",
                        v.gstApplies === o.value ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-brand/50",
                      )}
                    >
                      <input type="radio" name={`${id}-gst`} value={o.value} checked={v.gstApplies === o.value} onChange={set("gstApplies")} className="mt-1 accent-[var(--color-brand)]" />
                      <span>
                        <span className="block text-[15px] font-medium">{o.title}</span>
                        <span className="mt-0.5 block text-[13px] text-muted">{o.body}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <Grow open={v.gstApplies === "yes"}>
                  <div className="pt-4">
                    <Label htmlFor={`${id}-gstin`} hint="15 characters">
                      GSTIN
                    </Label>
                    <input
                      id={`${id}-gstin`}
                      value={v.gstin}
                      onChange={(e) => set("gstin")({ target: { value: e.target.value.toUpperCase() } })}
                      autoCapitalize="characters"
                      spellCheck={false}
                      placeholder={`${v.stateCode || "27"}ABCDE1234F1Z5`}
                      className={cx(field, "tabular tracking-wide")}
                    />
                  </div>
                </Grow>
                <p className="mt-4 text-[12px] text-muted">You can change this later in your admin settings.</p>
              </fieldset>
            )}

            {s.key === "documents" && (
              <div className="space-y-5">
                {DOCUMENT_KINDS.map((d) => (
                  <FileDrop
                    key={d.key}
                    label={d.label}
                    hint={d.hint}
                    required={d.required}
                    file={files[d.key] ?? null}
                    error={fileErrors[d.key]}
                    progress={sending?.phase === "uploading" && sending.kind === d.key ? sending.fraction : null}
                    onChange={(file, problem) => {
                      setFiles((f) => ({ ...f, [d.key]: file }));
                      setFileErrors((fe) => ({ ...fe, [d.key]: problem }));
                      setError(null);
                    }}
                  />
                ))}
                {!created && (
                  <fieldset className="space-y-2.5 border-t border-line pt-5">
                    <legend className="mb-2 text-[15px] font-medium">Your consent</legend>
                    {(
                      [
                        { key: "account", text: "Zinny may use my name, email and mobile number to create and run my admin account.", hint: "Needed" },
                        { key: "service", text: "Zinny may process my institute's details and documents to set up the trial, check them, and bill us.", hint: "Needed" },
                        { key: "marketing", text: "Send me product news and offers by email.", hint: "Optional" },
                      ] as const
                    ).map((c) => (
                      <label key={c.key} className="flex gap-3 rounded-2xl border border-line bg-surface p-3.5 text-[14px] leading-relaxed">
                        <input
                          type="checkbox"
                          checked={consents[c.key]}
                          onChange={(e) => setConsents((old) => ({ ...old, [c.key]: e.target.checked }))}
                          className="mt-1 size-4 shrink-0 accent-[var(--color-brand)]"
                        />
                        <span className="min-w-0 flex-1">
                          {c.text} <span className="text-[12px] text-muted">{c.hint}</span>
                        </span>
                      </label>
                    ))}
                    <p className="text-[12px] text-muted">
                      Read the{" "}
                      <a href="/privacy" target="_blank" rel="noreferrer" className="text-brand underline underline-offset-2">
                        privacy notice
                      </a>
                      . You can withdraw consent to news any time from your privacy settings.
                    </p>
                  </fieldset>
                )}
              </div>
            )}
          </div>
        </div>

        {created && (
          <div className="onb-pop mt-6">
            <Notice>
              Your institute is created and you&apos;re signed in.{" "}
              <a href={`/${created.slug}/admin/choose-plan/documents`} className="font-medium underline underline-offset-4">
                Go to your documents
              </a>{" "}
              to upload the rest later.
            </Notice>
          </div>
        )}

        <div className="mt-8 flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          {step > 0 && !created ? (
            <button type="button" onClick={() => go(step - 1)} disabled={busy} className={buttonClass("ghost")}>
              <ActionIcon name="back" />
              Back
            </button>
          ) : (
            <span />
          )}
          {s.key !== "documents" ? (
            <button type="button" onClick={next} disabled={busy} className={cx(buttonClass("primary"), "h-11 px-7 text-[15px]")}>
              {pending ? <Spinner /> : <ActionIcon name="forward" />}
              {pending ? "Checking…" : "Continue"}
            </button>
          ) : (
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <button type="button" onClick={finish} disabled={busy || (!panOnFile && !created) || (!agreed && !created)} className={cx(buttonClass("primary"), "h-11 px-7 text-[15px]")}>
                {busy ? <Spinner /> : <ActionIcon name="forward" />}
                {sending?.phase === "creating"
                  ? "Creating your institute…"
                  : sending?.phase === "uploading"
                    ? "Uploading documents…"
                    : sending?.phase === "done"
                      ? "Opening your admin…"
                      : created
                        ? "Upload the documents again"
                        : `Start my free ${TRIAL_DAYS}-day trial`}
              </button>
              {!panOnFile && !created && <span className="text-right text-[12px] text-muted">Add your PAN card to continue.</span>}
              {panOnFile && !agreed && !created && <span className="text-right text-[12px] text-muted">Tick both consent boxes to continue.</span>}
            </div>
          )}
        </div>
      </section>

      {s.key === "documents" && (
        <p className="mt-5 flex items-start gap-2 px-1 text-[13px] text-muted">
          <Badge tone="brand">Free</Badge>
          <span>
            Your trial starts the moment you finish and lasts {TRIAL_DAYS} days. The Zinny team checks your documents in the meantime. No card needed; choose a plan whenever you&apos;re ready.
          </span>
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return <span aria-hidden className="size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />;
}
