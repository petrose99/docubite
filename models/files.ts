// Deliberately NOT a "use server" module, for the same reason as models/workspaces.ts: these
// helpers trust their caller-supplied arguments (getFileAccess takes the viewer to resolve, and
// several take a workspaceId that is assumed to be already authorised). The directive would
// publish every export as a callable endpoint. Server actions live in
// app/(app)/workspaces/[workspaceId]/actions.ts and do the auth.
import { auditEventData, getRequestAuditContext } from "@/lib/audit"
import { DEFAULT_DOCUMENT_TEMPLATES, parseTemplateFields } from "@/lib/document-templates"
import { dictationAdapters, findExtractionDomainPack } from "@/lib/domains"
import { deleteDocumentSource, documentStorageKey, putDocumentSource, readDocumentSource } from "@/lib/document-storage"
import { prisma } from "@/lib/db"
import { Prisma } from "@/prisma/client"
import { randomUUID } from "crypto"
import { cache } from "react"

/** Ordered weakest to strongest so `accessRank` can compare them. "owner" is a workspace
 * member: everything "edit" allows, plus renaming, sharing, and deleting the file itself. */
export const FILE_ACCESS_LEVELS = ["none", "view", "interact", "edit", "owner"] as const
export type FileAccess = (typeof FILE_ACCESS_LEVELS)[number]
/** What a Share dialog can hand out. "owner" is membership, never granted per file. */
export type SharedAccess = Exclude<FileAccess, "owner">

export const accessRank = (access: string) => Math.max(0, FILE_ACCESS_LEVELS.indexOf(access as FileAccess))
export const canEdit = (access: FileAccess) => accessRank(access) >= accessRank("edit")
export const canOpen = (access: FileAccess) => accessRank(access) >= accessRank("view")

const parseAccess = (value: unknown, fallback: SharedAccess = "view"): SharedAccess => {
  const candidate = String(value ?? "")
  return candidate === "none" || candidate === "view" || candidate === "interact" || candidate === "edit" ? candidate : fallback
}
export const parseLinkAccess = (value: unknown) => parseAccess(value, "none")
export const parseShareAccess = (value: unknown) => {
  const access = parseAccess(value, "view")
  return access === "none" ? "view" : access
}

export const FILE_SORT_FIELDS = ["name", "updatedAt"] as const
export type FileSortField = (typeof FILE_SORT_FIELDS)[number]

const cleanName = (name: string | undefined | null, fallback: string) => (name ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120) || fallback

/** The shape createFile seeds worksheets from — the domain packs in lib/domains/ all satisfy it. */
type SeedTemplate = { code: string; name: string; documentType: string; multiRow: boolean; fields: readonly unknown[] }

/** Every file starts as a usable blank workbook: the same system worksheets a brand-new
 * workspace used to be seeded with, so `New file` lands somewhere you can immediately upload
 * into rather than on an empty tab strip.
 *
 * `templates` and `kind` are parameters rather than constants because the dictation container is
 * the same row with a different worksheet in it — see ensureDictationFile. Both default to what
 * every existing caller already got. */
export async function createFile(input: {
  workspaceId: string; userId: string; name?: string; folderId?: string | null
  templates?: readonly SeedTemplate[]
  kind?: "sheet" | "dictation"
}) {
  const templates = input.templates ?? DEFAULT_DOCUMENT_TEMPLATES
  return prisma.documentFile.create({
    data: {
      workspaceId: input.workspaceId,
      folderId: input.folderId || null,
      createdById: input.userId,
      name: cleanName(input.name, "untitled"),
      kind: input.kind ?? "sheet",
      templates: {
        create: templates.map((template) => ({
          workspaceId: input.workspaceId,
          code: template.code,
          name: template.name,
          documentType: template.documentType,
          isSystem: true,
          multiRow: template.multiRow,
          versions: { create: { version: 1, fields: parseTemplateFields(template.fields) } },
        })),
      },
    },
  })
}

