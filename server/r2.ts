import "dotenv/config";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 (S3-compatible) storage for videos and video posters.
//
// Two buckets, because a bucket with a public custom domain exposes every object in it:
//   - "private" (R2_BUCKET): never public. Used for followers-only and close-friends videos.
//     Playback goes through /api/media/video/:id, which checks visibility and redirects to a presigned URL.
//   - "public" (R2_PUBLIC_BUCKET + R2_PUBLIC_BASE_URL): its custom domain serves public videos from
//     Cloudflare's edge, so they play fast with range requests and caching.
//
// Browsers upload straight to R2 with presigned PUT URLs, so video bytes never pass through this server.

export type Storage = "public" | "private";

const accountId = process.env.R2_ACCOUNT_ID || "";
const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || "";
const privateBucket = process.env.R2_BUCKET || "";
const publicBucket = process.env.R2_PUBLIC_BUCKET || "";
const publicBase = (process.env.R2_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");

export const r2Configured = Boolean(accountId && accessKeyId && secretAccessKey && privateBucket);
// Public playback needs the public bucket and its custom domain; without both, public videos are served privately.
export const publicStorageConfigured = Boolean(r2Configured && publicBucket && publicBase);

// Public posts use public storage when it is configured. Everything else stays private.
export function storageFor(visibility: string): Storage {
  return visibility === "public" && publicStorageConfigured ? "public" : "private";
}

const bucketFor = (storage: Storage) => (storage === "public" ? publicBucket : privateBucket);

const client = r2Configured
  ? new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // R2 rejects the default CRC checksums that newer SDK versions add to presigned uploads.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
  })
  : null;

function requireClient() {
  if (!client) throw new Error("Cloudflare R2 が設定されていません。");
  return client;
}

// CDN URL for an object in public storage. Only ever called for public storage.
export function publicUrlFor(key: string): string | null {
  return publicStorageConfigured ? `${publicBase}/${key}` : null;
}

export async function presignPut(storage: Storage, key: string, contentType: string, cacheControl: string, expiresIn = 900): Promise<string> {
  const command = new PutObjectCommand({ Bucket: bucketFor(storage), Key: key, ContentType: contentType, CacheControl: cacheControl });
  return getSignedUrl(requireClient(), command, { expiresIn });
}

export async function presignGet(storage: Storage, key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(requireClient(), new GetObjectCommand({ Bucket: bucketFor(storage), Key: key }), { expiresIn });
}

// Size and type of a stored object, or null when it does not exist.
export async function headObject(storage: Storage, key: string): Promise<{ size: number; contentType: string } | null> {
  try {
    const head = await requireClient().send(new HeadObjectCommand({ Bucket: bucketFor(storage), Key: key }));
    return { size: Number(head.ContentLength ?? 0), contentType: String(head.ContentType ?? "") };
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

// The first `bytes` bytes of an object, used to check the file signature after upload.
export async function readHead(storage: Storage, key: string, bytes: number): Promise<Buffer> {
  const result = await requireClient().send(new GetObjectCommand({ Bucket: bucketFor(storage), Key: key, Range: `bytes=0-${bytes - 1}` }));
  if (!result.Body) return Buffer.alloc(0);
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function deleteObject(storage: Storage, key: string): Promise<void> {
  await requireClient().send(new DeleteObjectCommand({ Bucket: bucketFor(storage), Key: key }));
}
