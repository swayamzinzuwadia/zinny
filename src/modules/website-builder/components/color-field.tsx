"use client";

import { useState } from "react";
import { cx, inputClass } from "@/components/ui";
import { CREAM, contrast, darkenToContrast, MIN_CONTRAST, normaliseHex } from "../branding";

/**
 * The site's main colour: either the university's own branding colour (default) or a custom
 * one. Custom colours must be dark enough to read on cream; the field says so as you type.
 */
export function ColorField({ initial, brandColor }: { initial: string | null; brandColor: string }) {
  const [useBrand, setUseBrand] = useState(!initial);
  const [value, setValue] = useState(initial ?? brandColor);
  const hex = normaliseHex(value);
  const ratio = hex ? contrast(hex, CREAM) : 0;
  const ok = !!hex && ratio >= MIN_CONTRAST;
  const shown = useBrand ? brandColor : (hex ?? brandColor);

  return (
    <fieldset>
      <legend className="mb-1.5 block text-[13px] font-medium">Main colour</legend>
      <label className="flex items-center gap-2 text-[14px]">
        <input type="checkbox" name="useBrandColour" checked={useBrand} onChange={(e) => setUseBrand(e.target.checked)} className="h-4 w-4 accent-[#0b5e4c]" />
        Use the university&apos;s colour
        <span className="inline-block h-4 w-4 rounded-full border border-line" style={{ background: brandColor }} aria-hidden />
      </label>
      {!useBrand && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            type="color"
            aria-label="Pick a colour"
            value={hex ?? "#0b5e4c"}
            onChange={(e) => setValue(e.target.value)}
            className="h-10 w-12 cursor-pointer rounded-xl border border-line bg-surface p-1"
          />
          <input name="primaryColor" value={value} onChange={(e) => setValue(e.target.value)} className={cx(inputClass, "w-32 font-mono")} aria-label="Colour code" maxLength={7} />
          {hex && !ok && (
            <button type="button" className="text-[13px] text-brand underline underline-offset-2" onClick={() => setValue(darkenToContrast(hex))}>
              Use a darker shade
            </button>
          )}
        </div>
      )}
      <div className="mt-3 flex items-center gap-3 rounded-2xl border border-line bg-canvas p-3">
        <span className="inline-flex h-9 items-center rounded-full px-4 text-[13px] font-medium" style={{ background: shown, color: CREAM }}>
          Enquire now
        </span>
        <span className="text-[14px] font-medium" style={{ color: shown }}>
          Link on your site
        </span>
      </div>
      {!useBrand && (
        <span className={cx("mt-1.5 block text-[12px]", ok ? "text-muted" : "text-danger")}>
          {!hex
            ? "Enter a colour code like #17365d."
            : ok
              ? `Readable: contrast ${ratio.toFixed(1)} to 1 on cream.`
              : `Too light to read on cream (contrast ${ratio.toFixed(1)} to 1; it needs ${MIN_CONTRAST}). Pick a darker shade.`}
        </span>
      )}
    </fieldset>
  );
}
