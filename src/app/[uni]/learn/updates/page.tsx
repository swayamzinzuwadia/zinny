import { Card, Empty } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { myNotifications } from "@/server/services/notifications";
import { sendParentsHome } from "../view";

export const metadata = { title: "Updates" };

/** Every recent update; the home page shows the latest three. */
export default async function Updates({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  sendParentsHome(actor, uni);
  const notes = await myNotifications(actor, 30);
  const when = new Intl.DateTimeFormat("en-IN", { timeZone: university.timezone, weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="space-y-5">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Updates</h1>
      {notes.length === 0 ? (
        <Empty title="Nothing new">Updates about your classes, work and results show up here.</Empty>
      ) : (
        <Card className="p-5">
          <ul className="-my-3 divide-y divide-line">
            {notes.map((n) => (
              <li key={n.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] font-medium">{n.title}</span>
                  <span className="tabular shrink-0 text-[13px] text-muted">{when.format(n.createdAt)}</span>
                </div>
                {n.body && <div className="text-[13px] text-muted">{n.body}</div>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