/** The workspace's dictation container, created on first use and kept in step with the registry.
 *
 * A Document needs a fileId and a templateId, so a dictation needs a file to live in. Rather than
 * inventing a second ingestion path that skips those, the dictation page gets one app-managed file
 * seeded with the dictation domains' worksheets — which is what lets a dictation reuse
 * createDocumentFromBuffer, the transcribe job, chunking, embedding, field projection, quota and
 * audit untouched.
 *
 * The DB's partial unique index on (workspace_id) WHERE kind = 'dictation' is what makes creation
 * safe under concurrent first loads: two simultaneous callers race, one loses on the constraint,
 * and the loser re-reads the winner's row instead of creating a duplicate.
 *
 * Missing worksheets are added on every call, not only at creation. Otherwise registering a second
 * dictation domain would work for new workspaces and silently do nothing for every existing one —
 * the same "seeded once, diverges forever" trap DEFAULT_DOCUMENT_TEMPLATES already has. */
export async function ensureDictationFile(workspaceId: string, userId: string) {
  const templates = dictationAdapters()
  const existing = await prisma.documentFile.findFirst({ where: { workspaceId, kind: "dictation" } })
  const file = existing ?? await createFile({ workspaceId, userId, name: "Dictations", templates, kind: "dictation" })
    .catch(async () => {
      const raced = await prisma.documentFile.findFirst({ where: { workspaceId, kind: "dictation" } })
      if (!raced) throw new Error("dictation_file_unavailable")
      return raced
    })

  // Scoped by workspaceId as well as fileId. fileId alone is not exploitable here — the file was
  // just resolved from this workspace — but the scope guard is right to flag it: isolation that
  // depends on every caller remembering is isolation that eventually fails.
  const present = new Set((await prisma.documentTemplate.findMany({ where: { workspaceId, fileId: file.id }, select: { code: true } })).map((row) => row.code))
  const missing = templates.filter((template) => !present.has(template.code))
  for (const template of missing) {
    await prisma.documentTemplate.create({
      data: {
        workspaceId, fileId: file.id, code: template.code, name: template.name,
        documentType: template.documentType, isSystem: true, multiRow: template.multiRow,
        versions: { create: { version: 1, fields: parseTemplateFields(template.fields) } },
      },
    })
  }
  return file
}

/** Adds a domain pack's worksheets to an existing file — the picker on the templates settings
 * page. Idempotent per template code: a pack already (partially) added only gets whatever
 * worksheets are still missing, the same "diverges forever otherwise" reasoning as
 * ensureDictationFile above, just triggered by a user action instead of every page load. */
export async function addDomainPackToFile(workspaceId: string, fileId: string, domain: string) {
  const pack = findExtractionDomainPack(domain)
  if (!pack) throw new Error("unknown_domain_pack")
  const present = new Set((await prisma.documentTemplate.findMany({ where: { workspaceId, fileId }, select: { code: true } })).map((row) => row.code))
  const missing = pack.adapters.filter((adapter) => !present.has(adapter.code))
  for (const adapter of missing) {
    await prisma.documentTemplate.create({
      data: {
        workspaceId, fileId, code: adapter.code, name: adapter.name, documentType: adapter.documentType,
        isSystem: false, multiRow: adapter.multiRow,
        versions: { create: { version: 1, fields: parseTemplateFields(adapter.fields), prompt: adapter.prompt } },
      },
    })
  }
  return { added: missing.length }
}

/** Adds a domain pack to every file already in the workspace, at once — what makes enabling an
 * optional module (lib/modules) with a domainPack (statement-packs today) materialize its
 * worksheets immediately rather than only on the next file someone creates. Reuses
 * addDomainPackToFile's own idempotency per file, so re-enabling after a disable never duplicates
 * a worksheet that's still there. */
export async function addDomainPackToWorkspace(workspaceId: string, domain: string) {
  const files = await prisma.documentFile.findMany({ where: { workspaceId }, select: { id: true } })
  let added = 0
  for (const file of files) added += (await addDomainPackToFile(workspaceId, file.id, domain)).added
  return { added, files: files.length }
}

/** Slugifies a name into a template code, appending -2, -3, … on collision within the file. Codes
 * are the join key DocumentTemplate is @@unique on ([fileId, code]), so this has to actually avoid
 * a collision rather than just look tidy. */
