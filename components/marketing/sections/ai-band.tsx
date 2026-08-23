import { MessageCircle, PencilRuler, Sparkles, Table2 } from "lucide-react"

/** The dark "ink" band that carries the two distinct AI surfaces — the assistant and =AI()
 * formulas — since conflating them in one paragraph elsewhere made it unclear DocuBite has
 * both a chat-style agent and a spreadsheet-native function. */
export function AiBand() {
  return (
    <section id="how" className="bg-emerald-950 text-white">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-20 lg:grid-cols-[0.95fr_1.05fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-400">AI in the sheet</p>
          <h2 className="mt-3 font-display text-3xl font-bold leading-[1.1] tracking-[-0.03em] sm:text-4xl">
            AI that works inside the sheet.
          </h2>

          <div className="mt-8 space-y-6">
            <div className="flex gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl rounded-tr-sm bg-emerald-400/15 text-emerald-300"><MessageCircle className="h-5 w-5" /></span>
              <div>
                <h3 className="font-display text-lg font-bold text-white">Ask the assistant</h3>
                <p className="mt-1.5 text-[0.95rem] leading-6 text-emerald-100/75">
                  &ldquo;Total each numeric column.&rdquo; &ldquo;Which rows are missing a VAT number?&rdquo; It reads and writes the sheet, then hands back a summary with an Undo / Accept bar before anything sticks.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl rounded-tr-sm bg-emerald-400/15 text-emerald-300"><Table2 className="h-5 w-5" /></span>
              <div>
                <h3 className="font-display text-lg font-bold text-white"><span className="font-mono">=AI()</span> formulas</h3>
                <p className="mt-1.5 text-[0.95rem] leading-6 text-emerald-100/75">
                  Type <span className="font-mono text-emerald-300">=AI(&quot;classify this supplier&quot;, B2)</span> like any other function and it fills down the column. Answers are cached, so recalculating costs nothing.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl rounded-tr-sm bg-emerald-400/15 text-emerald-300"><PencilRuler className="h-5 w-5" /></span>
              <div>
                <h3 className="font-display text-lg font-bold text-white">Formula builder</h3>
                <p className="mt-1.5 text-[0.95rem] leading-6 text-emerald-100/75">
                  Describe the calculation in English, like &ldquo;net plus tax, minus the deposit,&rdquo; and get back the formula. Nothing lands in the sheet until you hit Insert.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Assistant conversation mock. CSS-only, no motion — the content itself is the pitch. */}
        <div className="rounded-[1.4rem] rounded-tr-md border border-emerald-400/20 bg-emerald-900/60 p-4 shadow-[0_40px_80px_-40px_rgba(0,0,0,.6)]">
          <div className="flex items-center gap-2 border-b border-emerald-400/15 pb-3">
            <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
            <span className="text-sm font-semibold text-emerald-100">AI Assistant</span>
          </div>
          <div className="flex flex-col gap-3 pt-3.5">
            <p className="ml-auto max-w-[82%] rounded-xl rounded-br-sm bg-emerald-700 px-3.5 py-2 text-sm leading-6 text-white">
              Flag any invoice where tax isn&apos;t 20% of the net, and add a Category column.
            </p>
            <p className="flex items-center gap-1.5 text-xs text-emerald-100/55">
              <Table2 className="h-3 w-3" />Reading the workbook · Adding a column
            </p>
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-800 p-3">
              <p className="text-[0.9rem] leading-6 text-emerald-50">
                One invoice was off: <b>Meridian Print</b> billed tax at 20% but the net looks transposed. Added <b>Category</b>, filled with <span className="font-mono text-emerald-300">=AI()</span>.
              </p>
              <ul className="mt-2.5 space-y-1 text-[0.8rem] text-emerald-200">
                <li><span className="font-mono font-bold underline decoration-emerald-400 underline-offset-2">D4</span> flagged — tax mismatch</li>
                <li><span className="font-mono font-bold underline decoration-emerald-400 underline-offset-2">G1:G6</span> added Category</li>
              </ul>
            </div>
            <div className="flex items-center gap-2.5 rounded-lg border border-emerald-400/20 bg-emerald-950/60 px-2.5 py-2">
              <span className="text-xs text-emerald-100/70">2 pending changes</span>
              <span className="ml-auto text-xs font-semibold text-emerald-200">Undo</span>
              <span className="rounded-md bg-emerald-300 px-2.5 py-1 text-xs font-bold text-emerald-950">Accept</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
