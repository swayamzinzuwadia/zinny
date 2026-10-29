/**
 * Browser-side upload helper: large photos are scaled down before they are sent (phones
 * produce 10+ MB images), then posted to the Website section's upload route.
 */
import type { MediaKind } from "../schema";

export type Uploaded = { id: string; src: string; width: number; height: number };

const MAX_SIDE = 3200;
const SEND_AS_IS_BYTES = 3.5 * 1024 * 1024;

async function shrink(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || typeof createImageBitmap !== "function") return file;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size <= SEND_AS_IS_BYTES) {
    bmp.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  return blob && blob.size < file.size ? blob : file;
}

export async function uploadImage(uni: string, kind: MediaKind, file: File, alt = ""): Promise<Uploaded> {
  if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|avif|gif|heic|heif)$/i.test(file.name)) {
    throw new Error(`${file.name} isn't an image. Upload a JPG, PNG or WebP picture.`);
  }
  const body = new FormData();
  body.set("file", await shrink(file), file.name);
  body.set("alt", alt);
  let res: Response;
  try {
    res = await fetch(`/${uni}/admin/website/upload?kind=${kind}`, { method: "POST", body, credentials: "same-origin" });
  } catch {
    throw new Error("The upload didn't go through. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => null)) as (Partial<Uploaded> & { error?: string }) | null;
  if (!data) throw new Error(res.redirected ? "Your session has ended. Sign in again, then upload the image." : "The upload failed. Try again in a moment.");
  if (!res.ok || !data.id) throw new Error(data.error ?? "The upload failed. Try again in a moment.");
  return data as Uploaded;
}
