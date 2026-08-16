import { evaluateAiFormulaAction } from "@/app/(app)/workspaces/[workspaceId]/sheet-actions"
import { AI_FORMULA_NAMES, type AiFormulaInput } from "@/lib/ai-formula"
import { LifecycleStages, type FUniver } from "@univerjs/presets"

/** What Univer hands a custom function: a scalar per argument, or a nested array when the
 * argument was a range. */
type FormulaArg = unknown

/** Flattens a range argument into the scalars inside it, so `=AI("…", A2:C2)` sees three
 * values rather than one array. */
function flatten(arg: FormulaArg, out: AiFormulaInput[] = []): AiFormulaInput[] {
  if (Array.isArray(arg)) {
    for (const item of arg) flatten(item, out)
    return out
  }
  if (arg === null || arg === undefined || arg === "") out.push(null)
  else if (typeof arg === "number" || typeof arg === "boolean" || typeof arg === "string") out.push(arg)
  // Univer wraps some cell values in an object with a `v`; anything else is not worth sending.
  else if (typeof arg === "object" && "v" in (arg as Record<string, unknown>)) flatten((arg as { v: unknown }).v, out)
  return out
}

const firstScalar = (arg: FormulaArg): string => {
  const [value] = flatten(arg)
  return value === null || value === undefined ? "" : String(value)
}

/** Univer's FunctionType.User and BooleanNumber, inlined rather than imported from
 * @univerjs/engine-formula: the preset already bundles that code, and importing it a second
 * time under its own package name pulls a duplicate copy into the client bundle. */
const USER_FUNCTION = 15
const REQUIRED = 1
const OPTIONAL = 0
const REPEATABLE = 1

/** The catalogue entry, not just the implementation.
 *
 * Registering with a plain string description makes the function *work* but leaves it invisible:
 * Univer's in-cell autocomplete, its function help panel and the parameter hints all read
 * IFunctionInfo. Without this, `=A` offers nothing and the only way to know it exists is
 * to have been told. The locale strings are what those surfaces actually display. */
const functionInfo = (name: string) => ({
  functionName: name,
  functionType: USER_FUNCTION,
  description: `customFunction.${name}.description`,
  abstract: `customFunction.${name}.abstract`,
  functionParameter: [
    { name: "instruction", detail: `customFunction.${name}.instruction`, example: '"Which country issued this invoice?"', require: REQUIRED, repeat: OPTIONAL },
    { name: "cells", detail: `customFunction.${name}.cells`, example: "A2:D2", require: OPTIONAL, repeat: REPEATABLE },
  ],
})

const functionLocales = (name: string) => ({
  enUS: {
    customFunction: {
      [name]: {
        description: "Asks the workspace's AI the given question about the given cells and puts the answer in this cell. Answers are cached, so recalculating does not ask again.",
        abstract: "Ask the AI about these cells",
        instruction: "What to ask about the cells, in plain English",
        cells: "The cells to reason over. Optional; may be single cells or ranges",
      },
    },
  },
})

/** Registers the AI formulas on a live grid.
 *
 * `=AI("classify this supplier", B2)` — the first argument is the instruction, the rest are
 * cells to reason over. The answer is fetched by a server action (the API key never reaches the
 * browser) and memoised there, so the recalculation that happens on every reload is free.
 *
 * Returns a teardown for the caller to run when the grid goes away. */
export function registerAiFormulas(api: FUniver, workspaceId: string): () => void {
  // Registered twice, on purpose.
  //
  // Immediately, because a workbook holding `=AI(...)` calculates as it loads and an
  // unregistered function resolves to #NAME? — which then propagates into every formula that
  // references the cell. And again once the grid is steady, because Univer's formula plugin
  // publishes its own ~400 descriptions during boot, and a description registered before that
  // is not in the catalogue afterwards: the function calculates fine but the Functions dialog
  // and the parameter hints have never heard of it, which is how anyone would discover it.
  let teardown = registerNow(api, workspaceId)
  let settled = false

  const lifecycle = api.addEvent(api.Event.LifeCycleChanged, (event) => {
    if (event.stage !== LifecycleStages.Steady || settled) return
    settled = true
    // Disposing first: unregistering is by name, so tearing the old registration down after the
    // new one would take the new one with it.
    teardown()
    teardown = registerNow(api, workspaceId)
  })

  return () => {
    lifecycle.dispose()
    teardown()
  }
}

function registerNow(api: FUniver, workspaceId: string): () => void {
  const formula = api.getFormula()

  const disposables = AI_FORMULA_NAMES.map((name) =>
    formula.registerAsyncFunction(
      name,
      async (...args: FormulaArg[]) => {
        const prompt = firstScalar(args[0])
        const inputs = args.slice(1).flatMap((arg) => flatten(arg))
        const result = await evaluateAiFormulaAction(workspaceId, name, prompt, inputs)
        // The cell is the only place an error can surface — a formula has no toast and no
        // console the user is looking at — so the message goes in it verbatim.
        return result.success && result.data ? result.data.result : `#AI: ${result.error ?? "no answer"}`
      },
      { description: functionInfo(name) as never, locales: functionLocales(name) as never },
    ))

  return () => disposables.forEach((disposable) => disposable.dispose())
}
