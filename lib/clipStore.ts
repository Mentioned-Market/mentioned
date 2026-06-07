// Server-side read access to mention audio clips stored in the S3-compatible
// bucket (Railway Storage Bucket) by the transcript worker. The bucket is
// private; we hand the browser a short-lived presigned GET URL rather than
// proxying bytes, so playback comes straight from the bucket (free bucket
// egress, no Next.js egress).
//
// Server-only — never import from a client component (pulls in the AWS SDK).

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const bucket = process.env.S3_BUCKET ?? ''
const endpoint = process.env.S3_ENDPOINT ?? ''
const region = process.env.S3_REGION ?? 'us-east-1'
const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? ''
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? ''

const configured = !!bucket && !!endpoint && !!accessKeyId && !!secretAccessKey

// Presigned-link lifetime. Short — links are minted on demand per playback.
const PRESIGN_EXPIRES_S = 5 * 60

let client: S3Client | null = null

export function isClipStoreConfigured(): boolean {
  return configured
}

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region,
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    })
  }
  return client
}

/** Mint a short-lived presigned GET URL for a clip object key. */
export async function presignClipUrl(key: string): Promise<string | null> {
  if (!configured) return null
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: PRESIGN_EXPIRES_S },
  )
}
