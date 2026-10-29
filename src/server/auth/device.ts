/** A short, human name for a browser from its user agent: "Chrome on Android". */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  if (!ua) return "Unknown device";
  const browser =
    /EdgA?\//.test(ua) ? "Edge"
    : /SamsungBrowser\//.test(ua) ? "Samsung Internet"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox\/|FxiOS\//.test(ua) ? "Firefox"
    : /CriOS\/|Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) && /Version\//.test(ua) ? "Safari"
    : /HeadlessChrome/.test(ua) ? "Chrome"
    : /curl|python|node|axios|bot/i.test(ua) ? "Script"
    : "Browser";
  const os =
    /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /CrOS/.test(ua) ? "ChromeOS"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac"
    : /Linux/.test(ua) ? "Linux"
    : null;
  return os ? `${browser} on ${os}` : browser;
}

/** "Phone code", "Password" … for the sessions list. */
export const METHOD_LABEL: Record<string, string> = {
  password: "Password",
  phone: "Phone code",
  invite: "Invitation link",
  reset: "Password reset",
  demo: "Demo account",
};
