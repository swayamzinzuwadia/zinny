"use client";

import { useEffect, useRef, useState } from "react";
import { Field, Input, Select } from "@/components/ui";

type Choice = { value: string; label: string };

/**
 * The role of a new member of staff, and what that role needs. Teaching roles belong to a
 * department (and visiting faculty to an end date); administration roles cover the whole
 * institute, so those two fields only show, and are only sent, for a teaching role.
 */
export function StaffRoleFields({ teaching, administration, departments }: { teaching: Choice[]; administration: Choice[]; departments: { id: string; name: string }[] }) {
  const first = teaching[0]?.value ?? administration[0]?.value ?? "";
  const [role, setRole] = useState(first);
  const box = useRef<HTMLDivElement>(null);
  const isTeaching = teaching.some((t) => t.value === role);

  // After the form adds someone it resets: go back to the first role with it.
  useEffect(() => {
    const form = box.current?.closest("form");
    if (!form) return;
    const back = () => setRole(first);
    form.addEventListener("reset", back);
    return () => form.removeEventListener("reset", back);
  }, [first]);

  return (
    <div
      ref={box}
      className="space-y-4"
      onChange={(e) => {
        const field: EventTarget = e.target;
        if (field instanceof HTMLSelectElement && field.name === "role") setRole(field.value);
      }}
    >
      <Field label="Role">
        <Select name="role" defaultValue={first}>
          {teaching.length > 0 && (
            <optgroup label="Teaching">
              {teaching.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          )}
          {administration.length > 0 && (
            <optgroup label="Administration">
              {administration.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
      </Field>
      {isTeaching && (
        <>
          <Field label="Department">
            <Select name="departmentId" required>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Access ends" hint="Required for visiting faculty.">
            <Input name="endsAt" type="date" />
          </Field>
        </>
      )}
    </div>
  );
}
