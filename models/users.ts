import { prisma } from "@/lib/db"
import { Prisma } from "@/prisma/client"
import { cache } from "react"

export const getUserById = cache((id: string) => prisma.user.findUnique({ where: { id } }))
export const getUserByEmail = cache((email: string) => prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } }))
export const updateUser = (userId: string, data: Prisma.UserUpdateInput) => prisma.user.update({ where: { id: userId }, data })
