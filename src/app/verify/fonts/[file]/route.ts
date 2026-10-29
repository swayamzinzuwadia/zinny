import { fontByFile, fontBytes } from "@/modules/certificates/render/fonts";

/**
 * The certificate fonts (OFL-licensed Lexend and Libre Baskerville), so on-screen
 * certificates and the live preview use the same type as the PDF.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const key = fontByFile(file);
  if (!key) return new Response("not found", { status: 404 });
  const bytes = await fontBytes(key);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "font/ttf",
      "content-length": String(bytes.length),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
