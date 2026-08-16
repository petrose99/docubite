import config from "@/lib/config"
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import fs from "fs/promises"
import path from "path"

const localRoot = path.resolve(process.env.DOCUMENT_SOURCE_PATH || "./data/document-sources")
const awsS3 = new S3Client({ region: config.aws.region })
const s3 = config.aws.documentsBucket ? awsS3 : null

function localPathForKey(key: string) {
  const resolved = path.resolve(localRoot, key)
  if (!resolved.startsWith(localRoot + path.sep)) throw new Error("Invalid document storage key")
  return resolved
}

export function documentStorageKey(workspaceId: string, documentId: string) {
  return `workspaces/${workspaceId}/documents/${documentId}/source`
}

/** Sidecar holding the document's parsed blocks and page sizes, next to the source under the same
 * document prefix. Provenance the row already carries is enough to draw a highlight; this exists
 * so a value's source can be re-resolved later without re-parsing the document. */
export function documentBlocksKey(workspaceId: string, documentId: string) {
  return `workspaces/${workspaceId}/documents/${documentId}/blocks`
}

/** Reads the blocks sidecar, or null when it was never written (older documents, or a best-effort
 * write that failed). Never throws for a missing sidecar — its absence is expected. */
export async function readDocumentBlocks(key: string): Promise<string | null> {
  try {
    return (await readDocumentSource(key)).toString("utf8")
  } catch {
    return null
  }
}

export async function putDocumentSource(key: string, body: Buffer, contentType: string) {
  if (s3) {
    await s3.send(
      new PutObjectCommand({
        Bucket: config.aws.documentsBucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: "aws:kms",
        ...(config.aws.kmsKeyId ? { SSEKMSKeyId: config.aws.kmsKeyId } : {}),
      })
    )
    return
  }

  const target = localPathForKey(key)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, body, { mode: 0o600 })
}

export async function readDocumentSource(key: string): Promise<Buffer> {
  if (s3) {
    const result = await s3.send(new GetObjectCommand({ Bucket: config.aws.documentsBucket, Key: key }))
    if (!result.Body) throw new Error("Document source is missing")
    return Buffer.from(await result.Body.transformToByteArray())
  }
  return fs.readFile(localPathForKey(key))
}

export async function deleteDocumentSource(key: string) {
  if (s3) {
    await s3.send(new DeleteObjectCommand({ Bucket: config.aws.documentsBucket, Key: key }))
    return
  }
  await fs.rm(localPathForKey(key), { force: true })
}
