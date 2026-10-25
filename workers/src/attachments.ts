import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

/**
 * Comment attachments have to be real files: both Facebook's composer and the
 * fixture page consume `input[type=file]`. Review images live on a marketplace
 * CDN, so the worker downloads once per task into a temp file and deletes it
 * afterwards.
 */
export type Attachment = {
  path: string;
  dispose(): Promise<void>;
};

const MAX_BYTES = 8 * 1024 * 1024;

export async function downloadAttachment(url: string): Promise<Attachment> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Could not download the review image (HTTP ${response.status}): ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) throw new Error(`Review image is empty: ${url}`);
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(`Review image is larger than ${MAX_BYTES / 1024 / 1024}MB: ${url}`);
  }

  const directory = join(tmpdir(), "affiliate-worker-attachments");
  await mkdir(directory, { recursive: true });

  const extension = pickExtension(url, response.headers.get("content-type"));
  const name = createHash("sha1").update(url).digest("hex").slice(0, 16);
  const path = join(directory, `${name}${extension}`);
  await writeFile(path, buffer);

  return {
    path,
    dispose: async () => {
      await rm(path, { force: true });
    }
  };
}

function pickExtension(url: string, contentType: string | null): string {
  const fromUrl = extname(new URL(url).pathname).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(fromUrl)) return fromUrl;

  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("webp")) return ".webp";
  if (contentType?.includes("gif")) return ".gif";

  return ".jpg";
}
