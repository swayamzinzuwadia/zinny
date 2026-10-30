"use server";
/**
 * Server actions for the sign-in screens (/login, /reset, /invite). They only call the
 * identity auth service and set cookies; every rule lives in the service.
 */
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { str } from "@/server/action";
import { AppError, ValidationError } from "@/server/errors";
import { humanDuration } from "@/server/auth/config";
import { clientInfo, cookieOptions, spacesFor, startSession, type SessionMethod } from "@/server/auth/session";
import {
  PHONE_COOKIE_MS,
  acceptInvite,
  landingAfterSignIn,
  choosePhoneAccount,
  completePasswordReset,
  demoSignIn,
  requestPasswordReset,
  resendPhoneCode,
  safeNext,
  signInMessage,
  signInWithPassword,
  signUpStudent,
  startPhoneSignIn,
  verifyPhoneCode,
  loginUniversity,
} from "@/modules/identity/auth";
import { PHONE_COOKIE, UNI_COOKIE } from "@/modules/identity/cookies";


/**
 * Signs in, remembers the institute when the person belongs to exactly one, and returns
 * where to go next.
 */
async function signInAs(userId: string, method: SessionMethod, next?: string | null): Promise<string> {
  await startSession(userId, method);
  const spaces = await spacesFor(userId);
  if (spaces.length === 1) (await cookies()).set(UNI_COOKIE, spaces[0].slug, { ...cookieOptions(), maxAge: 400 * 86_400 });
  return landingAfterSignIn(userId, next);
}

/** "Not your institute?" on /login. */
export async function forgetUniversityAction(data: FormData) {
  (await cookies()).delete(UNI_COOKIE);
  const next = safeNext(str(data, "next"));
  redirect(next && next !== "/" ? `/login?${new URLSearchParams({ next, uni: "" })}` : "/login?uni=");
}

/** Codes the screens use to pick a state (locked, expired link …). */
export type AuthState = (ActionState & { code?: string; email?: string; name?: string }) | null;

function fail(e: unknown): AuthState {
  unstable_rethrow(e);
  if (e instanceof AppError) return { error: e.message, code: e.code, at: Date.now() };
  console.error(e);
  return { error: "Something went wrong on our side. Please try again.", at: Date.now() };
}

/* ───────────────────────────── Password ───────────────────────────── */

export async function passwordSignInAction(_: AuthState, data: FormData): Promise<AuthState> {
  const email = str(data, "email");
  let dest: string | null = null;
  try {
    const { ip } = await clientInfo();
    const r = await signInWithPassword({ email, password: String(data.get("password") ?? ""), ip });
    if (!r.ok) return { error: signInMessage(r), code: r.reason, email, at: Date.now() };
    dest = await signInAs(r.userId, "password", str(data, "next"));
  } catch (e) {
    return { ...fail(e), email };
  }
  redirect(dest);
}

export async function demoSignInAction(data: FormData) {
  const userId = await demoSignIn(str(data, "email"));
  redirect(await signInAs(userId, "demo"));
}

/* ───────────────────────────── Student sign-up ───────────────────────────── */

export async function signUpAction(_: AuthState, data: FormData): Promise<AuthState> {
  const email = str(data, "email");
  const name = str(data, "name");
  // Only bots fill in this hidden field.
  if (str(data, "website")) return { error: "We couldn't create your account. Please try again.", email, name, at: Date.now() };
  let dest: string | null = null;
  try {
    const { ip } = await clientInfo();
    const r = await signUpStudent({
      slug: str(data, "uni"),
      name,
      email,
      password: String(data.get("password") ?? ""),
      confirm: String(data.get("confirm") ?? ""),
      ip,
    });
    if (r.status === "network_limited") {
      const wait = humanDuration(r.retryAt.getTime() - Date.now());
      return { error: `Too many new accounts from your network. Try again in ${wait}.`, code: "network_limited", email, name, at: Date.now() };
    }
    await signInAs(r.userId, "password");
    dest = r.landing;
  } catch (e) {
    return { ...fail(e), email, name };
  }
  redirect(dest);
}

/* ───────────────────────────── Phone ───────────────────────────── */

async function phoneRef() {
  return (await cookies()).get(PHONE_COOKIE)?.value ?? null;
}

async function setPhoneRef(ref: string) {
  (await cookies()).set(PHONE_COOKIE, ref, { ...cookieOptions(), maxAge: Math.floor(PHONE_COOKIE_MS / 1000) });
}

