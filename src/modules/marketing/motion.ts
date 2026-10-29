/** Every duration, easing, distance and spring the landing page uses. No inline numbers in components. */
export const motionTokens = {
  duration: { instant: 0.08, fast: 0.18, normal: 0.35, slow: 0.6, crawl: 1.0, glide: 1.6 },
  easing: {
    smooth: [0.22, 1, 0.36, 1] as const,
    sharp: [0.4, 0, 0.2, 1] as const,
    linear: [0, 0, 1, 1] as const,
  },
  distance: { xs: 4, sm: 8, md: 16, lg: 24, xl: 48 },
  scale: { subtle: 0.98, press: 0.96, pop: 1.02 },
  stagger: { tight: 0.05, normal: 0.08 },
};

export const springs = {
  snappy: { type: "spring", stiffness: 300, damping: 30 },
  gentle: { type: "spring", stiffness: 120, damping: 18 },
  release: { type: "spring", stiffness: 200, damping: 20, restDelta: 0.001 },
} as const;

/** Fade and rise used for every scroll reveal. */
export const rise = {
  hidden: { opacity: 0, y: motionTokens.distance.lg },
  shown: {
    opacity: 1,
    y: 0,
    transition: { duration: motionTokens.duration.slow, ease: motionTokens.easing.smooth },
  },
};
