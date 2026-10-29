/** Opens an assignment file: checks access, then redirects to a two-minute signed link. */
import { fileRoute } from "@/modules/assignments-polls/http";

export const dynamic = "force-dynamic";
export const GET = fileRoute;
