"use server";

/**
 * Server actions for the learner taking a test. The browser calls these directly
 * (autosave on every change, proctoring events, submit). Each returns plain data and
 * never throws to the client: errors come back as { error } with a message to show.
 */
import { redirect } from "next/navigation";
import { unstable_rethrow } from "next/navigation";
import { spaceContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { recordProctorEvent, saveAnswer, startAttempt, submitAttempt, type ProctorResult, type SaveResult } from "./attempts";
import type { ProctorKind } from "./schema";

type Failure = { error: string };

async function safely<T>(fn: () => Promise<T>): Promise<T | Failure> {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) return { error: e.message };
    console.error("[assessments]", e);
    return { error: "Something went wrong. Check your connection and try again." };
  }
}

export async function saveAnswerAction(uni: string, attemptId: string, itemId: string, response: unknown): Promise<SaveResult | Failure> {
  const { actor } = await spaceContext(uni);
  return safely(() => saveAnswer(actor, attemptId, itemId, response));
}

export async function proctorEventAction(uni: string, attemptId: string, kind: ProctorKind): Promise<ProctorResult | Failure> {
  const { actor } = await spaceContext(uni);
  return safely(() => recordProctorEvent(actor, attemptId, kind));
}

export async function submitAttemptAction(uni: string, attemptId: string): Promise<{ attemptId: string } | Failure> {
  const { actor } = await spaceContext(uni);
  return safely(async () => ({ attemptId: (await submitAttempt(actor, attemptId)).attemptId }));
}

/** The "Start test" form on the test's page. */
export async function startTestAction(_: { error?: string } | null, data: FormData): Promise<{ error?: string } | null> {
  const uni = String(data.get("uni") ?? "");
  const testId = String(data.get("testId") ?? "");
  const { actor } = await spaceContext(uni);
  const res = await safely(() => startAttempt(actor, testId));
  if ("error" in res) return { error: res.error };
  redirect(`/${uni}/learn/tests/attempt/${res.attemptId}`);
}
