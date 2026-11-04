"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Select } from "@/components/ui";
import { addRoleAction } from "../actions";

/**
 * "Add role" on a Zinny team member. It starts on "Pick a role", so nobody gets a role by a
 * stray click, and asks before making someone a Super Admin.
 */
export function AddRoleForm({ userId, name, choices }: { userId: string; name: string; choices: { value: string; label: string }[] }) {
  const [role, setRole] = useState("");
  return (
    <ActionForm
      action={addRoleAction}
      className="flex gap-2"
      confirm={role === "super_admin" ? `Make ${name} a Super Admin? They will be able to do everything, including managing the Zinny team.` : undefined}
    >
      <input type="hidden" name="userId" value={userId} />
      <Select name="role" value={role} onChange={(e) => setRole(e.target.value)} required aria-label={`Role to give ${name}`} className="h-8 w-44 text-[13px]">
        <option value="" disabled>
          Pick a role
        </option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Select>
      <SubmitButton size="sm" variant="secondary" pendingText="Adding…">
        Add role
      </SubmitButton>
    </ActionForm>
  );
}
