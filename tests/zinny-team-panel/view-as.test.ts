import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, departments } from "@/db/schema";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { withTenant } from "@/server/tenant";
import { startViewAs, stopViewAs } from "@/modules/zinny-team-panel/services/view-as";
import { setupCourse } from "../fixtures";
import { team } from "./helpers";

afterAll(() => closeDb());

describe("view as student", () => {
  it("is for Super Admins only", async () => {
    const agent = await team("Sid Support", "support_agent");
    const { uni, student } = await setupCourse({ name: "Viewed Institute" });
    const riya = await student("Riya Sharma");
    await expect(startViewAs(agent, uni.id, riya.userId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only opens learners, and logs the start and stop in the institute's own log", async () => {
    const boss = await team("Zara Super", "super_admin");
    const { uni, admin, student } = await setupCourse({ name: "Logged Institute" });
    const riya = await student("Riya Sharma");

    await expect(startViewAs(boss, uni.id, admin.userId)).rejects.toBeInstanceOf(ValidationError);

    expect((await startViewAs(boss, uni.id, riya.userId)).slug).toBe(uni.slug);
    await stopViewAs(boss, uni.id, riya.userId);
    const log = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.universityId, uni.id), eq(auditLog.actorUserId, boss.userId)));
    expect(log.map((l) => l.action).sort()).toEqual(["plat.view_as.start", "plat.view_as.stop"]);
  });

  it("rolls back anything written while viewing, and still returns the result", async () => {
    const { admin, dept } = await setupCourse({ name: "Read Only Institute" });
    const viewed = { ...admin, viewedBy: { userId: "viewer", name: "Zara" } };

    const out = await withTenant(viewed, async (tx) => {
      await tx.update(departments).set({ name: "Should not stay" }).where(eq(departments.id, dept.id));
      return "done";
    });

    expect(out).toBe("done");
    const [after] = await systemDb().select().from(departments).where(eq(departments.id, dept.id));
    expect(after.name).toBe(dept.name);
  });
});
