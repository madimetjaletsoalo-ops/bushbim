// Short-lived signed tokens for uploads and local-storage transfers.
// The server issues one per file before the browser uploads it, and only
// accepts the upload back (completeUpload) with a valid, unexpired token,
// so a client can't attach arbitrary objects or someone else's folder.
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";

export const uploadClaims = z.object({
  typ: z.literal("upload"),
  pid: z.string(), // project
  fid: z.string(), // folder
  uid: z.string(), // uploader
  key: z.string(), // storage key
  name: z.string(),
  size: z.number().int().nonnegative(),
  ct: z.string(),
});
export type UploadClaims = z.infer<typeof uploadClaims>;

/** Local-disk storage transfer (used when no S3 bucket is configured). */
export const transferClaims = z.object({
  typ: z.literal("transfer"),
  op: z.enum(["put", "get"]),
  key: z.string(),
  /** put: maximum bytes accepted */
  max: z.number().int().nonnegative().optional(),
  /** get: download file name and type */
  fn: z.string().optional(),
  ct: z.string().optional(),
  /** get: display in the browser instead of downloading */
  inline: z.boolean().optional(),
});
export type TransferClaims = z.infer<typeof transferClaims>;

export function secretBytes(s = process.env.SESSION_SECRET): Uint8Array {
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

export async function signToken(claims: UploadClaims | TransferClaims, secret: Uint8Array, ttlSeconds: number) {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret);
}

export async function verifyToken<S extends z.ZodTypeAny>(token: string, schema: S, secret: Uint8Array): Promise<z.infer<S> | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    const parsed = schema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
