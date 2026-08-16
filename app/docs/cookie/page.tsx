import config from "@/lib/config"

export default function CookiePolicy() {
  return <article className="prose prose-stone max-w-none"><h1>Cookies</h1><p>{config.app.title} uses essential session cookies to authenticate you and keep your workspace access secure. It does not use advertising cookies.</p></article>
}
