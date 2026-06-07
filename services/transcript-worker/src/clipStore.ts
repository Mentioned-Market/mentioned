// Upload of mention audio clips to an S3-compatible object store (Railway
// Storage Buckets). Private bucket; the Next.js admin side serves clips via
// short-lived presigned GET URLs. This module only writes.
//
// Fully optional: when CLIP_CAPTURE_ENABLED !== 'true' or the bucket isn't
// configured, isClipStoreEnabled() returns false and the worker never touches
// the ring buffer or this module — zero overhead, and local dev needs no bucket.

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { log } from './log'

const enabled = process.env.CLIP_CAPTURE_ENABLED === 'true'
const bucket = process.env.S3_BUCKET ?? ''
const endpoint = process.env.S3_ENDPOINT ?? ''
const region = process.env.S3_REGION ?? 'us-east-1'
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? ''
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? ''

const configured = enabled && !!bucket && !!endpoint && !!accessKeyId && !!secretAccessKey

let client: S3Client | null = null

export function isClipStoreEnabled(): boolean {
  return configured
}

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region,
      endpoint,
      // Railway / most S3-compatible stores need path-style addressing.
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    })
  }
  return client
}

/** Deterministic, collision-free key. mention_id is the word_mentions PK. */
export function clipKeyFor(streamId: number, mentionId: number): string {
  return `clips/${streamId}/${mentionId}.wav`
}

/**
 * Upload a WAV clip. Resolves true on success, false on any failure — callers
 * treat clips as best-effort and must never let a failure here disrupt the
 * mention pipeline.
 */
export async function putClip(key: string, wav: Buffer): Promise<boolean> {
  if (!configured) return false
  try {
    await getClient().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: wav,
        ContentType: 'audio/wav',
      }),
    )
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn('clip upload failed', { key, err: msg })
    return false
  }
}

if (enabled && !configured) {
  log.warn('CLIP_CAPTURE_ENABLED=true but S3 is not fully configured; clip capture disabled', {
    hasBucket: !!bucket,
    hasEndpoint: !!endpoint,
    hasKey: !!accessKeyId,
    hasSecret: !!secretAccessKey,
  })
}
