import { Toaster } from "@/components/ui/sonner"
import { getCurrentUser } from "@/lib/auth"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await getCurrentUser()
  // Mounted once for the whole signed-in app so the workspace list and settings pages can
  // toast too, not just the sheet.
  return <>{children}<Toaster richColors position="bottom-right" /></>
}
