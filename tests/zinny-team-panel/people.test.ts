import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog } from "@/db/schema";
import { ForbiddenError } from "@/server/errors";
import { listPeople, peopleCounts, personDetail } from "@/modules/zinny-team-panel/services/people";
import { setupCourse } from "../fixtures";
import { team } from "./helpers";

afterAll(() => closeDb());

describe("the People directory", () => {
  it("is for Super Admins only, not the rest of the Zinny team", async () => {
    const agent = await team("Sid Support", "support_agent");
    const manager = await team("Mira Manager", "account_manager");
    for (const a of [agent, manager]) {
      await expect(listPeople(a, {})).rejects.toBeInstanceOf(ForbiddenError);
      await expect(peopleCounts(a)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(personDetail(a, a.userId)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("lists people from one institute at a time, and logs the view", async () => {
    const boss = await team("Zara Super", "super_admin");
    const { uni } = await setupCourse({ name: "Second Institute" });

    const only = await listPeople(boss, { universityId: uni.id });
    expect(only.rows.length).toBeGreaterThan(0);
    expect(only.rows.every((r) => r.universityId === uni.id)).toBe(true);

    const log = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.actorUserId, boss.userId), eq(auditLog.action, "plat.people.view")));
    expect(log).toHaveLength(1);
  });

  it("shows a person's details without their password, and logs it in their institute", async () => {
    const boss = await team("Zara Super", "super_admin");
    const { uni, admin } = await setupCourse({ name: "Third Institute" });

    const detail = await personDetail(boss, admin.userId);
    expect(detail.roles.map((r) => r.universityId)).toContain(uni.id);
    expect(JSON.stringify(detail)).not.toContain("passwordHash");

    const log = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.universityId, uni.id), eq(auditLog.action, "plat.person.view"), eq(auditLog.actorUserId, boss.userId)));
    expect(log).toHaveLength(1);
  });
});
