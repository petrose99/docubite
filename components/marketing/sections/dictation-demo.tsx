import { Check, Mic, Route, ShieldCheck } from "lucide-react"

const WAVEFORM_BARS = 28

const transcriptLines = [
  "Specimen is a skin punch biopsy",
  "from the left forearm, received fresh",
  "on the fourteenth.",
]

const fields = [
  { label: "Specimen", value: "Skin, left forearm" },
  { label: "Type", value: "Punch biopsy" },
  { label: "Received", value: "Aug 14" },
  { label: "Status", value: "Pending review" },
]

/** The dictation section's own mock, mirroring ExtractionDemo's language (a self-playing CSS
 * loop, one shared clock, freezes under prefers-reduced-motion) but for the other intake path:
 * a recording comes in, the transcript appears, it gets routed to a report kind, and the
 * synoptic fields land next to it — same "nothing invented" trust story, spoken instead of
 * scanned. Pure CSS, so it stays a server component. */
export function DictationDemo() {
  return (
    <div className="dictation-demo relative">
      <style>{DICTATION_DEMO_KEYFRAMES}</style>

      <div className="rounded-[1.6rem] rounded-tr-md border border-stone-200 bg-white p-3 shadow-[0_40px_90px_-50px_rgba(41,37,36,.55)]">
        <div className="overflow-hidden rounded-[1.1rem] rounded-tr-sm border border-stone-200 bg-white">
          {/* window chrome */}
          <div className="flex items-center gap-2.5 border-b border-stone-100 bg-stone-50 px-3.5 py-2.5">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-stone-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-stone-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-stone-200" />
            </div>
            <span className="inline-flex items-center gap-1.5 text-[0.78rem] font-semibold text-stone-700">
              <Mic className="h-3.5 w-3.5 text-emerald-700" />New dictation
            </span>

            {/* status badge — "Recording" fades out, "Routed" fades in, same clock */}
            <span className="relative ml-auto inline-flex h-[1.6rem] min-w-[7.5rem] items-center justify-end">
              <span className="dict-recording absolute right-0 inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-1 text-[0.68rem] font-semibold text-rose-700">
                <span className="dict-rec-dot h-1.5 w-1.5 rounded-full bg-rose-500" />Recording
              </span>
              <span className="dict-routed absolute right-0 inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-2 py-1 text-[0.68rem] font-semibold text-white">
                <Route className="h-3 w-3" />Pathology report
              </span>
            </span>
          </div>

          {/* waveform */}
          <div className="flex h-11 items-center gap-[3px] border-b border-stone-100 bg-stone-50/60 px-3.5">
            {Array.from({ length: WAVEFORM_BARS }).map((_, index) => (
              <span
                key={index}
                className="dict-bar w-full rounded-full bg-emerald-600/70"
                style={{ animationDelay: `${(index % 7) * 0.09}s` }}
              />
            ))}
          </div>

          {/* transcript */}
          <div className="min-h-[4.6rem] space-y-1 border-b border-stone-100 px-3.5 py-3">
            {transcriptLines.map((line, index) => (
              <p key={line} className={`dict-line-${index + 1} text-[0.72rem] leading-snug text-stone-600`}>{line}</p>
            ))}
          </div>

          {/* synoptic fields + report preview */}
          <div className="grid grid-cols-2 divide-x divide-stone-100">
            <div className="space-y-1.5 px-3.5 py-3">
              <p className="text-[0.62rem] font-bold uppercase tracking-[.1em] text-stone-400">Synoptic fields</p>
              {fields.map((field, index) => (
                <div key={field.label} className={`dict-field-${index + 1} flex items-baseline justify-between gap-2 text-[0.68rem]`}>
                  <span className="text-stone-500">{field.label}</span>
                  <span className="truncate font-semibold text-stone-900">{field.value}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1.5 bg-stone-50/60 px-3.5 py-3">
              <p className="text-[0.62rem] font-bold uppercase tracking-[.1em] text-stone-400">Report · Table</p>
              <div className="dict-report space-y-1 text-[0.68rem] text-stone-600">
                <p className="flex items-center gap-1"><Check className="h-3 w-3 shrink-0 text-emerald-600" />Synoptic block drafted, ready to review.</p>
                <p className="flex items-center gap-1"><Check className="h-3 w-3 shrink-0 text-emerald-600" />No format chosen by hand.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* trust chip */}
      <div className="dict-source inline-flex items-center gap-2 self-start rounded-xl rounded-tr-sm bg-emerald-950 px-3 py-2 text-[0.7rem] text-emerald-100 sm:absolute sm:right-4 sm:top-full sm:mt-3.5 sm:shadow-[0_20px_40px_-18px_rgba(2,44,34,.8)]">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />Nothing in the fields was invented
      </div>
    </div>
  )
}

/** One shared 8s clock, same choreography style as ExtractionDemo's DEMO_KEYFRAMES: transcript
 * lines cascade in first, the status badge flips from "Recording" to "Routed" once the transcript
 * has landed, then the synoptic fields and report preview cascade in together, the trust chip
 * glows, and everything holds before resetting. The waveform and the recording dot run their own
 * short ambient loops throughout. Reduced-motion snaps straight to the finished state. */
const DICTATION_DEMO_KEYFRAMES = `
.dictation-demo .dict-bar { animation: dictWave 1.2s ease-in-out infinite; height: 30%; }
.dictation-demo .dict-rec-dot { animation: dictBlink 1s ease-in-out infinite; }
.dictation-demo .dict-recording { animation: dictRecording 8s ease-in-out infinite; }
.dictation-demo .dict-routed { animation: dictRouted 8s ease-in-out infinite; }
.dictation-demo .dict-line-1 { animation: dictLine1 8s ease-in-out infinite; }
.dictation-demo .dict-line-2 { animation: dictLine2 8s ease-in-out infinite; }
.dictation-demo .dict-line-3 { animation: dictLine3 8s ease-in-out infinite; }
.dictation-demo .dict-field-1 { animation: dictField1 8s ease-in-out infinite; }
.dictation-demo .dict-field-2 { animation: dictField2 8s ease-in-out infinite; }
.dictation-demo .dict-field-3 { animation: dictField3 8s ease-in-out infinite; }
.dictation-demo .dict-field-4 { animation: dictField4 8s ease-in-out infinite; }
.dictation-demo .dict-report { animation: dictReport 8s ease-in-out infinite; }
.dictation-demo .dict-source { animation: dictGlow 8s ease-in-out infinite; }

@keyframes dictWave {
  0%, 100% { height: 22%; }
  50% { height: 85%; }
}
@keyframes dictBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: .25; }
}
@keyframes dictRecording {
  0%, 42% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
@keyframes dictRouted {
  0%, 46% { opacity: 0; transform: scale(.85); }
  54% { opacity: 1; transform: scale(1); }
  92%, 100% { opacity: 0; }
}
@keyframes dictLine1 {
  0%, 4% { opacity: 0; transform: translateY(6px); }
  11%, 88% { opacity: 1; transform: translateY(0); }
  95%, 100% { opacity: 0; }
}
@keyframes dictLine2 {
  0%, 12% { opacity: 0; transform: translateY(6px); }
  19%, 88% { opacity: 1; transform: translateY(0); }
  95%, 100% { opacity: 0; }
}
@keyframes dictLine3 {
  0%, 20% { opacity: 0; transform: translateY(6px); }
  27%, 88% { opacity: 1; transform: translateY(0); }
  95%, 100% { opacity: 0; }
}
@keyframes dictField1 {
  0%, 52% { opacity: 0; transform: translateX(-4px); }
  58%, 88% { opacity: 1; transform: translateX(0); }
  95%, 100% { opacity: 0; }
}
@keyframes dictField2 {
  0%, 57% { opacity: 0; transform: translateX(-4px); }
  63%, 88% { opacity: 1; transform: translateX(0); }
  95%, 100% { opacity: 0; }
}
@keyframes dictField3 {
  0%, 62% { opacity: 0; transform: translateX(-4px); }
  68%, 88% { opacity: 1; transform: translateX(0); }
  95%, 100% { opacity: 0; }
}
@keyframes dictField4 {
  0%, 67% { opacity: 0; transform: translateX(-4px); }
  73%, 88% { opacity: 1; transform: translateX(0); }
  95%, 100% { opacity: 0; }
}
@keyframes dictReport {
  0%, 60% { opacity: 0; transform: translateY(4px); }
  67%, 88% { opacity: 1; transform: translateY(0); }
  95%, 100% { opacity: 0; }
}
@keyframes dictGlow {
  0%, 76% { box-shadow: 0 20px 40px -18px rgba(2,44,34,.8), 0 0 0 0 rgba(52,211,153,0); }
  84% { box-shadow: 0 20px 40px -18px rgba(2,44,34,.8), 0 0 0 3px rgba(52,211,153,.35); }
  92%, 100% { box-shadow: 0 20px 40px -18px rgba(2,44,34,.8), 0 0 0 0 rgba(52,211,153,0); }
}
@media (prefers-reduced-motion: reduce) {
  .dictation-demo .dict-bar,
  .dictation-demo .dict-rec-dot,
  .dictation-demo .dict-recording,
  .dictation-demo .dict-routed,
  .dictation-demo .dict-line-1,
  .dictation-demo .dict-line-2,
  .dictation-demo .dict-line-3,
  .dictation-demo .dict-field-1,
  .dictation-demo .dict-field-2,
  .dictation-demo .dict-field-3,
  .dictation-demo .dict-field-4,
  .dictation-demo .dict-report,
  .dictation-demo .dict-source { animation: none; }
  .dictation-demo .dict-recording { opacity: 0; }
  .dictation-demo .dict-routed,
  .dictation-demo .dict-line-1,
  .dictation-demo .dict-line-2,
  .dictation-demo .dict-line-3,
  .dictation-demo .dict-field-1,
  .dictation-demo .dict-field-2,
  .dictation-demo .dict-field-3,
  .dictation-demo .dict-field-4,
  .dictation-demo .dict-report { opacity: 1; transform: none; }
  .dictation-demo .dict-bar { height: 55%; }
}
`
