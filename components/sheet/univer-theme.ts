/** Univer's own theme object, restated in DocuBite's palette. Univer paints its chrome from
 * these ramps rather than from CSS custom properties, so the app's `--primary` token cannot
 * reach it — the only way to stop the grid rendering in stock indigo-on-cool-grey next to an
 * emerald-and-stone shell is to hand `createUniver` a theme built from the same colours.
 *
 * `primary` is Tailwind emerald and `gray` is Tailwind stone, which is exactly the pairing
 * app/globals.css encodes as HSL tokens. The remaining ramps are Univer's defaults. */
import { defaultTheme } from "@univerjs/themes"

const emerald = {
  50: "#ecfdf5", 100: "#d1fae5", 200: "#a7f3d0", 300: "#6ee7b7", 400: "#34d399",
  500: "#10b981", 600: "#059669", 700: "#047857", 800: "#065f46", 900: "#064e3b",
}

const stone = {
  50: "#fafaf9", 100: "#f5f5f4", 200: "#e7e5e4", 300: "#d6d3d1", 400: "#a8a29e",
  500: "#78716c", 600: "#57534e", 700: "#44403c", 800: "#292524", 900: "#1c1917",
}

export const docubiteUniverTheme = { ...defaultTheme, primary: emerald, green: emerald, gray: stone }
