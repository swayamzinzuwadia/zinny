/** "1" collapsed, "0" expanded, "auto" no choice yet (a rail on tablets, open on wide screens). */
export type SidebarMode = "1" | "0" | "auto";

/** Reads a stored mode from a cookie value. Anything unknown means "auto". A plain module, so server layouts can call it. */
export function modeFromCookie(value: string | undefined): SidebarMode {
  return value === "1" || value === "0" ? value : "auto";
}
