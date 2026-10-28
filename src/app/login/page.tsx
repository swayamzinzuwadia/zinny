import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";
import { Field, Input, Logo } from "@/components/ui";
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
  ["Parents", "pallavi@demo.edu", "Parent of Riya"],
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
    const [u] = await systemDb()
      .select()
      .from(users)
      .where(inArray(users.email, [str(data, "email")]));
    if (u) {
      await startSession(u.id);
      redirect("/");
    }
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      <section className="relative hidden overflow-hidden bg-brand-deep p-12 text-canvas lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: "linear-gradient(to bottom, #faf6ea 1px, transparent 1px)", backgroundSize: "100% 28px" }}
        />
        <div className="relative">
          <Logo height={40} tone="cream" />
        </div>
        <div className="relative max-w-md">
          <p className="text-[40px] font-semibold leading-[1.1]">The AI-powered education operating system</p>
          <ul className="mt-8 space-y-3 text-[15px] text-canvas/80">
            <li className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />A private space for every institute, with its own people,
              courses and website.
            </li>
            <li className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
              Students pick the batch that fits their week.
            </li>
            <li className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
              Timetables build themselves and update when anything changes.
            </li>
          </ul>
        </div>
        <div className="relative text-[13px] text-canvas/50">Zinny</div>
      </section>

      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <Logo height={34} />
          </div>
          <h1 className="text-[30px] font-semibold leading-tight">Sign in to your institute</h1>
          <p className="mt-2 text-muted">Use the email your institute registered for you.</p>
          <ActionForm action={login} className="mt-8 space-y-4" resetOnSuccess={false}>
            <Field label="Email">
              <Input name="email" type="email" autoComplete="email" required />
            </Field>
            <Field label="Password">
              <Input name="password" type="password" autoComplete="current-password" required />
            </Field>
            <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
          </ActionForm>

          {demoEnabled() && (
            <div className="mt-12 rounded-[22px] border border-line bg-surface p-5">
              <h2 className="font-medium">Try a demo account</h2>
              <p className="mb-3 text-[13px] text-muted">Each one shows Zinny as that role sees it. Password for all: zinny123</p>
              <div className="grid gap-1">
                {DEMO.map(([group, email, label]) => (
                  <form key={email} action={demo}>
                    <input type="hidden" name="email" value={email} />
                    <button className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[14px] hover:bg-canvas">
                      <span>{label}</span>
                      <span className="text-[12px] text-faint">{group}</span>
                    </button>
                  </form>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
