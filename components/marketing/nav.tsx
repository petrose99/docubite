"use client"

import { Logo } from "@/components/marketing/logo"
import { SOLUTION_GROUPS, SOLUTIONS, solutionsByGroup } from "@/lib/solutions"
import { ChevronDown, Menu, X } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"

const solutionHref = (slug: string) => `/solutions/${slug}` as Route

/** The marketing header. The Solutions panel is hand-rolled on the outside-click/Escape pattern
 * already used by components/shell/account-menu.tsx — @radix-ui/react-navigation-menu would be a
 * new dependency for one dropdown, and the project has consistently declined that trade. */
export function MarketingNav({ workspaceHref }: { workspaceHref?: string }) {
  const [solutionsOpen, setSolutionsOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const header = useRef<HTMLElement>(null)
  const pathname = usePathname()

  // Navigating with the panel open would otherwise leave it hanging over the new page: the
  // header is in the layout, so it never unmounts between marketing routes. Adjusted during
  // render rather than in an effect — the effect version schedules a second render pass, which
  // paints the new page with the old panel still over it for a frame.
  const [renderedPath, setRenderedPath] = useState(pathname)
  if (renderedPath !== pathname) {
    setRenderedPath(pathname)
    setSolutionsOpen(false)
    setMobileOpen(false)
  }

  useEffect(() => {
    if (!solutionsOpen && !mobileOpen) return
    const onPointerDown = (event: MouseEvent) => { if (!header.current?.contains(event.target as Node)) { setSolutionsOpen(false); setMobileOpen(false) } }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { setSolutionsOpen(false); setMobileOpen(false) } }
    window.addEventListener("mousedown", onPointerDown)
    window.addEventListener("keydown", onKeyDown)
    return () => { window.removeEventListener("mousedown", onPointerDown); window.removeEventListener("keydown", onKeyDown) }
  }, [solutionsOpen, mobileOpen])

  return (
    <header ref={header} className="sticky top-0 z-50 border-b border-stone-200/80 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <Link href="/" aria-label="DocuBite home"><Logo /></Link>

        <nav className="hidden items-center gap-1 lg:flex">
          <button
            type="button"
            onClick={() => setSolutionsOpen((value) => !value)}
            aria-expanded={solutionsOpen}
            aria-haspopup="true"
            className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-950"
          >
            Solutions
            <ChevronDown aria-hidden className={`h-4 w-4 text-stone-400 transition-transform ${solutionsOpen ? "rotate-180" : ""}`} />
          </button>
          <Link href={"/solutions#industries" as Route} className="rounded-md px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-950">Industries</Link>
          <Link href={"/#dictation" as Route} className="rounded-md px-3 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-950">Dictation</Link>
        </nav>

        <div className="ml-auto hidden items-center gap-3 lg:flex">
          {workspaceHref ? (
            <Link href={workspaceHref as Route} className="inline-flex h-9 items-center rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800">Open workspace</Link>
          ) : (
            <>
              <Link href="/login" className="text-sm font-medium text-stone-600 transition-colors hover:text-stone-950">Sign in</Link>
              <Link href="/demo" className="inline-flex h-9 items-center rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800">Book a demo</Link>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen((value) => !value)}
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          className="ml-auto rounded-md p-2 text-stone-700 hover:bg-stone-100 lg:hidden"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {solutionsOpen && (
        <div className="absolute inset-x-0 top-full hidden border-b border-stone-200 bg-white shadow-[0_28px_60px_-36px_rgba(41,37,36,.5)] lg:block">
          <div className="mx-auto max-w-6xl px-5 py-8">
            <div className="mb-2 flex items-center justify-between px-3">
              <p className="text-xs font-semibold uppercase tracking-[.16em] text-stone-400">Browse solutions</p>
              <Link href="/solutions" className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-800 hover:text-emerald-900">All solutions & industries<ChevronDown aria-hidden className="h-3.5 w-3.5 -rotate-90" /></Link>
            </div>
            <div className="grid gap-x-12 gap-y-8 md:grid-cols-2">
            {SOLUTION_GROUPS.map((group) => (
              <div key={group.id}>
                <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">{group.label}</p>
                <ul>
                  {solutionsByGroup(group.id).map((solution) => (
                    <li key={solution.slug}>
                      <Link href={solutionHref(solution.slug)} className="flex gap-3 rounded-xl p-3 transition-colors hover:bg-stone-50">
                        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl rounded-tr-sm bg-emerald-50 text-emerald-700">
                          <solution.icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-stone-900">{solution.name}</span>
                          <span className="block text-sm leading-snug text-stone-500">{solution.tagline}</span>
                        </span>
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

      {mobileOpen && (
        <div className="border-t border-stone-200 bg-white lg:hidden">
          <div className="space-y-5 px-5 py-5">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">Solutions</p>
                <Link href="/solutions" className="text-sm font-semibold text-emerald-800">See all</Link>
              </div>
              <ul className="space-y-0.5">
                {SOLUTIONS.map((solution) => (
                  <li key={solution.slug}>
                    <Link href={solutionHref(solution.slug)} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100">
                      <solution.icon className="h-4 w-4 text-emerald-700" />{solution.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <Link href={"/solutions#industries" as Route} className="block rounded-lg px-2 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100">Industries</Link>
            <Link href={"/#dictation" as Route} className="block rounded-lg px-2 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100">Dictation</Link>
            {workspaceHref ? (
              <Link href={workspaceHref as Route} className="flex h-11 items-center justify-center rounded-lg bg-emerald-700 text-sm font-semibold text-white">Open workspace</Link>
            ) : (
              <div className="flex gap-3">
                <Link href="/login" className="flex h-10 flex-1 items-center justify-center rounded-lg border border-stone-300 text-sm font-medium text-stone-800">Sign in</Link>
                <Link href="/demo" className="flex h-10 flex-1 items-center justify-center rounded-lg bg-emerald-700 text-sm font-semibold text-white">Book a demo</Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
