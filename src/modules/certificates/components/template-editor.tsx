"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/forms";
import { Field, Input, cx, inputClass } from "@/components/ui";
import { previewTemplateAction, updateTemplateAction } from "../actions";

type Signatory = { name: string; title: string; imageKey: string | null };
type Draft = { name: string; design: string; heading: string; intro: string; body: string; signatories: Signatory[] };

const pad = (s: Signatory[]): Signatory[] => [0, 1].map((i) => s[i] ?? { name: "", title: "", imageKey: null });

/**
 * Edits a template with a live preview: every change is redrawn by the same renderer that
 * makes the PDFs (debounced), so what you see is what gets printed.
 */
export function TemplateEditor({
  uni,
  templateId,
  canManage,
  initial,
  initialSvg,
  designs,
}: {
  uni: string;
  templateId: string;
  canManage: boolean;
  initial: Draft;
  initialSvg: string;
  designs: { key: string; label: string; description: string }[];
}) {
  const [draft, setDraft] = useState<Draft>({ ...initial, signatories: pad(initial.signatories) });
  const [sample, setSample] = useState({ name: "", course: "" });
  const [svg, setSvg] = useState(initialSvg);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [state, formAction] = useActionState(updateTemplateAction, null);
  const first = useRef(true);
  const seq = useRef(0);

  // Signature uploads happen outside this form; pick up their new image keys.
  const savedKeys = initial.signatories.map((s) => s.imageKey ?? "").join("|");
  useEffect(() => {
    setDraft((d) => {
      const signatories = d.signatories.map((s, i) => ({ ...s, imageKey: initial.signatories[i]?.imageKey ?? null }));
      // Same keys: keep the same object, so nothing is redrawn.
      return signatories.every((s, i) => s.imageKey === d.signatories[i].imageKey) ? d : { ...d, signatories };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKeys]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const n = ++seq.current;
    setDrawing(true);
    const t = setTimeout(async () => {
      const r = await previewTemplateAction(uni, templateId, { ...draft, sampleName: sample.name, sampleCourse: sample.course }).catch(() => ({
        error: "The preview couldn't be drawn. Check your connection and keep editing.",
      }));
      if (n !== seq.current) return;
      setDrawing(false);
      if ("svg" in r && r.svg) {
        setSvg(r.svg);
        setPreviewError(null);
      } else setPreviewError(r.error ?? null);
    }, 300);
    return () => clearTimeout(t);
  }, [draft, sample, uni, templateId]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setSig = (i: number, patch: Partial<Signatory>) =>
    setDraft((d) => ({ ...d, signatories: d.signatories.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
      <form action={formAction} className="space-y-5 rounded-[22px] border border-line bg-surface p-6">
        <input type="hidden" name="uni" value={uni} />
        <input type="hidden" name="templateId" value={templateId} />
        <fieldset disabled={!canManage} className="space-y-5">
          <Field label="Template name" hint="Only staff see this, when picking a template for a course.">
            <Input name="name" value={draft.name} onChange={(e) => set({ name: e.target.value })} required maxLength={60} />
          </Field>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium">Design</span>
            <div className="grid gap-2" role="radiogroup" aria-label="Design">
              {designs.map((d) => (
                <label
                  key={d.key}
                  className={cx(
                    "flex cursor-pointer gap-3 rounded-2xl border px-3 py-2.5 text-[14px] transition-colors",
                    draft.design === d.key ? "border-brand bg-brand-soft" : "border-line hover:border-brand/40",
                  )}
                >
                  <input type="radio" name="design" value={d.key} checked={draft.design === d.key} onChange={() => set({ design: d.key })} className="mt-1 accent-brand" />
                  <span>
                    <span className="font-medium">{d.label}</span>
                    <span className="block text-[12px] text-muted">{d.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <Field label="Heading">
            <Input name="heading" value={draft.heading} onChange={(e) => set({ heading: e.target.value })} required maxLength={60} />
          </Field>
          <Field label="Line before the name">
            <Input name="intro" value={draft.intro} onChange={(e) => set({ intro: e.target.value })} required maxLength={80} />
          </Field>
          <Field label="Line before the course">
            <Input name="body" value={draft.body} onChange={(e) => set({ body: e.target.value })} required maxLength={100} />
          </Field>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium">Signatories</span>
            <div className="space-y-3">
              {draft.signatories.map((s, i) => (
                <div key={i} className="rounded-2xl border border-line p-3">
                  <div className="mb-2 flex items-center justify-between text-[12px] text-muted">
                    <span>{i === 0 ? "First signatory" : "Second signatory (optional)"}</span>
                    {s.imageKey ? <span className="text-brand">Signature on file</span> : s.name ? <span>No signature yet</span> : null}
                  </div>
                  <div className="grid gap-2">
                    <input
                      aria-label={`Signatory ${i + 1} name`}
                      className={inputClass}
                      name={`sig${i}_name`}
                      value={s.name}
                      onChange={(e) => setSig(i, { name: e.target.value })}
                      placeholder="Name, like Dr. Asha Rao"
                      maxLength={60}
                    />
                    <input
                      aria-label={`Signatory ${i + 1} title`}
                      className={inputClass}
                      name={`sig${i}_title`}
                      value={s.title}
                      onChange={(e) => setSig(i, { title: e.target.value })}
                      placeholder="Title, like Director"
                      maxLength={60}
                    />
                    <input type="hidden" name={`sig${i}_imageKey`} value={s.imageKey ?? ""} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-muted">Save, then upload each signature image below. Clear a name to remove that signatory.</p>
          </div>
        </fieldset>

        {canManage && (
          <div className="border-t border-line pt-4">
            <SubmitButton>Save template</SubmitButton>
            {state?.error && <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
            {state?.ok && <p className="mt-3 rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-strong">{state.ok}</p>}
          </div>
        )}
      </form>

      <div className="space-y-3 xl:sticky xl:top-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[17px] font-medium">Preview</h2>
          <span className="text-[13px] text-muted" aria-live="polite">
            {drawing ? "Updating…" : "Sample data, A4 landscape"}
          </span>
        </div>
        <div
          className={cx(
            "overflow-hidden rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgb(20_38_31/0.06),0_8px_24px_-12px_rgb(20_38_31/0.18)] transition-opacity",
            drawing && "opacity-80",
          )}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {previewError && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{previewError}</p>}
        <div className="grid gap-3 rounded-[22px] border border-dashed border-line p-4 sm:grid-cols-2">
          <Field label="Try a student name" hint="Not saved. Check long names fit.">
            <Input value={sample.name} onChange={(e) => setSample((x) => ({ ...x, name: e.target.value }))} placeholder="Aarav Sharma" maxLength={120} />
          </Field>
          <Field label="Try a course title" hint="Not saved.">
            <Input value={sample.course} onChange={(e) => setSample((x) => ({ ...x, course: e.target.value }))} placeholder="Data Analytics" maxLength={200} />
          </Field>
        </div>
      </div>
    </div>
  );
}
