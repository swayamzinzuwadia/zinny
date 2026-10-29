import { after } from "next/server";

export type Defer = (task: () => Promise<void>) => void;

/**
 * Runs `task` after the response has been sent (Next `after`), so how long it takes can't
 * be measured by the caller. Outside a request (scripts) it runs in the background.
 * Errors are logged, never thrown.
 */
export const deferAfterResponse: Defer = (task) => {
  const safe = async () => {
    try {
      await task();
    } catch (e) {
      console.error("[identity] background task failed:", e);
    }
  };
  try {
    after(safe);
  } catch {
    void safe();
  }
};
