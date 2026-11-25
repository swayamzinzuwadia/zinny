import { serveLocalFile } from "@/server/storage-serve";

/**
 * Serves files for the local-disk storage driver through short-lived signed URLs made by
 * storage().signedUrl(). With the S3 driver, signed URLs point at the bucket instead.
 * The checks and the safe headers are in src/server/storage-serve.ts.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  return serveLocalFile(req, key);
}
