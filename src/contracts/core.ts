/**
 * Small, stable shapes the core API returns (contracts.md section 8). Modules use
 * these instead of core table types, so core tables can change between waves.
 */
import type { Target } from "@/server/authz/engine";

export type UniversityLite = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  legalName: string | null;
  gstin: string | null;
  branding: { primaryColor?: string; logoUrl?: string };
};

export type PersonLite = { id: string; name: string; email: string };

export type CourseLite = {
  id: string;
  title: string;
  departmentId: string;
  programId: string | null;
  status: "draft" | "published" | "archived";
  certificateEnabled: boolean;
  pricePaise: number;
};

export type BatchLite = {
  id: string;
  courseId: string;
  departmentId: string;
  name: string;
  startDate: string;
  endDate: string;
  seatLimit: number;
  status: "draft" | "open" | "closed" | "archived";
  meetingUrl: string | null;
  /** Ready for assertCan: the batch's university, department and id. */
  target: Target;
};

export type EnrolmentStatus = "held" | "active" | "completed" | "cancelled" | "expired" | "ended";

export type StudentEnrolment = { enrolmentId: string; courseId: string; batchId: string; status: EnrolmentStatus };

export type EnrolmentLite = StudentEnrolment & { userId: string; enrolledAt: Date | null };

/** What `orderForCheckout` returns: the student's own order with its course, batch and seat hold. */
export type CheckoutOrder = {
  order: {
    id: string;
    status: "pending" | "paid" | "failed" | "expired" | "refund_due" | "refunded";
    basePaise: number;
    gstPaise: number;
    totalPaise: number;
    gateway: string;
    gatewayOrderId: string | null;
    gatewayPaymentId: string | null;
    paidAt: Date | null;
    userId: string;
    universityId: string;
  };
  course: { id: string; title: string; gstRateBp: number };
  batch: { id: string; name: string };
  enrolment: { id: string; status: EnrolmentStatus; holdExpiresAt: Date | null } | null;
};
