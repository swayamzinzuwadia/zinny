"use client";

import { MotionConfig } from "motion/react";

/** With reduced motion on, every movement is dropped and content simply appears in place. */
export function MotionRoot({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
