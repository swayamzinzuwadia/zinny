import { Badge } from "@/components/ui";
import { STATUS_LABEL, type EffectiveStatus } from "../lib";

const TONE = { valid: "brand", expired: "warn", revoked: "danger" } as const;

export function StatusBadge({ status }: { status: EffectiveStatus }) {
  return <Badge tone={TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
