import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { attempt, str } from "@/server/action";
import { signIn, startSession } from "@/server/auth/session";
import { ValidationError } from "@/server/errors";

export const metadata = { title: "Sign in" };

const DEMO = [
  ["Zinny team", "zara@zinny.demo", "Super Admin"],
  ["Zinny team", "sid@zinny.demo", "Support Agent"],
  ["Administration", "asha@demo.edu", "Institute Admin"],
  ["Administration", "bharat@demo.edu", "Board / Owner"],
  ["Administration", "arun@demo.edu", "Accounts & Fees"],
  ["Teaching", "hema@demo.edu", "HOD, Computer Science"],
  ["Teaching", "farah@demo.edu", "Permanent Faculty"],
  ["Teaching", "vikram@demo.edu", "Visiting Faculty"],
  ["Students", "riya@demo.edu", "Student (PRD example week)"],
  ["Students", "kabir@demo.edu", "Student (switch pending)"],
  ["Students", "pallavi@demo.edu", "Parent of Riya"],
] as const;

const demoEnabled = () => process.env.NODE_ENV !== "production" || process.env.ZINNY_DEMO === "1";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const dest = next?.startsWith("/") ? next : "/";

  async function login(_: ActionState, data: FormData): Promise<ActionState> {
    "use server";
    let ok = false;
    const res = await attempt(async () => {
      if (!(await signIn(str(data, "email"), str(data, "password")))) throw new ValidationError("Email or password is wrong.");
      ok = true;
    });
    if (ok) redirect(dest);
    return res;
  }

  async function demo(data: FormData) {
    "use server";
    if (!demoEnabled()) return;
    const [u] = await systemDb().select().from(users).where(inArray(users.email, [str(data, "email")]));
    if (u) {
      await startSession(u.id);
      redirect("/");
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-5xl items-center gap-10 px-4 py-12 md:grid-cols-[1fr_1.1fr]">
      <section>
        <div className="mb-8 text-[22px] font-semibold tracking-tight text-brand">zinny</div>
        <h1 className="text-[32px] font-semibold leading-tight tracking-tight">Sign in to your institute</h1>
        <p className="mt-2 text-muted">Courses, batches, tests and students in one place.</p>
        <ActionForm action={login} className="mt-8 space-y-4" resetOnSuccess={false}>
          <Field label="Email">
            <Input name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Password">
            <Input name="password" type="password" autoComplete="current-password" required />
          </Field>
          <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
        </ActionForm>
      </section>

      {demoEnabled() && (
        <section className="rounded-3xl border border-line bg-surface p-6">
          <h2 className="font-semibold">Demo accounts</h2>
          <p className="mb-4 text-sm text-muted">One click to see the panel as each role. Password for all: zinny123</p>
          <div className="grid gap-1.5">
            {DEMO.map(([group, email, label]) => (
              <form key={email} action={demo}>
                <input type="hidden" name="email" value={email} />
                <button className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-canvas">
                  <span>
                    <span className="font-medium">{label}</span>
                    <span className="ml-2 text-faint">{email}</span>
                  </span>
                  <span className="text-xs text-muted">{group}</span>
                </button>
              </form>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
