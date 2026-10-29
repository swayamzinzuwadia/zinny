"use client";

import { useState } from "react";
import { Field, Input, Select } from "@/components/ui";

type TriggerOption = { key: string; label: string; needsScore: boolean };

/** "What earns XP", with the minimum score field shown only for the triggers that use it. */
export function TriggerFields({ triggers, defaultKey }: { triggers: TriggerOption[]; defaultKey: string }) {
  const [key, setKey] = useState(defaultKey);
  const current = triggers.find((t) => t.key === key);
  return (
    <>
      <Field label="What earns XP">
        <Select name="trigger" value={key} onChange={(e) => setKey(e.target.value)} required>
          {triggers.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label.replace("N%", "a set score")}
            </option>
          ))}
        </Select>
      </Field>
      {current?.needsScore && (
        <Field label="Minimum score (%)" hint="Students at or above this score earn the XP.">
          <Input name="minScore" type="number" inputMode="numeric" min={1} max={100} step={1} defaultValue={80} required />
        </Field>
      )}
    </>
  );
}
