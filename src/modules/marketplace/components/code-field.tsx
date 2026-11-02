"use client";

import { useState } from "react";
import { Input, buttonClass } from "@/components/ui";

/**
 * The discount code box on a listing, with its "Apply" button. Controlled on purpose: React
 * clears a form's plain inputs after each action, and an applied code has to still be there
 * when the buyer presses "Buy now".
 */
export function CodeField() {
  const [code, setCode] = useState("");
  return (
    <div className="flex gap-2">
      <Input
        name="code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="Discount code"
        aria-label="Discount code"
        maxLength={24}
        autoComplete="off"
      />
      <button type="submit" name="intent" value="apply" className={buttonClass("secondary", "md")}>
        Apply
      </button>
    </div>
  );
}
