import { loadActor } from "@/server/actor";
import { grant, makeUniversity, makeUser } from "../fixtures";

/** A university with an Institute Admin and a student, as actors. */
export async function instituteWithStudent(name = "Privacy Uni") {
  const uni = await makeUniversity(name);
  const adminUser = await makeUser("Privacy Admin");
  await grant(adminUser.id, "institute_admin", { universityId: uni.id });
  const studentUser = await makeUser("Privacy Student");
  await grant(studentUser.id, "student", { universityId: uni.id });
  return {
    uni,
    admin: await loadActor(adminUser.id, uni.id, { session: null }),
    student: await loadActor(studentUser.id, uni.id, { session: null }),
    studentUser,
  };
}

/** A Zinny team member with the given platform role, outside any university. */
export async function teamMember(role: "super_admin" | "account_manager" | "support_agent" | "content_qa") {
  const u = await makeUser(`Team ${role}`);
  await grant(u.id, role);
  return loadActor(u.id, null, { session: null });
}

/** Someone with no role anywhere: a marketplace learner. */
export async function marketplaceLearner() {
  const u = await makeUser("Market Learner");
  return { user: u, actor: await loadActor(u.id, null, { session: null }) };
}
