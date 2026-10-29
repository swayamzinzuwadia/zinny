import type { ZinnyModule } from "@/contracts/module";
import { CertificatesCourseTab } from "./components/course-tab";
import { CertificatesDashboardCard } from "./components/dashboard-card";
import { CertificatesHubSection } from "./components/hub-section";
import { LearnerCertificateTab } from "./components/learner-course-tab";
import { handlers } from "./events";
import { jobs } from "./jobs";
import { seed } from "./seed";

/** certificates: certificate templates, issuing on completion, renewals and the verify page. Brief: .claude/agents/certificates.md */
const certificates: ZinnyModule = {
  id: "certificates",
  eventHandlers: handlers,
  jobs,
  seed,
  adminCourseTabs: [{ key: "certificates", label: "Certificates", order: 500, action: "cert.view", component: CertificatesCourseTab }],
  learnerCourseTabs: [{ key: "certificate", label: "Certificate", order: 500, action: "self.view_certificates", component: LearnerCertificateTab }],
  learnerHubSections: [{ key: "certificates", order: 500, action: "self.view_certificates", component: CertificatesHubSection }],
  dashboardCards: [{ key: "certificates-issued", order: 500, action: "cert.view", component: CertificatesDashboardCard }],
};

export default certificates;
