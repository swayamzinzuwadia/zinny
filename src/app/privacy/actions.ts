"use server";
/**
 * A person's own privacy actions, for both privacy pages: `/[uni]/profile/privacy` (uni set:
 * the institute's records) and `/privacy/my` (uni empty: Zinny's own records, for marketplace
 * learners and anyone else). They only call the privacy services.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { appUrl } from "@/server/auth/config";
import { clientInfo, currentUserId } from "@/server/auth/session";
import { spaceContext } from "@/server/context";
import { loadActor } from "@/server/core";
import { ValidationError } from "@/server/errors";
import { grantConsent, withdrawConsent } from "@/modules/privacy/services/consents";
import { confirmGuardianConsent, declareAge, resendGuardianLink } from "@/modules/privacy/services/children";
import { fileRequest } from "@/modules/privacy/services/requests";
import type { Purpose, RequestKind } from "@/modules/privacy/lib/rules";

async function me(uni: string) {
  if (uni) return (await spaceContext(uni)).actor;
  const userId = await currentUserId();
  if (!userId) redirect("/login?next=/privacy/my");
  return loadActor(userId, null);
}

const pathOf = (uni: string) => (uni ? `/${uni}/profile/privacy` : "/privacy/my");

export async function grantConsentAction(uni: string, _: ActionState, data: FormData): Promise<ActionState> {
  return attempt(async () => {
    const actor = await me(uni);
    const purpose = str(data, "purpose") as Purpose;
    await grantConsent(actor, purpose, { ip: (await clientInfo()).ip, zinnyWide: str(data, "zinny") === "1" });
    revalidatePath(pathOf(uni));
    return "Switched on. You can switch it off here any time.";
  });
}

export async function withdrawConsentAction(uni: string, _: ActionState, data: FormData): Promise<ActionState> {
  return attempt(async () => {
    const actor = await me(uni);
    await withdrawConsent(actor, str(data, "consentId"));
    revalidatePath(pathOf(uni));
    return "Withdrawn. We've stopped using your data for this from now on.";
  });
}

export async function fileRequestAction(uni: string, _: ActionState, data: FormData): Promise<ActionState> {
  return attempt(async () => {
    const actor = await me(uni);
    const kind = str(data, "kind") as RequestKind;
    if (kind === "erasure" && str(data, "understand") !== "yes") {
      throw new ValidationError("Tick the box to confirm you understand what erasure removes and what the law makes us keep.");
    }
    const r = await fileRequest(actor, {
      kind,
      details: str(data, "details"),
      data: { nomineeName: str(data, "nomineeName"), nomineeContact: str(data, "nomineeContact"), nomineeRelation: str(data, "nomineeRelation") },
    });
    revalidatePath(pathOf(uni));
    return `Request sent. We'll answer by ${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${r.dueOn}T00:00:00Z`))}.`;
  });
}

export async function declareAgeAction(uni: string, _: ActionState, data: FormData): Promise<ActionState> {
  return attempt(async () => {
    const actor = await me(uni);
    const sentTo = await declareAge(
      actor,
      { age: str(data, "age"), birthDate: str(data, "birthDate"), guardianName: str(data, "guardianName"), guardianContact: str(data, "guardianContact") },
      { ip: (await clientInfo()).ip, linkBase: appUrl() },
    );
    revalidatePath(pathOf(uni));
    return sentTo ? `We sent your parent or guardian a link at ${sentTo}. Nothing optional is switched on until they confirm.` : "Thanks. Nothing changes for you.";
  });
}

export async function resendGuardianAction(uni: string): Promise<ActionState> {
  return attempt(async () => {
    const actor = await me(uni);
    const sentTo = await resendGuardianLink(actor, { ip: (await clientInfo()).ip, linkBase: appUrl() });
    revalidatePath(pathOf(uni));
    return `We sent a new link to ${sentTo}. The old one no longer works.`;
  });
}

/** The guardian's "I give my consent", on the page their link opens. No sign-in needed: holding the link is the check. */
export async function confirmGuardianAction(token: string, _: ActionState, data: FormData): Promise<ActionState> {
  return attempt(async () => {
    await confirmGuardianConsent(token, { ip: (await clientInfo()).ip, agree: str(data, "agree") === "yes" });
    revalidatePath(`/privacy/guardian/${token}`);
    return "Thank you. Your consent is recorded.";
  });
}
