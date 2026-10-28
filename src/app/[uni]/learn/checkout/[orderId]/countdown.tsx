"use client";

import { useEffect, useState } from "react";

/** Starts ticking only in the browser, so the server and client render the same first frame. */
export function Countdown({ until }: { until: string }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Date.parse(until) - Date.now()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [until]);
  if (left === null) return <span>Your seat is held for 10 minutes.</span>;
  if (left === 0) return <span className="text-danger">Your hold has run out. You can still pay if a seat is free.</span>;
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return (
    <span>
      Seat held for{" "}
      <b className="tabular">
        {m}:{String(s).padStart(2, "0")}
      </b>
    </span>
  );
}
