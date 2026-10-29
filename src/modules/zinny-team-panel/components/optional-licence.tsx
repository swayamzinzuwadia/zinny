"use client";

import { useState } from "react";
import { LicenceFields, type LicenceValues } from "./licence-fields";

/** "Set up the licence now" on the new-university form. Off: the licence fields are left out. */
export function OptionalLicence({ initial }: { initial: LicenceValues }) {
  const [on, setOn] = useState(true);
  return (
    <div className="space-y-4">
      <label className="flex items-start gap-2.5 text-[14px]">
        <input type="checkbox" name="withLicence" checked={on} onChange={(e) => setOn(e.target.checked)} className="mt-1 h-4 w-4 accent-[#0b5e4c]" />
        <span>
          <span className="font-medium">Set up the licence now</span>
          <span className="block text-[13px] text-muted">You can also do it later from Licences.</span>
        </span>
      </label>
      {on && <LicenceFields initial={initial} />}
    </div>
  );
}
