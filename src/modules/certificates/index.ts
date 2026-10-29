import type { ZinnyModule } from "@/contracts/module";
import { handlers } from "./events";
import { jobs } from "./jobs";

/** certificates: certificate templates, issuing on completion, renewals and the verify page. Brief: .claude/agents/certificates.md */
const certificates: ZinnyModule = {
  id: "certificates",
  eventHandlers: handlers,
  jobs,
};

export default certificates;
