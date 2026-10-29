import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { canManageSite, isTeachingStaff } from "@/modules/website-builder/access";
import { saveProfileAction } from "@/modules/website-builder/actions";
import { sitePalette } from "@/modules/website-builder/branding";
import { NoAccess, ProfileTabs } from "@/modules/website-builder/components/admin";
import { ColorField } from "@/modules/website-builder/components/color-field";
import { ImageField } from "@/modules/website-builder/components/image-field";
import { listFacultyProfiles } from "@/modules/website-builder/faculty";
import { mediaPath } from "@/modules/website-builder/media";
import { getProfile, SOCIAL_NETWORKS } from "@/modules/website-builder/profile";
import { redirect } from "next/navigation";

export const metadata = { title: "Manage profile" };

export default async function InstituteProfilePage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  if (!canManageSite(actor)) {
    if (isTeachingStaff(actor)) redirect(`/${uni}/admin/website/profile/me`);
    return (
      <>
        <PageHeader title="Manage profile" />
        <NoAccess uni={uni} />
      </>
    );
  }
  const [{ profile, university }, faculty] = await Promise.all([getProfile(actor), listFacultyProfiles(actor, "pending")]);
  const brand = sitePalette(null, university.branding.primaryColor).primary;
  const image = (id: string | null) => (id ? { id, src: mediaPath(uni, id) } : null);

  return (
    <>
      <PageHeader
        title="Manage profile"
        subtitle="Who you are and how to reach you. Saved changes appear on your public website straight away."
        actions={
          <a href={`/site/${uni}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:border-brand/40">
            View website
          </a>
        }
      />
      <ProfileTabs uni={uni} actor={actor} active="institute" pendingProfiles={faculty.counts.pending} />

      <ActionForm action={saveProfileAction} resetOnSuccess={false}>
        <input type="hidden" name="uni" value={uni} />
        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <Card>
              <CardTitle hint={`Name: ${university.name}`}>About the institute</CardTitle>
              <div className="space-y-4">
                <Field label="Tagline" hint="One line under your name, like “Practical degrees in Navi Mumbai since 1998”.">
                  <Input name="tagline" defaultValue={profile.tagline} maxLength={160} />
                </Field>
                <Field label="About" hint="A few paragraphs about your history, what you teach and what makes you different. Leave a blank line between paragraphs.">
                  <Textarea name="about" defaultValue={profile.about} rows={9} maxLength={6000} className="text-[14px]" />
                </Field>
                <Field label="Founded in" hint="Optional. Four digits.">
                  <Input name="foundedYear" defaultValue={profile.foundedYear ?? ""} inputMode="numeric" maxLength={4} className="w-32" />
                </Field>
              </div>
            </Card>

            <Card>
              <CardTitle>Contact details</CardTitle>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Field label="Address">
                    <Textarea name="address" defaultValue={profile.address} rows={3} maxLength={400} className="text-[14px]" />
                  </Field>
                </div>
                <Field label="City">
                  <Input name="city" defaultValue={profile.city} maxLength={80} />
                </Field>
                <Field label="Map link" hint="Paste the share link from Google Maps.">
                  <Input name="mapUrl" defaultValue={profile.mapUrl} placeholder="https://maps.app.goo.gl/…" />
                </Field>
                <Field label="Phone">
                  <Input name="phone" defaultValue={profile.phone} inputMode="tel" placeholder="+91 22 4000 1234" />
                </Field>
                <Field label="WhatsApp" hint="Optional.">
                  <Input name="whatsapp" defaultValue={profile.whatsapp} inputMode="tel" placeholder="+91 98765 43210" />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Email for enquiries">
                    <Input name="email" type="email" defaultValue={profile.email} placeholder="admissions@demo.edu" />
                  </Field>
                </div>
              </div>
            </Card>

            <Card>
              <CardTitle hint="Leave empty to hide">Social links</CardTitle>
              <div className="grid gap-4 md:grid-cols-2">
                {SOCIAL_NETWORKS.map((n) => (
                  <Field key={n.key} label={n.label}>
                    <Input name={`social_${n.key}`} defaultValue={profile.social[n.key] ?? ""} placeholder={n.placeholder} />
                  </Field>
                ))}
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardTitle>Logo and cover</CardTitle>
              <div className="space-y-6">
                <ImageField
                  key={`logo-${profile.logoMediaId ?? "none"}`}
                  uni={uni}
                  kind="logo"
                  name="logoMediaId"
                  label="Logo"
                  shape="logo"
                  hint="A square PNG with a transparent background works best."
                  initial={image(profile.logoMediaId)}
                />
                <ImageField
                  key={`cover-${profile.coverMediaId ?? "none"}`}
                  uni={uni}
                  kind="cover"
                  name="coverMediaId"
                  label="Cover image"
                  hint="A wide photo of your campus or classes, at least 1600 pixels across."
                  initial={image(profile.coverMediaId)}
                />
              </div>
            </Card>
            <Card>
              <CardTitle>Colour</CardTitle>
              <ColorField initial={profile.primaryColor} brandColor={brand} />
            </Card>
            <Card className="bg-canvas">
              <p className="text-[14px] text-muted">
                Your website lives at{" "}
                <a href={`/site/${uni}`} target="_blank" rel="noreferrer" className="font-medium text-brand underline underline-offset-2">
                  /site/{uni}
                </a>
                . Arrange its sections in the{" "}
                <Link href={`/${uni}/admin/website/profile/builder`} className="font-medium text-brand underline underline-offset-2">
                  website builder
                </Link>
                .
              </p>
            </Card>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <SubmitButton>Save profile</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
