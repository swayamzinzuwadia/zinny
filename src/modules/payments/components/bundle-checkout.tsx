"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui";
import { abandonBundleAction, verifyBundleAction } from "../bundle-actions";
import type { RazorpayCheckoutOptions } from "../checkout";
import { loadScript } from "./razorpay-checkout";

type SuccessResponse = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type FailureResponse = { error?: { code?: string; description?: string } };

/** Razorpay Checkout for a whole cart: one payment, then every course in it is confirmed. */
export function BundleCheckout({ bundleId, label, scriptUrl, options }: { bundleId: string; label: string; scriptUrl: string; options: RazorpayCheckoutOptions }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<null | "verifying" | "opening">(null);
  const [error, setError] = useState<string | null>(null);
  const succeeded = useRef(false);

  useEffect(() => {
    let live = true;
    loadScript(scriptUrl)
      .then(() => live && setReady(true))
      .catch(() => live && setError("Razorpay couldn't load. Check your internet connection, then refresh this page."));
    return () => {
      live = false;
    };
  }, [scriptUrl]);

  function open() {
    if (!window.Razorpay) return;
    setError(null);
    setBusy("opening");
    const rzp = new window.Razorpay({
      ...options,
      handler: async (r: SuccessResponse) => {
        succeeded.current = true;
        setBusy("verifying");
        const res = await verifyBundleAction({ bundleId, ...r });
        if (res.ok) {
          router.replace(res.next ?? "/marketplace/library?bought=1");
          router.refresh();
        } else {
          setBusy(null);
          setError(res.error);
        }
      },
      modal: {
        confirm_close: true,
        escape: false,
        ondismiss: async () => {
          if (succeeded.current) return;
          setBusy(null);
          await abandonBundleAction({ bundleId });
          router.refresh();
        },
      },
    });
    rzp.on("payment.failed", (r: FailureResponse) => {
      setError(`${r.error?.description ?? "The payment failed."} Try again with another method, or close the window.`);
    });
    rzp.open();
    setBusy(null);
  }

  return (
    <div>
      <button type="button" onClick={open} disabled={!ready || busy !== null} className={buttonClass("primary") + " w-full"}>
        {busy === "verifying" ? "Confirming your payment…" : !ready && !error ? "Loading secure checkout…" : label}
      </button>
      {error && (
        <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
