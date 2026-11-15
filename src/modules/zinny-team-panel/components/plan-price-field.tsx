"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui";
import { parseRupees } from "../lib/format";

/**
 * The plan's price, for a grid row. On an existing plan, changing it says what happens to
 * the licences already on it: they keep their price until they renew, and renewals use
 * the new one. The note goes on its own line at the end of the row.
 */
export function PlanPriceField({ initial, existing }: { initial: string; existing: boolean }) {
  const [value, setValue] = useState(initial);
  const changed = existing && value.trim() !== "" && parseRupees(value) !== parseRupees(initial);
  return (
    <>
      <Field label="Price before GST (₹)" hint="For one billing period">
        <Input name="price" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="720000" required />
      </Field>
      {changed && (
        <p className="order-last col-span-full flex gap-2 text-[13px] text-ink" role="status">
          <span aria-hidden className="mt-[6px] h-2 w-2 shrink-0 rounded-full bg-gold" />
          Existing licences keep their price until they renew; renewals use the new price.
        </p>
      )}
    </>
  );
}
