// Deliberately NOT a "use server" module: these are internal data-access helpers that trust their
// caller-supplied workspaceId. Server actions in app/(app)/workspaces/[workspaceId]/*-actions.ts
// do the auth. All writes validate `fields` through documentTemplateFieldsSchema.
import { documentTemplateFieldsSchema } from "@/lib/document-templates"
import { prisma } from "@/lib/db"
// Type-only: nothing from the generated client is needed at runtime, so this import is erased.
import type { Prisma } from "@/prisma/client"

const CONTROL_CHARS = new RegExp("[\u0000-\u001f]", "g")
const cleanName = (name: string | undefined | null, fallback: string) => (name ?? "").replace(CONTROL_CHARS, " ").trim().slice(0, 80) || fallback
const cleanText = (value: string | undefined | null, max: number) => {
  const trimmed = (value ?? "").replace(CONTROL_CHARS, " ").trim().slice(0, max)
  return trimmed || null
}

/** Validates and normalises a library template's fields, throwing on an invalid shape (the same
 * schema the worksheets use). Returns the parsed fields ready to store as JSON. */
function validateFields(fields: unknown) {
  return documentTemplateFieldsSchema.parse(fields)
}

export type WorkspaceTemplateInput = {
  name: string
  description?: string | null
  docType?: string | null
  fields: unknown
  prompt?: string | null
  multiRow?: boolean
}

export const listWorkspaceTemplates = (workspaceId: string) =>
  prisma.workspaceTemplate.findMany({ where: { workspaceId }, orderBy: { updatedAt: "desc" }, take: 200 })

export const getWorkspaceTemplate = (workspaceId: string, id: string) =>
  prisma.workspaceTemplate.findFirst({ where: { id, workspaceId } })

export async function createWorkspaceTemplate(workspaceId: string, createdById: string | null, input: WorkspaceTemplateInput) {
  const fields = validateFields(input.fields)
  return prisma.workspaceTemplate.create({
    data: {
      workspaceId,
      createdById,
      name: cleanName(input.name, "Untitled template"),
      description: cleanText(input.description, 500),
      docType: cleanText(input.docType, 80),
      fields: fields as Prisma.InputJsonValue,
      prompt: cleanText(input.prompt, 2000),
      multiRow: Boolean(input.multiRow),
    },
  })
}

export async function updateWorkspaceTemplate(workspaceId: string, id: string, input: WorkspaceTemplateInput) {
  const existing = await getWorkspaceTemplate(workspaceId, id)
  if (!existing) throw new Error("template_not_found")
  const fields = validateFields(input.fields)
  return prisma.workspaceTemplate.update({
    where: { id: existing.id },
    data: {
      name: cleanName(input.name, "Untitled template"),
      description: cleanText(input.description, 500),
      docType: cleanText(input.docType, 80),
      fields: fields as Prisma.InputJsonValue,
      prompt: cleanText(input.prompt, 2000),
      multiRow: Boolean(input.multiRow),
    },
  })
}

export async function deleteWorkspaceTemplate(workspaceId: string, id: string) {
  const existing = await getWorkspaceTemplate(workspaceId, id)
  if (!existing) throw new Error("template_not_found")
  await prisma.workspaceTemplate.delete({ where: { id: existing.id } })
}

/** Bumps useCount when a library template is applied to a file, so the library can surface the
 * most-used entries. Best-effort — never fail an apply over the counter. */
export async function touchWorkspaceTemplateUse(workspaceId: string, id: string) {
  await prisma.workspaceTemplate.updateMany({ where: { id, workspaceId }, data: { useCount: { increment: 1 } } }).catch(() => {})
}