async function uniqueTemplateCode(fileId: string, name: string): Promise<string> {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "template"
  const existing = new Set((await prisma.documentTemplate.findMany({ where: { fileId }, select: { code: true } })).map((row) => row.code))
  if (!existing.has(base)) return base
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}_${suffix}`
    if (!existing.has(candidate)) return candidate
  }
}

/** Turns one dictation's discovered fields into a reusable workspace template — the growth path
 * for template mode: today a fresh workspace's dictation file has exactly one template (the blank
 * general_report starting point), so this is what lets "agnostic once, template from then on"
 * actually happen for a recurring case.
 *
 * A plain, non-ephemeral, non-system DocumentTemplate row: `findDomainAdapter(code)` will not
 * recognise its code (it is not one of lib/domains' hard-coded packs), so `ephemeral` reads as
 * false everywhere that checks it (models/field-suggestions.ts) — fields accepted against THIS
 * template accumulate normally like any user-built worksheet, which is the correct behaviour for
 * something a person deliberately chose to save and reuse. */
export async function saveDocumentAsTemplate(input: { workspaceId: string; documentId: string; name: string }) {
  const document = await prisma.document.findFirst({
    where: { id: input.documentId, workspaceId: input.workspaceId },
    select: { fileId: true, fieldSnapshot: true },
  })
  if (!document) throw new Error("document_not_found")
  const fields = parseTemplateFields(document.fieldSnapshot)
  if (!fields.length) throw new Error("no_fields_to_save")

  const name = cleanName(input.name, "Untitled template")
  const code = await uniqueTemplateCode(document.fileId, name)
  return prisma.documentTemplate.create({
    data: {
      workspaceId: input.workspaceId, fileId: document.fileId, code, name, documentType: code,
      isSystem: false, multiRow: false,
      versions: { create: { version: 1, fields: fields as unknown as Prisma.InputJsonValue } },
    },
  })
}

export type FileListItem = Awaited<ReturnType<typeof listFiles>>[number]

export async function listFiles(workspaceId: string, options: { folderId?: string | null; query?: string; sort?: FileSortField; dir?: "asc" | "desc" } = {}) {
  const query = options.query?.trim()
  const sort = options.sort === "name" ? "name" : "updatedAt"
  const dir = options.dir === "asc" ? "asc" : "desc"
  return prisma.documentFile.findMany({
    // A search spans the whole workspace: filtering by folder as well would hide the matches
    // the user is searching *for*, which are usually in some other folder.
    //
    // kind "sheet" only: the dictation container is app-managed furniture with its own page, and
    // listing it here would offer to rename, share, move and delete something the dictation page
    // depends on existing.
    where: { workspaceId, kind: "sheet", ...(query ? { name: { contains: query, mode: "insensitive" } } : { folderId: options.folderId ?? null }) },
    include: { _count: { select: { documents: true, shares: true } }, folder: { select: { id: true, name: true } } },
    orderBy: { [sort]: dir },
    take: 500,
  })
}

export async function listFolders(workspaceId: string, options: { parentId?: string | null; query?: string } = {}) {
  const query = options.query?.trim()
  return prisma.documentFolder.findMany({
    where: { workspaceId, ...(query ? { name: { contains: query, mode: "insensitive" } } : { parentId: options.parentId ?? null }) },
    include: { _count: { select: { files: true, children: true } } },
    orderBy: { name: "asc" },
    take: 500,
  })
}

/** Every folder in the workspace, flat — the move-to menu needs targets outside the folder
 * currently being browsed, and the Files search uses `parentId` to compute which results fall
 * inside the folder being searched from (that folder and its descendants). */
export const listAllFolders = (workspaceId: string) => prisma.documentFolder.findMany({ where: { workspaceId }, select: { id: true, name: true, parentId: true }, orderBy: { name: "asc" }, take: 500 })

/** The breadcrumb trail for `?folder=`, root first. Depth-capped so a cycle introduced by a
 * bad move can never spin here. */
export async function folderTrail(workspaceId: string, folderId: string | null) {
  const trail: Array<{ id: string; name: string }> = []
  let current = folderId
  for (let depth = 0; current && depth < 20; depth++) {
    const folder: { id: string; name: string; parentId: string | null } | null = await prisma.documentFolder.findFirst({ where: { id: current, workspaceId }, select: { id: true, name: true, parentId: true } })
    if (!folder) break
    trail.unshift({ id: folder.id, name: folder.name })
    current = folder.parentId
  }
  return trail
}

export const getWorkspaceFile = cache(async (workspaceId: string, fileId: string) => prisma.documentFile.findFirst({ where: { id: fileId, workspaceId } }))

export const getFileTemplates = cache(async (workspaceId: string, fileId: string) => prisma.documentTemplate.findMany({
  where: { workspaceId, fileId },
  include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
}))

export async function renameFile(workspaceId: string, fileId: string, name: string) {
  const file = await getWorkspaceFile(workspaceId, fileId)
  if (!file) throw new Error("file_not_found")
  return prisma.documentFile.update({ where: { id: file.id }, data: { name: cleanName(name, "untitled") } })
}

export async function moveToFolder(workspaceId: string, fileIds: string[], folderId: string | null) {
  if (folderId && !(await prisma.documentFolder.findFirst({ where: { id: folderId, workspaceId }, select: { id: true } }))) throw new Error("folder_not_found")
  const result = await prisma.documentFile.updateMany({ where: { workspaceId, id: { in: fileIds.slice(0, 200) } }, data: { folderId } })
  return { moved: result.count }
}

const MAX_DUPLICATED_DOCUMENTS = 500

/** Lido's "Make a copy": the new file gets its own worksheets *and* its own copy of every
 * extracted row, source blob included. Blobs are copied rather than shared because deleting
 * either file must be able to delete its own sources (see deleteFile). The copy deliberately
 * does not consume document quota — those uploads were already paid for once. */
export async function duplicateFile(input: { workspaceId: string; userId: string; fileId: string }) {
  const source = await prisma.documentFile.findFirst({
    where: { id: input.fileId, workspaceId: input.workspaceId },
    include: { templates: { include: { versions: { orderBy: { version: "asc" } } } } },
  })
  if (!source) throw new Error("file_not_found")

  const copy = await prisma.documentFile.create({ data: { workspaceId: source.workspaceId, folderId: source.folderId, createdById: input.userId, name: cleanName(`${source.name} copy`, "untitled copy") } })

  // templateId -> copied templateId, and versionId -> copied versionId, so each copied
  // document keeps pointing at the field snapshot it was actually extracted against.
  const templateMap = new Map<string, string>()
  const versionMap = new Map<string, string>()
  for (const template of source.templates) {
    const created = await prisma.documentTemplate.create({
      data: {
        workspaceId: source.workspaceId, fileId: copy.id, code: template.code, name: template.name, documentType: template.documentType,
        isSystem: template.isSystem, multiRow: template.multiRow, currentVersion: template.currentVersion,
        versions: { create: template.versions.map((version) => ({ version: version.version, fields: version.fields as Prisma.InputJsonValue, prompt: version.prompt })) },
      },
      include: { versions: true },
    })
    templateMap.set(template.id, created.id)
    for (const version of template.versions) {
      const match = created.versions.find((candidate) => candidate.version === version.version)
      if (match) versionMap.set(version.id, match.id)
    }
  }

  const documents = await prisma.document.findMany({ where: { fileId: source.id }, orderBy: { receivedAt: "asc" }, take: MAX_DUPLICATED_DOCUMENTS })
  const writtenKeys: string[] = []
  try {
    for (const document of documents) {
      const id = randomUUID()
      let storageKey: string | null = null
      if (document.storageKey) {
        // A source that has gone missing must not abort the whole copy — the row still
        // carries the extracted data, which is what the sheet shows.
        const buffer = await readDocumentSource(document.storageKey).catch(() => null)
        if (buffer) {
          storageKey = documentStorageKey(input.workspaceId, id)
          await putDocumentSource(storageKey, buffer, document.mimeType)
          writtenKeys.push(storageKey)
        }
      }
      await prisma.document.create({ data: {
        id, workspaceId: document.workspaceId, fileId: copy.id,
        templateId: document.templateId ? templateMap.get(document.templateId) ?? null : null,
        templateVersionId: document.templateVersionId ? versionMap.get(document.templateVersionId) ?? null : null,
        source: document.source, status: document.status, filename: document.filename, mimeType: document.mimeType,
        sizeBytes: document.sizeBytes, sha256: document.sha256, storageKey, pageRange: document.pageRange, receivedAt: document.receivedAt,
        fieldSnapshot: document.fieldSnapshot as Prisma.InputJsonValue,
        rawExtraction: (document.rawExtraction ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        reviewedData: (document.reviewedData ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        confidence: (document.confidence ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        aiQuotaClaimed: document.aiQuotaClaimed, searchText: document.searchText, ocrText: document.ocrText,
        errorCode: document.errorCode, reviewedAt: document.reviewedAt,
      } })
    }
  } catch (error) {
    for (const key of writtenKeys) await deleteDocumentSource(key).catch(() => {})
    await prisma.documentFile.delete({ where: { id: copy.id } }).catch(() => {})
    throw error
  }
  return { file: copy, documentsCopied: documents.length, truncated: documents.length === MAX_DUPLICATED_DOCUMENTS }
}

/** Deletes files with the source blobs behind their documents. The DB cascade alone would
 * drop the rows and orphan every blob under data/document-sources (or the S3 bucket), so the
 * storage sweep has to happen here, before the row goes. */
export async function deleteFiles(workspaceId: string, fileIds: string[], actorId: string) {
  const files = await prisma.documentFile.findMany({ where: { workspaceId, id: { in: fileIds.slice(0, 100) } }, select: { id: true } })
  const context = await getRequestAuditContext()
  let deleted = 0
  for (const file of files) {
    const documents = await prisma.document.findMany({ where: { workspaceId, fileId: file.id }, select: { storageKey: true } })
    for (const document of documents) if (document.storageKey) await deleteDocumentSource(document.storageKey).catch(() => {})
    await prisma.$transaction([
      prisma.documentFile.delete({ where: { id: file.id } }),
      prisma.documentAuditEvent.create({ data: auditEventData({ workspaceId, actorId, type: "file_deleted" }, context) }),
    ])
    deleted++
  }
  return { deleted }
}

export async function createFolder(input: { workspaceId: string; name: string; parentId?: string | null }) {
  if (input.parentId && !(await prisma.documentFolder.findFirst({ where: { id: input.parentId, workspaceId: input.workspaceId }, select: { id: true } }))) throw new Error("folder_not_found")
  return prisma.documentFolder.create({ data: { workspaceId: input.workspaceId, parentId: input.parentId || null, name: cleanName(input.name, "New folder") } })
}

export async function renameFolder(workspaceId: string, folderId: string, name: string) {
  const folder = await prisma.documentFolder.findFirst({ where: { id: folderId, workspaceId }, select: { id: true } })
  if (!folder) throw new Error("folder_not_found")
  return prisma.documentFolder.update({ where: { id: folder.id }, data: { name: cleanName(name, "New folder") } })
}

/** Deleting a folder deletes the files inside it (and their blobs), depth-first, so nothing is
 * left stranded in a folder the user can no longer navigate to. */
export async function deleteFolder(workspaceId: string, folderId: string, actorId: string, depth = 0) {
  const folder = await prisma.documentFolder.findFirst({ where: { id: folderId, workspaceId }, select: { id: true } })
  if (!folder) throw new Error("folder_not_found")
  if (depth < 20) {
    const children = await prisma.documentFolder.findMany({ where: { parentId: folder.id }, select: { id: true } })
    for (const child of children) await deleteFolder(workspaceId, child.id, actorId, depth + 1)
  }
  const files = await prisma.documentFile.findMany({ where: { workspaceId, folderId: folder.id }, select: { id: true } })
  await deleteFiles(workspaceId, files.map((file) => file.id), actorId)
  await prisma.documentFolder.delete({ where: { id: folder.id } })
  return { deletedFiles: files.length }
}

/** F15: refuses to turn on link sharing for a workspace flagged as handling ePHI. "none" always
 * passes — a workspace can always narrow its own sharing back down even under hipaaMode. */
export async function setLinkAccess(workspaceId: string, fileId: string, access: string) {
  const file = await getWorkspaceFile(workspaceId, fileId)
  if (!file) throw new Error("file_not_found")
  const parsed = parseLinkAccess(access)
  if (parsed !== "none") {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { hipaaMode: true } })
    if (workspace?.hipaaMode) throw new Error("link_sharing_disabled_hipaa_mode")
  }
  return prisma.documentFile.update({ where: { id: file.id }, data: { linkAccess: parsed } })
}

export const listFileShares = cache(async (fileId: string) => prisma.documentFileShare.findMany({ where: { fileId }, orderBy: { createdAt: "asc" } }))

export async function upsertFileShare(workspaceId: string, fileId: string, email: string, access: string) {
  const file = await getWorkspaceFile(workspaceId, fileId)
  if (!file) throw new Error("file_not_found")
  const normalized = email.trim().toLowerCase()
  if (!normalized) throw new Error("invalid_email")
  const user = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } })
  return prisma.documentFileShare.upsert({
    where: { fileId_email: { fileId: file.id, email: normalized } },
    create: { fileId: file.id, email: normalized, access: parseShareAccess(access), userId: user?.id ?? null },
    update: { access: parseShareAccess(access), userId: user?.id ?? null },
  })
}

export async function removeFileShare(workspaceId: string, fileId: string, email: string) {
  const file = await getWorkspaceFile(workspaceId, fileId)
  if (!file) throw new Error("file_not_found")
  await prisma.documentFileShare.deleteMany({ where: { fileId: file.id, email: email.trim().toLowerCase() } })
}

/** Files shared with this person by email, for the Files list's "Shared With Me" tab. Matched
 * on the email rather than the user id, because a share can be created before the invitee has
 * ever signed up (userId is null until then). */
export async function listFilesSharedWith(email: string) {
  const shares = await prisma.documentFileShare.findMany({
    where: { email: email.trim().toLowerCase() },
    include: { file: { include: { workspace: { select: { id: true, name: true } }, _count: { select: { documents: true, shares: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  })
  return shares.map((share) => ({ ...share.file, sharedAccess: share.access as SharedAccess }))
}

export type ResolvedFileAccess = {
  access: FileAccess
  file: Prisma.DocumentFileGetPayload<{ include: { workspace: { select: { hipaaMode: true } } } }>
}

/** The single place that answers "what may this viewer do with this file?".
 *
 * A workspace member is an owner. Everyone else gets the strongest of the file's link access
 * and any per-email share, so revoking one route does not silently leave the other open —
 * and a signed-out viewer only ever gets the link. */
export async function getFileAccess(fileId: string, viewer: { id: string; email: string } | null): Promise<ResolvedFileAccess | null> {
  const file = await prisma.documentFile.findUnique({ where: { id: fileId }, include: { workspace: { select: { hipaaMode: true } } } })
  if (!file) return null
  if (viewer) {
    const membership = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: file.workspaceId, userId: viewer.id } }, select: { id: true } })
    if (membership) return { access: "owner", file }
  }
  // F15: a hipaaMode workspace never grants access through the bare link — member or stranger,
  // signed in or not, linkAccess is ignored outright. Only membership (above) or an explicit
  // per-email share (below) may open the file; "anyone who has the URL" is not an acceptable
  // access control for ePHI, however the file's own sharing setting is configured.
  let access: FileAccess = file.workspace.hipaaMode ? "none" : parseLinkAccess(file.linkAccess)
  if (viewer) {
    const share = await prisma.documentFileShare.findUnique({ where: { fileId_email: { fileId: file.id, email: viewer.email.toLowerCase() } } })
    if (share && accessRank(share.access) > accessRank(access)) access = parseShareAccess(share.access)
    // Claim the share for this account the first time they open the file, so the owner's
    // People list can show a real user rather than a pending email.
    if (share && !share.userId) await prisma.documentFileShare.update({ where: { id: share.id }, data: { userId: viewer.id } }).catch(() => {})
  }
  return { access, file }
}

/** Bumps the file's updatedAt so the Files list's LAST UPDATED column tracks work done inside
 * the sheet, not just renames. Best-effort: never fail a document write over a timestamp. */
export async function touchFile(fileId: string) {
  await prisma.documentFile.update({ where: { id: fileId }, data: { updatedAt: new Date() } }).catch(() => {})
}
