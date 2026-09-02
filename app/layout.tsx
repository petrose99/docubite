import { InstallPrompt } from "@/components/shell/install-prompt"
import { SwRegister } from "@/components/shell/sw-register"
import config from "@/lib/config"
import type { Metadata, Viewport } from "next"
import { Bricolage_Grotesque } from "next/font/google"
import localFont from "next/font/local"
import "./globals.css"

/** The repo has shipped the Inter family under public/fonts since the beginning without ever
 * referencing it; next/font/local self-hosts it properly (no layout shift, no network hop). */
const inter = localFont({
  src: [
    { path: "../public/fonts/Inter/Inter-Regular.otf", weight: "400", style: "normal" },
    { path: "../public/fonts/Inter/Inter-Italic.otf", weight: "400", style: "italic" },
    { path: "../public/fonts/Inter/Inter-Medium.otf", weight: "500", style: "normal" },
    { path: "../public/fonts/Inter/Inter-SemiBold.otf", weight: "600", style: "normal" },
    { path: "../public/fonts/Inter/Inter-Bold.otf", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
})

/** Headings and the wordmark. Bricolage's slightly squared, high-contrast letterforms are what
 * keeps the marketing pages from reading as another Inter-on-white SaaS template. */
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" })

export const metadata: Metadata = {
  title: {
    template: `%s | ${config.app.title}`,
    default: config.app.title,
  },
  description: config.app.description,
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
  metadataBase: new URL(config.app.baseURL),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: config.app.baseURL,
    title: config.app.title,
    description: config.app.description,
    siteName: config.app.title,
  },
  twitter: {
    card: "summary_large_image",
    title: config.app.title,
    description: config.app.description,
  },
  robots: {
    index: true,
    follow: true,
  },
}

export const viewport: Viewport = {
  themeColor: "#047857",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is required by next-themes, which @premieroctet/next-admin bundles
    // for the /admin-next console: it writes style="color-scheme:…" onto <html> before React
    // hydrates, so server and client markup differ on this one element by design. It suppresses
    // the warning for <html> only — children still report mismatches normally.
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${display.variable}`}>
      <body className="min-h-screen bg-white antialiased"><SwRegister /><InstallPrompt />{children}</body>
    </html>
  )
}
