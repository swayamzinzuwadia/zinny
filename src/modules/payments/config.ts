/**
 * Environment for payments (documented in ENV.md). Read lazily, so tests and the dev
 * server pick up changes without a restart of the module registry.
 */
import { razorpayGateway, type RazorpayGateway } from "./razorpay";

let cached: { key: string; gateway: RazorpayGateway | null } | null = null;

/**
 * The Razorpay gateway when RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set, otherwise
 * null (core then keeps its mock gateway). RAZORPAY_WEBHOOK_SECRET is needed for
 * webhooks; without it every webhook is rejected.
 */
export function razorpayFromEnv(env: NodeJS.ProcessEnv = process.env): RazorpayGateway | null {
  const keyId = env.RAZORPAY_KEY_ID?.trim() ?? "";
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim() ?? "";
  const webhookSecret = env.RAZORPAY_WEBHOOK_SECRET?.trim() ?? "";
  const apiBase = env.RAZORPAY_API_BASE?.trim() || undefined;
  const key = [keyId, keySecret, webhookSecret, apiBase].join("|");
  if (cached && cached.key === key) return cached.gateway;
  const gateway = keyId && keySecret ? razorpayGateway({ keyId, keySecret, webhookSecret, apiBase }) : null;
  cached = { key, gateway };
  return gateway;
}

/**
 * The test-mode "Pay" button (mock gateway only). Always on in development and tests;
 * in production only for demo deployments (ZINNY_DEMO=1), so a live space without keys
 * can never take free enrolments.
 */
export function testModeAllowed(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV !== "production" || env.ZINNY_DEMO === "1";
}

/** Public address of the app, for links in emails. Same rule as identity and notifications-delivery. */
export function appUrl(env: NodeJS.ProcessEnv = process.env) {
  const explicit = env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return `http://localhost:${env.PORT || "3000"}`;
}

/** Default SAC code: 999293, commercial training and coaching services. Universities confirm theirs with a CA. */
export const DEFAULT_SAC = "999293";
