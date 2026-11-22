import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { contentDisposition } from "@/modules/docs/logic";
import { secretBytes, signToken } from "@/modules/docs/token";

// File storage for Document Control.
//
// With S3_BUCKET set, the browser uploads straight to S3/MinIO/Supabase Storage
// through presigned URLs, so file bytes never pass through the app server.
// Without it (local dev, tests) files go to STORAGE_DIR through the
// /api/storage route, using the same signed-URL flow.

const PRESIGN_TTL = 15 * 60;

export interface PresignedPut {
  url: string;
  headers: Record<string, string>;
}

export interface Storage {
  kind: "s3" | "local";
  presignPut(key: string, contentType: string, size: number): Promise<PresignedPut>;
  /** `inline` asks the browser to display rather than save the file (used by the viewer). */
  presignGet(key: string, fileName: string, contentType: string, inline?: boolean): Promise<string>;
  /** Reads a whole object on the server (used by the PDF export). */
  read(key: string): Promise<Uint8Array>;
  /** Writes a whole object from the server (used when reviews copy approved files). */
  write(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Size of a stored object, or null if it doesn't exist. */
  head(key: string): Promise<number | null>;
  remove(keys: string[]): Promise<void>;
}

function s3Storage(bucket: string): Storage {
  const client = new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1" || !!process.env.S3_ENDPOINT,
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
        : undefined,
  });
  return {
    kind: "s3",
    async presignPut(key, contentType) {
      const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
        expiresIn: PRESIGN_TTL,
      });
      return { url, headers: { "Content-Type": contentType } };
    },
    async presignGet(key, fileName, contentType, inline) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: inline ? "inline" : contentDisposition(fileName),
          ResponseContentType: contentType,
        }),
        { expiresIn: PRESIGN_TTL },
      );
    },
    async read(key) {
      const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!r.Body) throw new Error("Empty object");
      return r.Body.transformToByteArray();
    },
    async write(key, bytes, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }));
    },
    async head(key) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return r.ContentLength ?? 0;
      } catch {
        return null;
      }
    },
    async remove(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        if (chunk.length)
          await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }));
      }
    },
  };
}

export const localDir = () => path.resolve(process.env.STORAGE_DIR || path.join(process.cwd(), ".storage"));

/** Resolves a key inside the local storage directory, refusing anything that escapes it. */
export function localPath(key: string): string {
  const base = localDir();
  const p = path.resolve(base, key);
  if (!p.startsWith(base + path.sep)) throw new Error("Invalid storage key");
  return p;
}

function localStorage(): Storage {
  return {
    kind: "local",
    async presignPut(key, contentType, size) {
      const t = await signToken({ typ: "transfer", op: "put", key, max: size }, secretBytes(), PRESIGN_TTL);
      return { url: `/api/storage?t=${encodeURIComponent(t)}`, headers: { "Content-Type": contentType } };
    },
    async presignGet(key, fileName, contentType, inline) {
      const t = await signToken({ typ: "transfer", op: "get", key, fn: fileName, ct: contentType, inline }, secretBytes(), PRESIGN_TTL);
      return `/api/storage?t=${encodeURIComponent(t)}`;
    },
    async read(key) {
      return new Uint8Array(await readFile(localPath(key)));
    },
    async write(key, bytes) {
      const file = localPath(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
    },
    async head(key) {
      try {
        return (await stat(localPath(key))).size;
      } catch {
        return null;
      }
    },
    async remove(keys) {
      await Promise.all(keys.map((k) => rm(localPath(k), { force: true })));
    },
  };
}

let instance: Storage | undefined;

export function getStorage(): Storage {
  if (instance) return instance;
  const bucket = process.env.S3_BUCKET;
  if (bucket) instance = s3Storage(bucket);
  else if (process.env.VERCEL) throw new Error("File storage is not configured: set S3_BUCKET and the S3_* variables.");
  else instance = localStorage();
  return instance;
}

/** Writes a request body to local storage, stopping once it exceeds `max` bytes. Returns bytes written. */
export async function writeLocal(key: string, body: ReadableStream<Uint8Array>, max: number): Promise<number> {
  const file = localPath(key);
  await mkdir(path.dirname(file), { recursive: true });
  let written = 0;
  const source = Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>);
  const limiter = async function* (src: AsyncIterable<Buffer>) {
    for await (const chunk of src) {
      written += chunk.length;
      if (written > max) throw new Error("Upload is larger than declared");
      yield chunk;
    }
  };
  try {
    await pipeline(source, limiter, createWriteStream(file));
  } catch (e) {
    await rm(file, { force: true });
    throw e;
  }
  return written;
}

export function readLocal(key: string) {
  return Readable.toWeb(createReadStream(localPath(key))) as ReadableStream<Uint8Array>;
}
