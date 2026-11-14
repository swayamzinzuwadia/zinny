import { ActionForm, SubmitButton, type FormAction } from "./forms";
import { Avatar, buttonClass, inputClass } from "./ui";

export type EnrolmentRequestItem = {
  enrolmentId: string;
  student: { name: string; email: string };
  course: { title: string };
  batch: { name: string; seatsLeft: number };
  /** "Their place clashes with …": accepting is still allowed. */
  clashWarning?: string | null;
};

/**
 * Students waiting for faculty to accept them into a batch. Accepting enrols them: institute
 * courses are free for their students.
 */
export function EnrolmentRequests({
  requests,
  uni,
  action,
  back,
  showCourse = true,
}: {
  requests: EnrolmentRequestItem[];
  uni: string;
  action: FormAction;
  /** The page to come back to, which then says what happened. */
  back: string;
  showCourse?: boolean;
}) {
  if (requests.length === 0) return null;
  return (
    <ul className="divide-y divide-line">
      {requests.map((r) => (
        <li key={r.enrolmentId} className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-start gap-3">
            <Avatar name={r.student.name} size={32} />
            <div className="min-w-0 flex-1 text-[14px]">
              <div className="font-medium">{r.student.name} wants a seat</div>
              <div className="text-muted">
                {showCourse ? `${r.course.title} · ` : ""}
                {r.batch.name} · {r.batch.seatsLeft === 0 ? "batch is full" : `${r.batch.seatsLeft} seat${r.batch.seatsLeft === 1 ? "" : "s"} left`}
              </div>
              {r.clashWarning && <div className="mt-1 text-[13px] text-warn">{r.clashWarning} You can still accept.</div>}
            </div>
          </div>
          <ActionForm action={action} className="mt-2.5 flex flex-wrap items-center gap-2 pl-11">
            <input type="hidden" name="uni" value={uni} />
            <input type="hidden" name="enrolmentId" value={r.enrolmentId} />
            <input type="hidden" name="name" value={r.student.name} />
            <input type="hidden" name="back" value={back} />
            <input name="note" maxLength={200} placeholder="Note for the student (optional)" className={`${inputClass} h-9 min-w-0 flex-1 text-[13px]`} />
            <button type="submit" name="choice" value="accept" className={buttonClass("primary", "sm")}>
              Accept
            </button>
            <button type="submit" name="choice" value="decline" className={buttonClass("ghost", "sm")}>
              Decline
            </button>
          </ActionForm>
        </li>
      ))}
    </ul>
  );
}

/** Changes a batch's seat limit on the spot. It can't go below the seats already taken. */
export function SeatLimitForm({ uni, batchId, seatLimit, taken, action }: { uni: string; batchId: string; seatLimit: number; taken: number; action: FormAction }) {
  return (
    <ActionForm action={action} resetOnSuccess={false} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="batchId" value={batchId} />
      <label className="text-[13px] text-muted" htmlFor={`seats-${batchId}`}>
        Seats
      </label>
      <input id={`seats-${batchId}`} name="seatLimit" type="number" min={Math.max(1, taken)} defaultValue={seatLimit} className={`${inputClass} h-9 w-24 text-[14px]`} />
      <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
        Change seats
      </SubmitButton>
    </ActionForm>
  );
}
