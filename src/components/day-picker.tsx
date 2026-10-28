const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Day checkboxes (name="day", values 1–7) plus one start and end time. */
export function DayTimePicker({ days = [], start = "", end = "" }: { days?: number[]; start?: string; end?: string }) {
  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-medium">Days</span>
      <div className="flex flex-wrap gap-1.5">
        {DAYS.map((d, i) => (
          <label key={d} className="cursor-pointer">
            <input type="checkbox" name="day" value={i + 1} defaultChecked={days.includes(i + 1)} className="peer sr-only" />
            <span className="inline-flex h-9 w-11 items-center justify-center rounded-lg border border-line text-[13px] peer-checked:border-brand peer-checked:bg-brand-soft peer-checked:font-medium peer-checked:text-brand-strong peer-focus-visible:ring-2 peer-focus-visible:ring-brand">
              {d}
            </span>
          </label>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">Starts at</span>
          <input type="time" name="startTime" defaultValue={start} className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-[14px]" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">Ends at</span>
          <input type="time" name="endTime" defaultValue={end} className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-[14px]" />
        </label>
      </div>
    </div>
  );
}
