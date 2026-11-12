"use client";

import { useState } from "react";
import type { PlanOption } from "../services/plans";
import { LicenceFields, type ChargeDefaults, type LicenceValues } from "./licence-fields";

/** "Set up the licence now" on the new-university form. Off: the licence fields are left out. */
export function OptionalLicence({ plans, initial, charge }: { plans: PlanOption[]; initial: LicenceValues; charge: ChargeDefaults }) {
  const [on, setOn] = useState(true);
  return (
    <div className="space-y-4">
      <label className="flex items-start gap-2.5 text-[14px]">
        <input type="checkbox" name="withLicence" checked={on} onChange={(e) => setOn(e.target.checked)} className="mt-1 h-4 w-4 accent-[#0b5e4c]" />
        <span>
          <span className="font-medium">Set up the licence now</span>
          <span className="block text-[13px] text-muted">The institute is invoiced for the plan when you create it. You can also do this later from Licences.</span>
        </span>
      </label>
      {on && <LicenceFields plans={plans} initial={initial} charge={charge} />}
    </div>
  );
}
