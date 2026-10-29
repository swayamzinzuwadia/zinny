/**
 * The emails and texts identity sends. Plain text first (it's what most people read on a
 * phone), with a simple HTML version in brand colours. Every link is a full URL.
 */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** "5 Nov 2026, 6:30 pm" in the given time zone. */
export function formatWhen(d: Date, timeZone = "Asia/Kolkata"): string {
  const date = new Intl.DateTimeFormat("en-IN", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(d).toLowerCase();
  return `${date}, ${time}`;
}

function layout(o: { heading: string; paragraphs: string[]; button?: { label: string; url: string }; after?: string[]; footer: string }) {
  const p = (t: string) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#14261f">${t}</p>`;
  const button = o.button
    ? `<p style="margin:24px 0"><a href="${esc(o.button.url)}" style="display:inline-block;background:#0b5e4c;color:#faf6ea;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px">${esc(o.button.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#5d6b64">Or copy this link into your browser:<br><span style="word-break:break-all;color:#0b5e4c">${esc(o.button.url)}</span></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#faf6ea;font-family:Lexend,'Segoe UI',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ea;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffdf7;border:1px solid #e8e0cc;border-radius:22px;padding:32px">
<tr><td>
<p style="margin:0 0 24px;font-size:18px;font-weight:600;color:#0b5e4c">zinny</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#14261f">${esc(o.heading)}</h1>
${o.paragraphs.map(p).join("")}
${button}
${(o.after ?? []).map(p).join("")}
<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#98a39d">${o.footer}</p>
</td></tr></table></td></tr></table></body></html>`;
}

export function inviteEmail(o: { name: string; institute: string; roleLabel: string; url: string; expiresAt: Date; timeZone: string }) {
  const first = o.name.split(/\s+/)[0] || o.name;
  const when = formatWhen(o.expiresAt, o.timeZone);
  const subject = `Join ${o.institute} on Zinny`;
  const text = [
    `Hello ${first},`,
    "",
    `${o.institute} has invited you to Zinny as ${o.roleLabel}.`,
    "",
    "Set your password to sign in:",
    o.url,
    "",
    `This link works once and expires on ${when}. If it has expired, ask ${o.institute} to send a new invitation.`,
    "",
    "If you weren't expecting this email, you can ignore it.",
  ].join("\n");
  const html = layout({
    heading: `Join ${o.institute} on Zinny`,
    paragraphs: [`Hello ${esc(first)},`, `${esc(o.institute)} has invited you to Zinny as ${esc(o.roleLabel)}. Set your password to sign in.`],
    button: { label: "Set your password", url: o.url },
    after: [`This link works once and expires on ${esc(when)}. If it has expired, ask ${esc(o.institute)} to send a new invitation.`],
    footer: "If you weren't expecting this email, you can ignore it.",
  });
  return { subject, text, html };
}

export function resetEmail(o: { name: string; url: string; validMinutes: number }) {
  const first = o.name.split(/\s+/)[0] || o.name;
  const subject = "Reset your Zinny password";
  const text = [
    `Hello ${first},`,
    "",
    "Someone asked to reset the password for your Zinny account. To choose a new password, open this link:",
    o.url,
    "",
    `The link works once and expires in ${o.validMinutes} minutes. Setting a new password signs you out on every other device.`,
    "",
    "If you didn't ask for this, ignore this email. Your password stays the same.",
  ].join("\n");
  const html = layout({
    heading: "Reset your password",
    paragraphs: [`Hello ${esc(first)},`, "Someone asked to reset the password for your Zinny account. Choose a new password with the button below."],
    button: { label: "Choose a new password", url: o.url },
    after: [`The link works once and expires in ${o.validMinutes} minutes. Setting a new password signs you out on every other device.`],
    footer: "If you didn't ask for this, ignore this email. Your password stays the same.",
  });
  return { subject, text, html };
}

export function passwordChangedEmail(o: { name: string; when: Date; how: "reset" | "profile"; resetUrl: string }) {
  const first = o.name.split(/\s+/)[0] || o.name;
  const when = formatWhen(o.when);
  const subject = "Your Zinny password was changed";
  const how = o.how === "reset" ? "with a password reset link" : "from your profile";
  const text = [
    `Hello ${first},`,
    "",
    `Your Zinny password was changed ${how} on ${when} (India time). Other devices were signed out.`,
    "",
    `If this wasn't you, reset your password now: ${o.resetUrl}`,
    "Then tell your institute's admin.",
  ].join("\n");
  const html = layout({
    heading: "Your password was changed",
    paragraphs: [`Hello ${esc(first)},`, `Your Zinny password was changed ${how} on ${esc(when)} (India time). Other devices were signed out.`],
    after: [`If this wasn't you, <a href="${esc(o.resetUrl)}" style="color:#0b5e4c">reset your password now</a>, then tell your institute's admin.`],
    footer: "You get this email whenever your password changes.",
  });
  return { subject, text, html };
}

export function signInCodeSms(o: { code: string; institute: string; validMinutes: number }) {
  return `${o.code} is your Zinny sign-in code for ${o.institute}. It expires in ${o.validMinutes} minutes. Never share it with anyone.`;
}

export function verifyPhoneSms(o: { code: string; validMinutes: number }) {
  return `${o.code} is your Zinny code to confirm this mobile number. It expires in ${o.validMinutes} minutes. Never share it with anyone.`;
}