async function clearPhoneRef() {
  (await cookies()).delete(PHONE_COOKIE);
}

/** Back to the number step from the code step. */
export async function phoneRestartAction(data: FormData) {
  await clearPhoneRef();
  const uni = str(data, "uni");
  const next = safeNext(str(data, "next"));
  redirect(`/login?${new URLSearchParams({ uni, tab: "phone", ...(next && next !== "/" ? { next } : {}) })}`);
}

export async function phoneSendAction(_: AuthState, data: FormData): Promise<AuthState> {
  const slug = str(data, "uni");
  const next = safeNext(str(data, "next"));
  try {
    const uni = await loginUniversity(slug);
    if (!uni) throw new ValidationError("We couldn't find your institute. Sign in with your email instead.");
    const { ip } = await clientInfo();
    const s = await startPhoneSignIn({ universityId: uni.id, phone: str(data, "phone"), ip });
    await setPhoneRef(s.ref);
  } catch (e) {
    return fail(e);
  }
  redirect(`/login?${new URLSearchParams({ uni: slug, tab: "phone", ...(next && next !== "/" ? { next } : {}) })}`);
}

export async function phoneResendAction(_: AuthState, _data: FormData): Promise<AuthState> {
  void _data;
  try {
    const { ip } = await clientInfo();
    await resendPhoneCode({ ref: await phoneRef(), ip });
    return { ok: "We sent a new code. Codes you had before no longer work.", at: Date.now() };
  } catch (e) {
    if (e instanceof AppError && e.code === "restart") await clearPhoneRef();
    return fail(e);
  }
}

export async function phoneVerifyAction(_: AuthState, data: FormData): Promise<AuthState> {
  let dest: string | null = null;
  try {
    const ref = await phoneRef();
    const r = await verifyPhoneCode({ ref, code: str(data, "code") });
    if (r.status === "choose") {
      const uni = str(data, "uni");
      const next = safeNext(str(data, "next"));
      redirect(`/login?${new URLSearchParams({ uni, tab: "phone", ...(next && next !== "/" ? { next } : {}) })}`);
    }
    await clearPhoneRef();
    dest = await signInAs(r.userId, "phone", str(data, "next"));
  } catch (e) {
    if (e instanceof AppError && ["restart", "locked"].includes(e.code)) await clearPhoneRef();
    return fail(e);
  }
  redirect(dest);
}

export async function phoneChooseAction(_: AuthState, data: FormData): Promise<AuthState> {
  let dest: string | null = null;
  try {
    const r = await choosePhoneAccount({ ref: await phoneRef(), userId: str(data, "userId") });
    await clearPhoneRef();
    dest = await signInAs(r.userId, "phone", str(data, "next"));
  } catch (e) {
    return fail(e);
  }
  redirect(dest);
}

/* ───────────────────────────── Reset ───────────────────────────── */

export async function resetRequestAction(_: AuthState, data: FormData): Promise<AuthState> {
  const email = str(data, "email");
  try {
    const { ip } = await clientInfo();
    const r = await requestPasswordReset({ email, ip });
    if (r.status === "network_limited") {
      return { error: "Too many reset requests from your network. Try again in an hour.", code: "rate_limited", email, at: Date.now() };
    }
    return { ok: "sent", code: "sent", email: email.trim().toLowerCase(), at: Date.now() };
  } catch (e) {
    return { ...fail(e), email };
  }
}

export async function resetCompleteAction(_: AuthState, data: FormData): Promise<AuthState> {
  let dest: string | null = null;
  try {
    const r = await completePasswordReset({
      token: str(data, "token"),
      password: String(data.get("password") ?? ""),
      confirm: String(data.get("confirm") ?? ""),
    });
    dest = await signInAs(r.userId, "reset");
  } catch (e) {
    return fail(e);
  }
  redirect(dest);
}

/* ───────────────────────────── Invite ───────────────────────────── */

export async function acceptInviteAction(_: AuthState, data: FormData): Promise<AuthState> {
  let landing = "/";
  try {
    const r = await acceptInvite({
      token: str(data, "token"),
      password: String(data.get("password") ?? ""),
      confirm: String(data.get("confirm") ?? ""),
    });
    await signInAs(r.userId, "invite");
    landing = r.landing;
  } catch (e) {
    return fail(e);
  }
  redirect(landing);
}
