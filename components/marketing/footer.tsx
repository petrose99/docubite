import { Logo } from "@/components/marketing/logo"
import config from "@/lib/config"
import { PRODUCT_LINKS, SOLUTION_GROUPS, solutionsByGroup } from "@/lib/solutions"
import { ArrowRight } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"

const legalLinks: { href: Route; label: string }[] = [
  { href: "/docs/privacy_policy", label: "Privacy" },
  { href: "/docs/terms", label: "Terms" },
  { href: "/docs/cookie", label: "Cookies" },
  { href: "/docs/ai", label: "AI use" },
]

export function MarketingFooter() {
  return (
    <footer className="bg-emerald-950 text-emerald-100/80">
      <div className="mx-auto max-w-6xl px-5 pt-16">
        <div className="flex flex-col items-start justify-between gap-6 border-b border-emerald-800 pb-14 lg:flex-row lg:items-end">
          <p className="max-w-2xl text-3xl font-semibold leading-[1.05] tracking-tight text-white sm:text-4xl">
            Take a bite out of <span className="text-amber-300">paperwork.</span>
          </p>
          <Link href="/demo" className="group inline-flex h-12 shrink-0 items-center gap-1.5 rounded-full bg-white px-6 text-sm font-semibold text-emerald-950 shadow-sm transition-colors hover:bg-cream-100">
            Book a demo<ArrowRight aria-hidden className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {SOLUTION_GROUPS.map((group) => (
            <div key={group.id}>
              <p className="mb-4 text-xs font-semibold uppercase tracking-[.16em] text-amber-300">{group.label}</p>
              <ul className="space-y-2.5 text-sm">
                {solutionsByGroup(group.id).map((solution) => (
                  <li key={solution.slug}>
                    <Link href={`/solutions/${solution.slug}` as Route} className="transition-colors hover:text-white">{solution.name}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[.16em] text-amber-300">Product</p>
            <ul className="space-y-2.5 text-sm">
              {PRODUCT_LINKS.map((item) => (
                <li key={item.href}><Link href={item.href as Route} className="transition-colors hover:text-white">{item.name}</Link></li>
              ))}
              <li><Link href="/login" className="transition-colors hover:text-white">Sign in</Link></li>
            </ul>
          </div>
          <div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[.16em] text-amber-300">Legal</p>
            <ul className="space-y-2.5 text-sm">
              {legalLinks.map((link) => (
                <li key={link.href}><Link href={link.href} className="transition-colors hover:text-white">{link.label}</Link></li>
              ))}
            </ul>
          </div>
        </div>

        <div className="perforation mt-14 text-emerald-800" aria-hidden />

        <div className="mt-8 flex flex-col gap-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <Logo tone="inverse" />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a href={`mailto:${config.app.supportEmail}`} className="transition-colors hover:text-white">{config.app.supportEmail}</a>
            <span className="text-emerald-100/50">© {new Date().getFullYear()} {config.app.title}</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
