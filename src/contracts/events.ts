/**
 * Domain events (contracts.md section 2). Frozen for the wave.
 *
 * An event is written to `domain_events` in the same transaction as the change that
 * caused it, then delivered at least once to every handler that listens for its type.
 * Handlers must be idempotent: use `event.id` to avoid doing the work twice.
 */
import type { RoleName } from "@/db/schema";
import type { Tx } from "@/db/client";
import type { Actor } from "@/server/authz/engine";

/** Every event in the catalogue and its payload. */
export type EventMap = {
  /** A person was given a role and has no password yet. `event.universityId` is null for Zinny team invites. */
  "user.invited": { userId: string; email: string; name: string; role: RoleName };
  "enrolment.confirmed": { enrolmentId: string; userId: string; courseId: string; batchId: string };
  "enrolment.switched": { enrolmentId: string; userId: string; courseId: string; fromBatchId: string; toBatchId: string };
  "enrolment.ended": { enrolmentId: string; userId: string; courseId: string; reason: "graduated" | "cancelled" };
  "enrolment.completed": { enrolmentId: string; userId: string; courseId: string; batchId: string };
  "payment.confirmed": { orderId: string; userId: string; courseId: string; batchId: string; totalPaise: number; invoiceNumber: string };
  "payment.refunded": { orderId: string; userId: string; amountPaise: number };
  "lesson.completed": { userId: string; courseId: string; lessonId: string };
  "course.progress": { userId: string; courseId: string; enrolmentId: string; percent: number };
  "test.submitted": {
    attemptId: string;
    testId: string;
    userId: string;
    courseId: string | null;
    batchId: string | null;
    scorePercent: number;
    passed: boolean;
  };
  "assignment.submitted": { submissionId: string; assignmentId: string; userId: string; batchId: string; late: boolean };
  "assignment.graded": { submissionId: string; assignmentId: string; userId: string; batchId: string; scorePercent: number };
  "attendance.marked": { batchId: string; date: string; startTime: string; userId: string; status: "present" | "late" | "absent" };
  "certificate.issued": { certificateId: string; userId: string; courseId: string; code: string };
  "xp.awarded": { userId: string; points: number; reason: string; sourceEventId: string };
  "enquiry.received": { enquiryId: string; name: string; email: string; phone: string | null };
};

export type EventType = keyof EventMap;

/** The catalogue as a runtime list, so `emit` can refuse unknown types. */
export const EVENT_TYPES = [
  "user.invited",
  "enrolment.confirmed",
  "enrolment.switched",
  "enrolment.ended",
  "enrolment.completed",
  "payment.confirmed",
  "payment.refunded",
  "lesson.completed",
  "course.progress",
  "test.submitted",
  "assignment.submitted",
  "assignment.graded",
  "attendance.marked",
  "certificate.issued",
  "xp.awarded",
  "enquiry.received",
] as const satisfies readonly EventType[];

// Compile-time check that EVENT_TYPES lists every key of EventMap.
type _AllListed = Exclude<EventType, (typeof EVENT_TYPES)[number]> extends never ? true : never;
const _allListed: _AllListed = true;
void _allListed;

/** One stored event, narrowed by type. */
export type DomainEvent<T extends EventType = EventType> = {
  [K in T]: {
    id: string;
    /** Null only for Zinny team (platform) events such as a team member's invite. */
    universityId: string | null;
    type: K;
    payload: EventMap[K];
    /** Who caused it; null for the system (jobs, webhooks, handlers). */
    actorUserId: string | null;
    occurredAt: Date;
  };
}[T];

export type EventHandlerContext<T extends EventType = EventType> = {
  /** A transaction under row-level security for the event's university. */
  tx: Tx;
  /** That university's system actor (or the platform system actor for platform events). */
  actor: Actor;
  event: DomainEvent<T>;
};

/**
 * Registered through a module's `eventHandlers`. `id` must be unique and stable
 * (deliveries are recorded per handler id), e.g. "gamification.award-xp".
 */
export type EventHandler<T extends EventType = EventType> = {
  id: string;
  on: readonly T[];
  handle(ctx: EventHandlerContext<T>): Promise<void>;
};

/** Infers the event types from `on`, so `event.payload` is typed inside `handle`. */
export function defineHandler<T extends EventType>(handler: EventHandler<T>): EventHandler {
  return handler as unknown as EventHandler;
}
