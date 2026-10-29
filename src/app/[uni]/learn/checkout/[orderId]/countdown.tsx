"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * The seat-hold countdown. Starts ticking only in the browser, so the server and client
 * render the same first frame; refreshes the page once when the hold runs out.
 */
export function Countdown({ until }: { until: string }) {
  const router = useRouter();
  const [left, setLeft] = useState<number | null>(null);
  const refreshed = useRef(false);
  useEffect(() => {
    const tick = () => {
      const ms = Math.max(0, Date.parse(until) - Date.now());
      setLeft(ms);
      if (ms === 0 && !refreshed.current) {
        refreshed.current = true;
        router.refresh();
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [until, router]);
  if (left === null) return <span>Your seat is held for 10 minutes.</span>;
  if (left === 0) return <span>Your seat hold has run out. You can still pay if a seat is free.</span>;
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return (
    <span aria-live="off">
      Your seat is held for{" "}
      <b className="tabular">
        {m}:{String(s).padStart(2, "0")}
      </b>
    </span>
  );
}
