import { Logo } from "@/components/marketing/logo"
import Link from "next/link"

/** A light, centred card on the same slate/emerald palette as the marketing site — the previous
 * near-black full-bleed panel was the one screen in the product that looked like a different app. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12">
      <Link href="/" aria-label="DocuBite home" className="mb-8"><Logo markClassName="h-8 w-8" /></Link>
      <div className="w-full max-w-md rounded-[2rem] rounded-tr-md border border-slate-200 bg-white p-7 shadow-[0_28px_70px_-48px_rgba(41,37,36,.5)] sm:p-9">
        {children}
      </div>
      <p className="mt-8 text-center text-xs text-slate-400">
        <Link href="/docs/privacy_policy" className="hover:text-slate-600">Privacy</Link>
        <span className="px-2">·</span>
        <Link href="/docs/terms" className="hover:text-slate-600">Terms</Link>
      </p>
    </div>
  )
}

export const dynamic = "force-dynamic"
