import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Field, Input, Notice, PageHeader, Tabs } from "@/components/ui";
import { can } from "@/server/core";
import { spaceContext } from "@/server/context";
import { saveDeliverySettingsAction } from "@/modules/notifications-delivery/actions";
import { DeliveryLog } from "@/modules/notifications-delivery/components/delivery-log";
import { KindEditor } from "@/modules/notifications-delivery/components/kind-editor";
import { KindsTable } from "@/modules/notifications-delivery/components/kinds-table";
import { PreferencesForm } from "@/modules/notifications-delivery/components/preferences-form";
import { CHANNEL_LABEL, CHANNELS, KIND_PATTERN } from "@/modules/notifications-delivery/kinds";
import type { Channel, DeliveryStatus } from "@/modules/notifications-delivery/schema";
import { failedCount, getInstituteSettings, getKindEditor, getPreferences, listDeliveries } from "@/modules/notifications-delivery/service";
import { safeTimezone } from "@/modules/notifications-delivery/time";

export const metadata = { title: "Notification settings" };

type Search = { tab?: string; kind?: string; status?: string; channel?: string; notice?: string };
const STATUSES: DeliveryStatus[] = ["queued", "sending", "sent", "failed", "skipped"];

export default async function NotificationSettingsPage({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<Search> }) {
  const { uni } = await params;
  const search = await searchParams;
  const { actor, university } = await spaceContext(uni);
  const base = `/${uni}/admin/settings/notifications`;
  const manage = can(actor, "settings.manage", { universityId: university.id });
  const own = can(actor, "self.profile", { universityId: university.id, ownerUserId: actor.userId });
  if (!manage && !own) notFound();

  const tab = manage ? (["kinds", "log", "setup", "mine"].includes(search.tab ?? "") ? search.tab! : "kinds") : "mine";
  const failed = manage ? await failedCount(actor) : 0;
  const tabs = [
    ...(manage
      ? [
          { key: "kinds", label: "Notifications", href: base },
          { key: "log", label: "Delivery log", href: `${base}?tab=log`, ...(failed > 0 && { count: failed }) },
          { key: "setup", label: "Setup", href: `${base}?tab=setup` },
        ]
      : []),
    ...(own ? [{ key: "mine", label: "My notifications", href: `${base}?tab=mine` }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={
          manage
            ? "What reaches people by email, SMS and WhatsApp, and what each message says. People choose within what you allow."
            : "Choose how you hear about things at your institute."
        }
      />
      {tabs.length > 1 && <Tabs tabs={tabs} active={tab} />}
      {tab === "kinds" && <KindsTab uni={uni} kind={search.kind} base={base} />}
      {tab === "log" && search.notice === "requeued" && (
        <div className="mb-5">
          <Notice>Queued again. It goes out within a minute.</Notice>
        </div>
      )}
      {tab === "log" && <LogTab uni={uni} base={base} timezone={safeTimezone(university.timezone)} status={search.status} channel={search.channel} />}
      {tab === "setup" && <SetupTab uni={uni} />}
      {tab === "mine" && <MineTab uni={uni} />}
    </>
  );
}

async function KindsTab({ uni, kind, base }: { uni: string; kind?: string; base: string }) {
  const { actor } = await spaceContext(uni);
  const settings = await getInstituteSettings(actor);
  if (kind && KIND_PATTERN.test(kind)) {
    const editor = await getKindEditor(actor, kind);
    return <KindEditor uni={uni} editor={editor} providers={settings.providers} backHref={base} />;
  }
  return (
    <div className="space-y-5">
      <Notice tone="neutral">
        <span className="font-medium">On</span> sends unless the person turns it off. <span className="font-medium">Optional</span> sends only to people who turn
        it on. <span className="font-medium">Off</span> never sends. Texts wait until 8 am when they&apos;re due between 9 pm and 8 am.
      </Notice>
      <KindsTable kinds={settings.kinds} hrefFor={(k) => `${base}?kind=${encodeURIComponent(k)}`} />
    </div>
  );
}

async function LogTab({ uni, base, timezone, status, channel }: { uni: string; base: string; timezone: string; status?: string; channel?: string }) {
  const { actor } = await spaceContext(uni);
  const s = STATUSES.includes(status as DeliveryStatus) ? (status as DeliveryStatus) : "";
  const c = CHANNELS.includes(channel as Channel) ? (channel as Channel) : "";
  const log = await listDeliveries(actor, { status: s, channel: c, limit: 200 });
  return <DeliveryLog uni={uni} rows={log.rows} stats={log.stats} timezone={timezone} filter={{ status: s, channel: c }} baseHref={base} />;
}

async function SetupTab({ uni }: { uni: string }) {
  const { actor } = await spaceContext(uni);
  const settings = await getInstituteSettings(actor);
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <Card>
        <CardTitle>Providers</CardTitle>
        <ul className="divide-y divide-line">
          {CHANNELS.map((c) => {
            const p = settings.providers[c];
            return (
              <li key={c} className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0">
                <div>
                  <div className="font-medium">{CHANNEL_LABEL[c]}</div>
                  <div className="text-[13px] text-muted">{p.note}</div>
                </div>
                <span className={p.live ? "text-[13px] font-medium text-brand" : "text-[13px] text-muted"}>{p.provider}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
          Zinny&apos;s team connects the providers for the whole platform. Emails come from Zinny&apos;s sending address with your institute&apos;s name, logo and
          colour. SMS in India needs a DLT-registered template for each notification: add its MSG91 template id on that notification&apos;s page.
        </p>
      </Card>
      <Card className="h-fit">
        <CardTitle>Replies</CardTitle>
        <ActionForm action={saveDeliverySettingsAction} resetOnSuccess={false} className="space-y-4">
          <input type="hidden" name="uni" value={uni} />
          <Field label="Reply-to address" hint="When someone replies to a notification email, it goes here. Leave empty for no reply-to.">
            <Input name="replyTo" type="email" defaultValue={settings.replyTo ?? ""} placeholder="office@youruniversity.edu" />
          </Field>
          <SubmitButton>Save reply-to address</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}

async function MineTab({ uni }: { uni: string }) {
  const { actor } = await spaceContext(uni);
  const prefs = await getPreferences(actor, actor.userId);
  return (
    <div className="max-w-3xl">
      <h2 className="mb-1 text-[18px] font-medium">My notifications</h2>
      <p className="mb-5 text-[14px] text-muted">How you hear about things that need you. This only changes what you get.</p>
      <PreferencesForm uni={uni} rows={prefs.rows} email={prefs.email} phone={prefs.phone} profileHref={`/${uni}/profile`} />
    </div>
  );
}
