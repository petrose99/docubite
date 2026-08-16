import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../../prisma/client/client"

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
const templates = await prisma.documentTemplate.findMany({ select: { code: true, name: true, multiRow: true, createdAt: true }, orderBy: { createdAt: "asc" } })
console.log(JSON.stringify(templates))
const docs = await prisma.document.findMany({ orderBy: { createdAt: "desc" }, take: 3, select: { filename: true, status: true, createdAt: true, pageRange: true } })
console.log(JSON.stringify(docs))
await prisma.$disconnect()
