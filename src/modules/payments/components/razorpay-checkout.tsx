"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui";
import { abandonCheckoutAction, verifyRazorpayAction } from "../actions";
import type { RazorpayCheckoutOptions } from "../checkout";

type SuccessResponse = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type FailureResponse = { error?: { code?: string; description?: string; reason?: string } };
type RazorpayInstance = { open(): void; on(event: "payment.failed", cb: (r: FailureResponse) => void): void };
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let loading: Promise<void> | null = null;
function loadScript(src: string) {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error("load"));
    };
    document.body.appendChild(s);
  });
  return loading;
}

/**
 * Opens Razorpay Checkout (UPI, cards, netbanking). On success the server verifies the
 * signature and enrols; on dismiss or failure the server releases the seat.
 */
export function RazorpayCheckout({ uni, orderId, label, scriptUrl, options }: { uni: string; orderId: string; label: string; scriptUrl: string; options: RazorpayCheckoutOptions }) {
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
        const res = await verifyRazorpayAction({ uni, orderId, ...r });
        if (res.ok) {
          router.replace(res.next ?? `/${uni}/learn/timetable?enrolled=1`);
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
          await abandonCheckoutAction({ uni, orderId, reason: "dismissed" });
          router.refresh();
        },
      },
    });
    rzp.on("payment.failed", (r: FailureResponse) => {
      setError(`${r.error?.description ?? "The payment failed."} Try again with another method, or close the window.`);
      void abandonCheckoutAction({ uni, orderId, reason: "failed", code: r.error?.code, description: r.error?.description });
    });
    rzp.open();
    setBusy(null);
  }

  return (
    <div>
      <button type="button" onClick={open} disabled={!ready || busy !== null} className={buttonClass("primary") + " w-full"}>
        {busy === "verifying" ? "Confirming your payment…" : !ready && !error ? "Loading secure checkout…" : label}
      </button>
      {error && <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}
