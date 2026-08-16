import { Logo } from "@/components/marketing/logo"
import config from "@/lib/config"
import { SOLUTION_GROUPS, solutionsByGroup } from "@/lib/solutions"
import type { Route } from "next"
import Link from "next/link"

const columns: { label: string; links: { href: Route; label: string }[] }[] = [
  {
    label: "Product",
    links: [
      { href: "/pricing", label: "Pricing" },
      { href: "/demo", label: "Book a demo" },
      { href: "/signup", label: "Start free trial" },
      { href: "/login", label: "Sign in" },
    ],
  },
  {
    label: "Legal",
    links: [
      { href: "/docs/privacy_policy", label: "Privacy" },
      { href: "/docs/terms", label: "Terms" },
      { href: "/docs/cookie", label: "Cookies" },
      { href: "/docs/ai", label: "AI use" },
    ],
  },
]

export function MarketingFooter() {
  return (
    <footer className="bg-emerald-950 text-emerald-100/80">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {SOLUTION_GROUPS.map((group) => (
            <div key={group.id}>
              <p className="mb-4 text-xs font-semibold uppercase tracking-[.16em] text-emerald-400">{group.label}</p>
              <ul className="space-y-2.5 text-sm">
                {solutionsByGroup(group.id).map((solution) => (
                  <li key={solution.slug}>
                    <Link href={`/solutions/${solution.slug}` as Route} className="transition-colors hover:text-white">{solution.name}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {columns.map((column) => (
            <div key={column.label}>
              <p className="mb-4 text-xs font-semibold uppercase tracking-[.16em] text-emerald-400">{column.label}</p>
              <ul className="space-y-2.5 text-sm">
                {column.links.map((link) => (
                  <li key={link.href}><Link href={link.href} className="transition-colors hover:text-white">{link.label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
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
