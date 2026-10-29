"use client";

import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motionTokens } from "../motion";

/**
 * A number that counts up when it first scrolls into view. The server renders the final
 * value, so it reads correctly without JavaScript and with reduced motion.
 */
export function CountUp({
  to,
  prefix = "",
  suffix = "",
  decimals = 0,
  className,
}: {
  to: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const [value, setValue] = useState(to);
  const started = useRef(false);

  // Before the first paint on the client, park the number at zero so it can count up.
  useLayoutEffect(() => {
    if (!reduce && !started.current) setValue(0);
  }, [reduce]);

  useEffect(() => {
    if (!inView || reduce || started.current) return;
    started.current = true;
    const controls = animate(0, to, {
      duration: motionTokens.duration.glide,
      ease: motionTokens.easing.smooth,
      onUpdate: setValue,
    });
    return () => controls.stop();
  }, [inView, reduce, to]);

  const text = value.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <span ref={ref} className={`tabular ${className ?? ""}`}>
      {prefix}
      {text}
      {suffix}
    </span>
  );
}
