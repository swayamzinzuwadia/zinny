import Link from "next/link";
import { Empty, PageHeader } from "@/components/ui";

/** Shown instead of an attendance page the viewer can't open (another batch, or access that has ended). */
export function NoAttendanceAccess({ uni }: { uni: string }) {
  return (
    <>
      <PageHeader title="Attendance" />
      <Empty title="You can't see this batch's attendance">
        Faculty see the batches they teach, and HODs their department&apos;s. If you should have access, ask your HOD or the institute admin.{" "}
        <Link href={`/${uni}/admin`} className="text-brand hover:underline">
          Back to the dashboard
        </Link>
      </Empty>
    </>
  );
}
