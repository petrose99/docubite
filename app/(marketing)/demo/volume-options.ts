/** Kept out of actions.ts on purpose: a "use server" module may only export async functions, and
 * a const exported from one is rewritten into a server reference — the client then imports a
 * function-shaped stub and `VOLUME_OPTIONS.map` throws at render. Plain module, both sides import
 * it, and the zod enum in the action stays in step with the <select> the user actually sees. */
export const VOLUME_OPTIONS = [
  "Under 100 documents / month",
  "100 – 500 documents / month",
  "500 – 2,000 documents / month",
  "2,000 – 10,000 documents / month",
  "More than 10,000 documents / month",
] as const
