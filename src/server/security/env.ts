/**
 * Secrets production can't run safely without. Several modules fall back to a development
 * constant when a secret is missing (phone-code HMACs, signed file links), which is fine on
 * a laptop and unsafe on the internet. In production the proxy refuses every request with a
 * plain 503 until they are set, so a deployment that forgot one fails closed instead of
 * quietly using a value anyone can read in the source.
 *
 * Plain module: no Node or Next imports.
 */

type Env = Record<string, string | undefined>;

export type SecretProblem = { name: string; problem: string };

/** Long enough to resist guessing: 32 characters (`openssl rand -base64 48` gives 64). */
const MIN_SECRET_LENGTH = 32;

function longSecret(env: Env, name: string, why: string): SecretProblem | null {
  const v = env[name]?.trim() ?? "";
  if (!v) return { name, problem: `missing (${why})` };
  if (v.length < MIN_SECRET_LENGTH) return { name, problem: `shorter than ${MIN_SECRET_LENGTH} characters` };
  return null;
}

/** 32 bytes as 64 hex characters or base64, like src/modules/onboarding/lib/crypto.ts reads it. */
function kycKeyProblem(raw: string): string | null {
  if (/^[0-9a-f]{64}$/i.test(raw)) return null;
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) return "not hex or base64";
  const len = raw.replace(/=+$/, "").length;
  return Math.floor((len * 3) / 4) === 32 ? null : "not 32 bytes";
}

/** Whether the production checks apply: a production server (`next start`, Vercel). */
export function isProductionServer(env: Env): boolean {
  return env.NODE_ENV === "production";
}

/** What's missing or too weak. Empty means production may serve requests. */
export function productionSecretProblems(env: Env): SecretProblem[] {
  const out: SecretProblem[] = [];
  const auth = longSecret(env, "AUTH_SECRET", "keys the phone sign-in code HMACs");
  if (auth) out.push(auth);
  const cron = longSecret(env, "CRON_SECRET", "authenticates the scheduled jobs; also signs file links and unsubscribe links when their own secrets aren't set");
  if (cron) out.push(cron);

  // Student PAN numbers are encrypted with it. A demo deployment (ZINNY_DEMO=1) holds no real
  // KYC data and may use the development key, as src/modules/onboarding/lib/crypto.ts allows.
  const kyc = env.KYC_ENCRYPTION_KEY?.trim() ?? "";
  if (kyc) {
    const p = kycKeyProblem(kyc);
    if (p) out.push({ name: "KYC_ENCRYPTION_KEY", problem: p });
  } else if (env.ZINNY_DEMO !== "1") {
    out.push({ name: "KYC_ENCRYPTION_KEY", problem: "missing (encrypts student PAN numbers)" });
  }

  // With live Razorpay keys, webhooks must be verifiable or paid orders never confirm.
  if (env.RAZORPAY_KEY_ID?.trim() && !env.RAZORPAY_WEBHOOK_SECRET?.trim()) {
    out.push({ name: "RAZORPAY_WEBHOOK_SECRET", problem: "missing while RAZORPAY_KEY_ID is set (verifies Razorpay webhooks)" });
  }
  return out;
}
