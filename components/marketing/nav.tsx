"use client"

import { Logo } from "@/components/marketing/logo"
import { INDUSTRIES, PRODUCT_LINKS, SOLUTION_GROUPS, SOLUTIONS, solutionsByGroup } from "@/lib/solutions"
import { ArrowRight, ChevronDown, Menu, X } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"

const solutionHref = (slug: string) => `/solutions/${slug}` as Route

type MenuKey = "products" | "solutions" | "industries"

/** The marketing header. Both dropdowns are hand-rolled on the outside-click/Escape pattern
 * already used by components/shell/account-menu.tsx — @radix-ui/react-navigation-menu would be a
 * new dependency for two panels, and the project has consistently declined that trade. */
export function MarketingNav({ workspaceHref }: { workspaceHref?: string }) {
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const header = useRef<HTMLElement>(null)
  const pathname = usePathname()

  // Navigating with a panel open would otherwise leave it hanging over the new page: the header
  // is in the layout, so it never unmounts between marketing routes. Adjusted during render
  // rather than in an effect — the effect version schedules a second render pass, which paints
  // the new page with the old panel still over it for a frame.
  const [renderedPath, setRenderedPath] = useState(pathname)
  if (renderedPath !== pathname) {
    setRenderedPath(pathname)
    setOpenMenu(null)
    setMobileOpen(false)
  }

  useEffect(() => {
    if (!openMenu && !mobileOpen) return
    const onPointerDown = (event: MouseEvent) => { if (!header.current?.contains(event.target as Node)) { setOpenMenu(null); setMobileOpen(false) } }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpenMenu(null); setMobileOpen(false) } }
    window.addEventListener("mousedown", onPointerDown)
    window.addEventListener("keydown", onKeyDown)
    return () => { window.removeEventListener("mousedown", onPointerDown); window.removeEventListener("keydown", onKeyDown) }
  }, [openMenu, mobileOpen])

  return (
    <header ref={header} className="sticky top-0 z-50 border-b border-cream-200 bg-cream-50/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <Link href="/" aria-label="DocuBite home"><Logo /></Link>

        <nav className="hidden items-center gap-1 lg:flex">
          <button
            type="button"
            onClick={() => setOpenMenu((value) => (value === "products" ? null : "products"))}
            aria-expanded={openMenu === "products"}
            aria-haspopup="true"
            className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-cream-100 hover:text-stone-950"
          >
            Products
            <ChevronDown aria-hidden className={`h-4 w-4 text-stone-400 transition-transform ${openMenu === "products" ? "rotate-180" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setOpenMenu((value) => (value === "solutions" ? null : "solutions"))}
            aria-expanded={openMenu === "solutions"}
            aria-haspopup="true"
            className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-cream-100 hover:text-stone-950"
          >
            Solutions
            <ChevronDown aria-hidden className={`h-4 w-4 text-stone-400 transition-transform ${openMenu === "solutions" ? "rotate-180" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setOpenMenu((value) => (value === "industries" ? null : "industries"))}
            aria-expanded={openMenu === "industries"}
            aria-haspopup="true"
            className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-cream-100 hover:text-stone-950"
          >
            Industries
            <ChevronDown aria-hidden className={`h-4 w-4 text-stone-400 transition-transform ${openMenu === "industries" ? "rotate-180" : ""}`} />
          </button>
        </nav>

        <div className="ml-auto hidden items-center gap-3 lg:flex">
          {workspaceHref ? (
            <Link href={workspaceHref as Route} className="group inline-flex h-11 items-center gap-1.5 rounded-full bg-emerald-950 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-900">
              Open workspace<ArrowRight aria-hidden className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-sm font-medium text-stone-600 transition-colors hover:text-stone-950">Sign in</Link>
              <Link href="/demo" className="group inline-flex h-11 items-center gap-1.5 rounded-full bg-emerald-950 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-900">
                Book a demo<ArrowRight aria-hidden className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen((value) => !value)}
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          className="ml-auto rounded-md p-2 text-stone-700 hover:bg-cream-100 lg:hidden"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {openMenu === "products" && (
        <div className="absolute inset-x-0 top-full hidden border-b border-cream-200 bg-white shadow-[0_28px_60px_-36px_rgba(41,37,36,.5)] lg:block">
          <div className="mx-auto max-w-6xl px-5 py-8">
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-[.16em] text-stone-400">Products</p>
            <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
              {PRODUCT_LINKS.map((item) => (
                <Link key={item.href} href={item.href as Route} className="flex gap-3 rounded-xl p-3 transition-colors hover:bg-cream-100">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl rounded-tr-sm bg-emerald-50 text-emerald-700">
                    <item.icon className="h-4 w-4" />
                  </span>
                  <span className="block text-sm font-semibold text-stone-900">{item.name}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {openMenu === "solutions" && (
        <div className="absolute inset-x-0 top-full hidden border-b border-cream-200 bg-white shadow-[0_28px_60px_-36px_rgba(41,37,36,.5)] lg:block">
          <div className="mx-auto max-w-6xl px-5 py-8">
            <div className="mb-2 flex items-center justify-between px-3">
              <p className="text-xs font-semibold uppercase tracking-[.16em] text-stone-400">Browse solutions</p>
              <Link href="/solutions" className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-800 hover:text-emerald-900">All solutions<ChevronDown aria-hidden className="h-3.5 w-3.5 -rotate-90" /></Link>
            </div>
            <div className="grid gap-x-12 gap-y-1 md:grid-cols-2">
              {SOLUTION_GROUPS.map((group) => (
                <div key={group.id}>
                  <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">{group.label}</p>
                  <ul>
                    {solutionsByGroup(group.id).map((solution) => (
                      <li key={solution.slug}>
                        <Link href={solutionHref(solution.slug)} className="flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-cream-100">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl rounded-tr-sm bg-emerald-50 text-emerald-700">
                            <solution.icon className="h-4 w-4" />
                          </span>
                          <span className="text-sm font-semibold text-stone-900">{solution.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {openMenu === "industries" && (
        <div className="absolute inset-x-0 top-full hidden border-b border-cream-200 bg-white shadow-[0_28px_60px_-36px_rgba(41,37,36,.5)] lg:block">
          <div className="mx-auto max-w-6xl px-5 py-8">
            <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-[.16em] text-stone-400">Industries</p>
            <div className="grid gap-x-8 gap-y-1 md:grid-cols-3">
              {INDUSTRIES.map((industry) => (
                <Link key={industry.name} href={"/solutions#industries" as Route} className="flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-cream-100">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl rounded-tr-sm bg-emerald-50 text-emerald-700">
                    <industry.icon className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-semibold text-stone-900">{industry.name}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {mobileOpen && (
        <div className="border-t border-cream-200 bg-white lg:hidden">
          <div className="space-y-5 px-5 py-5">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">Products</p>
              <ul className="space-y-0.5">
                {PRODUCT_LINKS.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href as Route} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium text-stone-700 hover:bg-cream-100">
                      <item.icon className="h-4 w-4 text-emerald-700" />{item.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">Solutions</p>
                <Link href="/solutions" className="text-sm font-semibold text-emerald-800">See all</Link>
              </div>
              <ul className="space-y-0.5">
                {SOLUTIONS.map((solution) => (
                  <li key={solution.slug}>
                    <Link href={solutionHref(solution.slug)} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium text-stone-700 hover:bg-cream-100">
                      <solution.icon className="h-4 w-4 text-emerald-700" />{solution.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">Industries</p>
              <ul className="space-y-0.5">
                {INDUSTRIES.map((industry) => (
                  <li key={industry.name}>
                    <Link href={"/solutions#industries" as Route} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium text-stone-700 hover:bg-cream-100">
                      <industry.icon className="h-4 w-4 text-emerald-700" />{industry.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            {workspaceHref ? (
              <Link href={workspaceHref as Route} className="flex h-11 items-center justify-center rounded-full bg-emerald-950 text-sm font-semibold text-white">Open workspace</Link>
            ) : (
              <div className="flex gap-3">
                <Link href="/login" className="flex h-10 flex-1 items-center justify-center rounded-full border border-stone-300 text-sm font-medium text-stone-800">Sign in</Link>
                <Link href="/demo" className="flex h-10 flex-1 items-center justify-center rounded-full bg-emerald-950 text-sm font-semibold text-white">Book a demo</Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
