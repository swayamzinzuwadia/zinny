import { redirect } from "next/navigation";
import { buttonClass, Field, Input } from "@/components/ui";
import { formatCode, normalizeCode } from "@/modules/certificates/lib";

type Search = Record<string, string | string[] | undefined>;

/** Enter a certificate code (from the printed certificate) to check it. */
export default async function VerifyHome({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const typed = typeof sp.code === "string" ? sp.code.trim() : "";
  if (typed) {
    const code = normalizeCode(typed);
    redirect(`/verify/${encodeURIComponent(code ? formatCode(code) : typed.slice(0, 40))}`);
  }
  return (
    <>
      <h1 className="text-[28px] font-semibold leading-tight tracking-tight">Check a certificate</h1>
      <p className="mt-2 text-[15px] text-muted">Enter the code printed on the certificate, or scan its QR code with your phone&apos;s camera.</p>
      <form method="get" action="/verify" className="mt-6 space-y-4 rounded-[22px] border border-line bg-surface p-5">
        <Field label="Certificate code" hint="12 letters and numbers, like 7K3P-9QXA-M2D4.">
          <Input name="code" required autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="7K3P-9QXA-M2D4" maxLength={40} className="font-mono uppercase" />
        </Field>
        <button type="submit" className={buttonClass("primary")}>
          Check certificate
        </button>
      </form>
    </>
  );
}
