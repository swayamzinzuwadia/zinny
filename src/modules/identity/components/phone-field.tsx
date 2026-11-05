"use client";
/**
 * A mobile number box with its country code picker beside it. It posts `countryCode` and
 * `phone`; the server joins them with joinPhone. India is the default.
 */
import { useId } from "react";
import { Select, cx, inputClass } from "@/components/ui";
import { COUNTRY_CODES } from "@/server/auth/phone";

export function PhoneField({
  label,
  hint,
  required = true,
  autoFocus,
  tall,
  className,
}: {
  /** Shown above the boxes; without one, the boxes are labelled for screen readers only. */
  label?: string;
  hint?: string;
  required?: boolean;
  autoFocus?: boolean;
  /** The sign-in pages' taller boxes. */
  tall?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium">
          {label}
        </label>
      )}
      <div className="flex gap-2">
        <Select name="countryCode" defaultValue="91" aria-label="Country code" className={cx("w-[7.5rem] shrink-0", tall && "h-11")}>
          {COUNTRY_CODES.map((c) => (
            <option key={c.name} value={c.code}>
              {`+${c.code} ${c.name}`}
            </option>
          ))}
        </Select>
        <input
          id={id}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="98200 11001"
          required={required}
          autoFocus={autoFocus}
          aria-label={label ? undefined : "Mobile number"}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={cx(inputClass, "min-w-0 flex-1", tall && "h-11 text-[15px]")}
        />
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-[12px] text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
