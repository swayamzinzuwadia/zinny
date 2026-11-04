import QRCode from "qrcode";
import { appUrl } from "@/server/auth/config";

/**
 * Sharing an institute's joining code: the sign-up link that carries it, the message staff send
 * with it, and the QR code on the printable poster.
 */

export function joinLink(code: string) {
  return `${appUrl()}/signup?code=${encodeURIComponent(code)}`;
}

/** What staff send to students: on WhatsApp, the phone's share sheet, or pasted anywhere. */
export function joinMessage(institute: string, link: string, code: string) {
  return `Join ${institute} on Zinny. Create your student account here: ${link}\nJoining code: ${code}`;
}

/** WhatsApp with the message ready to send; the person picks who gets it. */
export function whatsAppShareHref(message: string) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/** The sign-up link as an SVG QR code, in brand green on a clear background. */
export function joinQrSvg(link: string) {
  return QRCode.toString(link, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#063a2fff", light: "#00000000" } });
}
