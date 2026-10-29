import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, cx, Empty } from "@/components/ui";
import { savePreferencesAction } from "../actions";
import { CHANNEL_LABEL } from "../kinds";
import type { PreferenceRow } from "../service";

/** A checkbox drawn as a switch. Works without JavaScript; the form saves all of them at once. */
function Switch({ name, value, checked, disabled, label, note }: { name: string; value: string; checked: boolean; disabled: boolean; label: string; note?: string }) {
  return (
    <label
      title={note}
      className={cx("flex min-w-0 flex-1 flex-col items-center gap-1.5 sm:flex-row sm:justify-end", disabled ? "cursor-not-allowed" : "cursor-pointer")}
    >
      <span className={cx("whitespace-nowrap text-[12.5px]", disabled ? "text-faint" : "text-muted")}>{label}</span>
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={checked}
        disabled={disabled}
        className="peer sr-only"
        aria-label={note ? `${label}: ${note}` : label}
      />
      <span
        aria-hidden
        className={cx(
          "relative inline-block h-6 w-10 shrink-0 rounded-full bg-line transition-colors",
          "after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-surface after:shadow-sm after:transition-transform",
          "peer-checked:bg-brand peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold",
          "peer-disabled:opacity-45",
        )}
      />
    </label>
  );
}

export function PreferencesForm({
  uni,
  rows,
  email,
  phone,
  profileHref,
}: {
  uni: string;
  rows: PreferenceRow[];
  email: string | null;
  phone: string | null;
  profileHref: string;
}) {
  if (rows.length === 0) return <Empty title="Nothing to set up yet">You&apos;ll see your notifications here once there&apos;s something to tell you about.</Empty>;
  return (
    <ActionForm action={savePreferencesAction} resetOnSuccess={false} className="space-y-4">
      <input type="hidden" name="uni" value={uni} />
      <div className="rounded-2xl bg-brand-soft px-4 py-3 text-[13.5px] leading-relaxed text-brand-strong">
        Emails go to <span className="font-medium">{email}</span>.{" "}
        {phone ? (
          <>
            Texts go to <span className="font-medium tabular">{phone}</span>.
          </>
        ) : (
          <>
            Add a mobile number in{" "}
            <Link href={profileHref} className="font-medium underline underline-offset-2">
              your profile
            </Link>{" "}
            to get texts.
          </>
        )}
      </div>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.kind}>
            <Card className="p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[15px] font-medium">{r.label}</div>
                  <div className="text-[13px] leading-snug text-muted">{r.description}</div>
                </div>
                <div className="flex gap-2 sm:w-[330px] sm:shrink-0 sm:gap-4">
                  {r.channels.map((c) => {
                    const id = `${r.kind}:${c.channel}`;
                    return (
                      <div key={c.channel} className="flex flex-1">
                        {c.editable && <input type="hidden" name="shown" value={id} />}
                        <Switch
                          name="on"
                          value={id}
                          checked={c.enabled}
                          disabled={!c.editable}
                          label={CHANNEL_LABEL[c.channel]}
                          note={c.editable ? undefined : "turned off by your institute"}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <p className="text-[12.5px] leading-relaxed text-muted">
        Faded switches are turned off by your institute. Texts aren&apos;t sent between 9 pm and 8 am; they arrive in the morning. Sign-in codes and password
        reset messages are always sent.
      </p>
      <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
    </ActionForm>
  );
}
