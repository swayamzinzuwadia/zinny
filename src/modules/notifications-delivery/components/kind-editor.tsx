import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { resetKindAction, saveKindAction, testSendAction } from "../actions";
import { CHANNEL_LABEL, CHANNELS, STATE_LABEL, TEMPLATE_VARIABLES, VARIABLE_HELP } from "../kinds";
import type { ProviderStatus } from "../providers";
import type { KindEditor as Editor } from "../service";
import { ValueButton } from "./submit";

const STATE_HINT = {
  off: "Never sent.",
  optional: "Off unless the person turns it on.",
  on: "On unless the person turns it off.",
} as const;

/** Editing one kind: channels, template text, provider template ids, a preview and test sends. */
export function KindEditor({ uni, editor, providers, backHref }: { uni: string; editor: Editor; providers: ProviderStatus; backHref: string }) {
  const security = editor.security;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={backHref} className="text-[13px] text-muted hover:text-ink">
            All notifications
          </Link>
          <h2 className="mt-1 text-[22px] font-semibold">{editor.label}</h2>
          <p className="mt-1 max-w-2xl text-[14px] text-muted">{editor.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>{editor.kind}</Badge>
          {security && <Badge tone="brand">Always sent</Badge>}
          {!editor.core && !security && <Badge>From another module</Badge>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <Card>
          <ActionForm action={saveKindAction} resetOnSuccess={false} className="space-y-6">
            <input type="hidden" name="uni" value={uni} />
            <input type="hidden" name="kind" value={editor.kind} />

            {security ? (
              <Notice tone="neutral">
                Security messages go out on every channel the sender uses, at any hour, and can&apos;t be turned off or unsubscribed from. Their text is written by
                the sender and never stored. Here you only set the template ids your SMS provider needs.
              </Notice>
            ) : (
              <section>
                <h3 className="mb-1 text-[15px] font-medium">Channels</h3>
                <p className="mb-3 text-[13px] text-muted">In-app notifications always appear. Choose what else goes out, and whether people can change it.</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {CHANNELS.map((c) => (
                    <Field key={c} label={CHANNEL_LABEL[c]} hint={STATE_HINT[editor.channels[c]]}>
                      <Select name={`channel_${c}`} defaultValue={editor.channels[c]}>
                        {(["on", "optional", "off"] as const).map((s) => (
                          <option key={s} value={s}>
                            {STATE_LABEL[s]}
                            {s === editor.defaults.channels[c] ? " (default)" : ""}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ))}
                </div>
              </section>
            )}

            {!security && (
              <section className="space-y-4">
                <div>
                  <h3 className="mb-1 text-[15px] font-medium">Email</h3>
                  <p className="text-[13px] text-muted">
                    Sent in your institute&apos;s branded layout, with a button to the right page and an unsubscribe link.
                  </p>
                </div>
                <Field label="Subject">
                  <Input name="emailSubject" defaultValue={editor.template.emailSubject} maxLength={200} required />
                </Field>
                <Field label="Text" hint="A blank line starts a new paragraph.">
                  <Textarea name="emailBody" defaultValue={editor.template.emailBody} rows={7} maxLength={5000} required />
                </Field>
              </section>
            )}

            <section className="space-y-4">
              <div>
                <h3 className="mb-1 text-[15px] font-medium">SMS and WhatsApp</h3>
                <p className="text-[13px] text-muted">
                  In India, texts must match a DLT-registered template. Register the text below with your SMS provider, then paste the MSG91 template id here.
                </p>
              </div>
              {!security && (
                <Field label="Text message" hint="Keep it under 160 characters to send as one SMS.">
                  <Textarea name="smsText" defaultValue={editor.template.smsText} rows={3} maxLength={480} required />
                </Field>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="MSG91 template id" hint={editor.smsTemplateId ? undefined : "Empty uses the platform's template for this kind, if there is one."}>
                  <Input name="smsTemplateId" defaultValue={editor.smsTemplateId ?? ""} placeholder="6650a1b2c3d4e5f6a7b8c9d0" maxLength={100} />
                </Field>
                {!security && (
                  <Field label="WhatsApp template name" hint="The approved template's name in MSG91.">
                    <Input name="whatsappTemplate" defaultValue={editor.whatsappTemplate ?? ""} placeholder="timetable_update" maxLength={100} />
                  </Field>
                )}
              </div>
            </section>

            {!security && (
              <details className="rounded-2xl border border-line px-4 py-3 text-[13px]">
                <summary className="cursor-pointer font-medium">Variables you can use</summary>
                <dl className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr]">
                  {TEMPLATE_VARIABLES.map((v) => (
                    <div key={v} className="contents">
                      <dt className="font-mono text-[12.5px] text-brand-strong">{`{{${v}}}`}</dt>
                      <dd className="text-muted">{VARIABLE_HELP[v]}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-muted">
                  WhatsApp templates get four values in order: first name, headline, institute name and link. In SMS templates, use the names name, firstName,
                  title, body, university, link or text as DLT variables.
                </p>
              </details>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton>Save changes</SubmitButton>
              {editor.updatedAt && <span className="text-[12.5px] text-muted">Last changed {editor.updatedAt.toISOString().slice(0, 10)}</span>}
            </div>
          </ActionForm>
          {!security && editor.saved && (
            <ActionForm action={resetKindAction} confirm="Put back the default channels and text for this notification?" className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="kind" value={editor.kind} />
              <SubmitButton variant="ghost" size="sm" pendingText="Restoring…">
                Restore defaults
              </SubmitButton>
            </ActionForm>
          )}
        </Card>

        <div className="space-y-6">
          {!security && (
            <Card className="p-0">
              <div className="flex items-baseline justify-between gap-3 px-6 pb-3 pt-5">
                <h3 className="text-[15px] font-medium">Preview</h3>
                <span className="text-[12.5px] text-muted">Saved version, with sample details</span>
              </div>
              <div className="border-y border-line px-6 py-2.5 text-[13px]">
                <span className="text-muted">Subject: </span>
                <span className="font-medium">{editor.preview.subject}</span>
              </div>
              <iframe
                title={`Email preview: ${editor.label}`}
                srcDoc={editor.preview.html}
                sandbox=""
                className="block h-[520px] w-full rounded-b-[22px] bg-canvas"
              />
            </Card>
          )}
          {!security && (
            <Card>
              <CardTitle hint="As a text">SMS and WhatsApp</CardTitle>
              <p className="rounded-2xl bg-canvas px-4 py-3 text-[13.5px] leading-relaxed">{editor.preview.sms}</p>
              <p className="mt-2 text-[12px] text-muted">{editor.preview.sms.length} characters</p>
            </Card>
          )}
          {!security && (
            <Card>
              <CardTitle>Send a test</CardTitle>
              <p className="mb-4 text-[13px] text-muted">Sends the saved version to you now, with sample details. Tests ignore quiet hours.</p>
              <ActionForm action={testSendAction} resetOnSuccess={false}>
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="kind" value={editor.kind} />
                <div className="flex flex-wrap gap-2">
                  {CHANNELS.map((c) => (
                    <ValueButton key={c} name="channel" value={c} pendingText="Sending…">
                      {`Send test ${c === "email" ? "email" : CHANNEL_LABEL[c]}`}
                    </ValueButton>
                  ))}
                </div>
              </ActionForm>
              <ul className="mt-4 space-y-1 text-[12.5px] text-muted">
                {CHANNELS.map((c) => (
                  <li key={c}>
                    {CHANNEL_LABEL[c]}: {providers[c].provider}
                    {!providers[c].live && " (printed to the server log)"}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
