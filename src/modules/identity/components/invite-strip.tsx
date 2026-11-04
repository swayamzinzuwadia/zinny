import Link from "next/link";
import { Card } from "@/components/ui";
import { joinLink, joinMessage, whatsAppShareHref } from "../share";
import { ShareJoinCode } from "./share-join-code";

/**
 * The institute dashboard's "Invite students" strip, for the people who accept new students
 * (Admins and HODs): the joining code and link, ways to share them, and a printable poster.
 */
export function InviteStrip({
  uni,
  institute,
  code,
  mode,
  canManage,
}: {
  uni: string;
  institute: string;
  code: string;
  mode: "approval" | "instant";
  /** Institute Admins can also change how students join, and make a new code. */
  canManage: boolean;
}) {
  const link = joinLink(code);
  const message = joinMessage(institute, link, code);
  return (
    <Card className="flex flex-wrap items-center gap-x-8 gap-y-4 py-5">
      <div className="min-w-[220px] flex-1">
        <h2 className="text-[16px] font-medium">Invite students</h2>
        <p className="mt-0.5 text-[13px] text-muted">
          Share your joining code or link. {mode === "approval" ? "Students who use it wait for an Admin or HOD to accept them." : "Students who use it join straight away."}
        </p>
      </div>
      <div className="min-w-0">
        <div className="text-[12px] text-muted">Joining code</div>
        <div className="tabular text-[26px] leading-tight font-semibold tracking-[0.2em] text-brand-strong">{code}</div>
      </div>
      <div className="flex flex-col gap-2">
        <ShareJoinCode code={code} link={link} message={message} whatsApp={whatsAppShareHref(message)} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <Link href={`/${uni}/join-poster`} className="font-medium text-brand hover:underline">
            Print a poster with a QR code
          </Link>
          <Link href={`/${uni}/admin/users/requests`} className="font-medium text-brand hover:underline">
            {canManage ? "Join requests and settings" : "Join requests"}
          </Link>
        </div>
      </div>
    </Card>
  );
}
