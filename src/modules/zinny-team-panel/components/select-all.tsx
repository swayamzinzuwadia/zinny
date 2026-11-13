"use client";

/** Ticks or clears every row checkbox (`name="key"`) in the same form. */
export function SelectAll() {
  return (
    <input
      type="checkbox"
      aria-label="Select every row on this page"
      className="size-4 accent-brand"
      onChange={(e) => {
        const form = e.currentTarget.form;
        if (!form) return;
        for (const box of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="key"]')) box.checked = e.currentTarget.checked;
      }}
    />
  );
}
