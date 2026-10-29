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
import { clientInfo, cookieOptions, spacesFor, startSession, type SessionMethod } from "@/server/auth/session";
import {
  PHONE_COOKIE_MS,
  acceptInvite,
  choosePhoneAccount,
  completePasswordReset,
  demoSignIn,
  requestPasswordReset,
  resendPhoneCode,
  safeNext,
  signInMessage,
  signInWithPassword,
  startPhoneSignIn,
  verifyPhoneCode,
  loginUniversity,
} from "@/modules/identity/auth";

const PHONE_COOKIE = "zinny_phone_signin";
/** The institute this device last signed in to, so /login can offer its phone tab. */
export const UNI_COOKIE = "zinny_uni";

/** Signs in and remembers the institute when the person belongs to exactly one. */
async function signInAs(userId: string, method: SessionMethod) {
  await startSession(userId, method);
  const spaces = await spacesFor(userId);
  const jar = await cookies();
  if (spaces.length === 1) jar.set(UNI_COOKIE, spaces[0].slug, { ...cookieOptions(), maxAge: 400 * 86_400 });
}

/** "Not your institute?" on /login. */
export async function forgetUniversityAction(data: FormData) {
  (await cookies()).delete(UNI_COOKIE);
  const next = safeNext(str(data, "next"));
  redirect(next && next !== "/" ? `/login?${new URLSearchParams({ next, uni: "" })}` : "/login?uni=");
}

/** Codes the screens use to pick a state (locked, expired link …). */
export type AuthState = (ActionState & { code?: string; email?: string }) | null;

function fail(e: unknown): AuthState {
  unstable_rethrow(e);
  if (e instanceof AppError) return { error: e.message, code: e.code, at: Date.now() };
  console.error(e);
  return { error: "Something went wrong on our side. Please try again.", at: Date.now() };
}

/* ───────────────────────────── Password ───────────────────────────── */

export async function passwordSignInAction(_: AuthState, data: FormData): Promise<AuthState> {
  const email = str(data, "email");
  const dest = safeNext(str(data, "next")) ?? "/";
  let ok = false;
  try {
    const { ip } = await clientInfo();
    const r = await signInWithPassword({ email, password: String(data.get("password") ?? ""), ip });
    if (!r.ok) return { error: signInMessage(r), code: r.reason, email, at: Date.now() };
    await signInAs(r.userId, "password");
    ok = true;
  } catch (e) {
    return { ...fail(e), email };
  }
  if (ok) redirect(dest);
  return null;
}

export async function demoSignInAction(data: FormData) {
  const userId = await demoSignIn(str(data, "email"));
  await signInAs(userId, "demo");
  redirect("/");
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
    const uni = await loginUniversity({ uni: slug });
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
  const dest = safeNext(str(data, "next")) ?? "/";
  let done = false;
  try {
    const ref = await phoneRef();
    const r = await verifyPhoneCode({ ref, code: str(data, "code") });
    if (r.status === "choose") {
      const uni = str(data, "uni");
      const next = safeNext(str(data, "next"));
      redirect(`/login?${new URLSearchParams({ uni, tab: "phone", ...(next && next !== "/" ? { next } : {}) })}`);
    }
    await clearPhoneRef();
    await signInAs(r.userId, "phone");
    done = true;
  } catch (e) {
    if (e instanceof AppError && ["restart", "locked"].includes(e.code)) await clearPhoneRef();
    return fail(e);
  }
  if (done) redirect(dest);
  return null;
}

export async function phoneChooseAction(_: AuthState, data: FormData): Promise<AuthState> {
  const dest = safeNext(str(data, "next")) ?? "/";
  let done = false;
  try {
    const r = await choosePhoneAccount({ ref: await phoneRef(), userId: str(data, "userId") });
    await clearPhoneRef();
    await signInAs(r.userId, "phone");
    done = true;
  } catch (e) {
    return fail(e);
  }
  if (done) redirect(dest);
  return null;
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
  let ok = false;
  try {
    const r = await completePasswordReset({
      token: str(data, "token"),
      password: String(data.get("password") ?? ""),
      confirm: String(data.get("confirm") ?? ""),
    });
    await signInAs(r.userId, "reset");
    ok = true;
  } catch (e) {
    return fail(e);
  }
  if (ok) redirect("/");
  return null;
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
