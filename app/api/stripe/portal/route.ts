import { getApiUser } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { requireWorkspaceRole } from "@/models/workspaces"
import { stripeClient } from "@/lib/stripe"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId"); if (!workspaceId) return NextResponse.json({ error: "Missing workspace" }, { status: 400 })
  const user = await getApiUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 })
  await requireWorkspaceRole(workspaceId, user.id, ["owner"]); const subscription = await prisma.workspaceSubscription.findUnique({ where: { workspaceId } })
  if (!stripeClient || !subscription?.stripeCustomerId) return NextResponse.json({ error: "No billing profile" }, { status: 400 })
  const session = await stripeClient.billingPortal.sessions.create({ customer: subscription.stripeCustomerId, return_url: `${request.nextUrl.origin}/workspaces/${workspaceId}/settings/billing` })
  return NextResponse.redirect(session.url)
}
