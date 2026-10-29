/**
 * The core API (contracts.md section 8). Stable functions every module may use.
 * Nothing else from `src/server/**` is public to modules.
 */

// Tenancy, permissions, audit, events
export { withTenant, audit } from "../tenant";
export { emit } from "../events";
export { systemActorFor } from "../actor";
export { assertCan, can, reach, hasRole } from "../authz/engine";
export type { Actor, Target } from "../authz/engine";
export type { Action } from "../authz/roles";

// Context
export { universityLite, todayFor, peopleLite } from "../services/lite";

// Courses and batches
export { getCourseLite, batchLite, listCourseBatches, facultyBatchIds } from "../services/lite";
export { courseTarget } from "../services/courses";

// Students
export { batchStudentIds, studentEnrolments, enrolmentById } from "../services/lite";
export { markEnrolmentCompleted } from "../services/core-api";

// Calendar
export { scheduledBatches } from "../services/batches";
export { expandSessions } from "../services/schedule";
export type { ScheduledBatch, Session, Slot, Override } from "../services/schedule";
export { studentTimetable } from "../services/timetable";

// Messages and files
export { notify, hodsOf } from "../services/notifications";
export { storage, sendEmail, sendSms } from "../messaging";
export { gateway } from "../payments/gateway";

// Money (payments uses these; nobody else writes orders)
export { orderForCheckout, markOrderRefunded, orderUniversity } from "../services/core-api";
export { confirmPayment, failPayment } from "../services/enrolment";
// Wave 1 integration (payments request): seeds and modules start a checkout the way a student does.
export { holdSeat } from "../services/enrolment";

// Zinny team (platform context, no university)
export { listUniversities, createUniversity, enterSupportMode, exitSupportMode, supportTrail } from "../services/support";
export { updateUniversity, grantPlatformRole, revokePlatformRole } from "../services/core-api";
export { assertPlatform, canPlatform } from "../authz/engine";

// Shapes returned by the functions above
export type { BatchLite, CheckoutOrder, CourseLite, EnrolmentLite, PersonLite, StudentEnrolment, UniversityLite } from "@/contracts/core";
