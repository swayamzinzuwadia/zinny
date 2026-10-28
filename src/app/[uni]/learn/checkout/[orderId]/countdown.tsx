"use client";

import { useEffect, useState } from "react";

export function Countdown({ until }: { until: string }) {
  const [left, setLeft] = useState(() => Math.max(0, Date.parse(until) - Date.now()));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Date.parse(until) - Date.now())), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (left === 0) return <span className="text-danger">Your hold has run out. You can still pay if a seat is free.</span>;
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return (
    <span>
      Seat held for <b className="tabular-nums">{m}:{String(s).padStart(2, "0")}</b>
    </span>
  );
}
