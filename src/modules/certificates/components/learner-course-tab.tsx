import { Empty } from "@/components/ui";
import type { LearnerCourseTabProps } from "@/contracts/module";
import { certificateSvg, learnerCourseInfo, myCertificates } from "../service";
import { shortDate } from "../lib";
import { CertificateCard } from "./certificate-card";
import { StatusBadge } from "./status-badge";

/** Learner course hub → Certificate tab (learnerCourseTabs.certificate). */
export async function LearnerCertificateTab({ uni, actor, enrolment, course }: LearnerCourseTabProps) {
  const { rows } = await myCertificates(actor, { enrolmentId: enrolment.enrolmentId });
  const current = rows.find((r) => !r.replacedById) ?? rows[0];
  if (current) {
    const earlier = rows.filter((r) => r.id !== current.id);
    return (
      <div className="space-y-4">
        <CertificateCard uni={uni} c={current} svg={await certificateSvg(actor, current.id)} showCourse={false} />
        {earlier.length > 0 && (
          <div className="rounded-[22px] border border-line bg-surface p-4 text-[14px]">
            <div className="mb-2 font-medium">Earlier certificates for this course</div>
            <ul className="divide-y divide-line">
              {earlier.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="tabular font-mono text-[13px]">{r.displayCode}</span>
                  <span className="text-muted">Issued {shortDate(r.issuedOn)}</span>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const info = await learnerCourseInfo(actor, enrolment.enrolmentId);
  if (!info.certificateEnabled) return <Empty title="This course doesn't award a certificate" />;
  const validity = info.validityMonths ? ` It stays valid for ${info.validityMonths} months.` : "";
  if (enrolment.status === "completed") {
    return (
      <Empty title={info.autoIssue ? "Your certificate is on its way" : "Your institute will issue your certificate"}>
        {info.autoIssue
          ? `You've completed ${course.title}. Your certificate usually appears here within a minute; refresh to check.${validity}`
          : `You've completed ${course.title}. Your institute reviews each student before issuing the certificate. You'll be told when it's ready.${validity}`}
      </Empty>
    );
  }
  return (
    <Empty title="Complete the course to earn your certificate">
      {info.autoIssue
        ? `It's issued automatically when you finish ${course.title}, with a link anyone can use to check it.${validity}`
        : `Your institute issues it after you finish ${course.title} and they review your work.${validity}`}
    </Empty>
  );
}
