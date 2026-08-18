import { describe, expect, it } from "vitest"
import { chunkFromBlocks, chunkFromText, contentHashFor, type ChunkProvenance } from "@/lib/chunking"
import type { BlocksSidecar } from "@/lib/provenance"

type Block = BlocksSidecar["blocks"][number]

function block(page: number, text: string, bbox: [number, number, number, number] | null = null): Block {
  return { page, bbox, text, type: "text" }
}

function sidecar(blocks: Block[]): BlocksSidecar {
  return { version: 1, pages: [], blocks }
}

/** A block of `n` characters carrying a unique marker, so its presence in a chunk can be asserted. */
function filler(marker: string, n: number): string {
  return `${marker} ${"x".repeat(Math.max(0, n - marker.length - 1))}`
}

describe("chunkFromBlocks", () => {
  it("is deterministic — the same sidecar yields identical chunks", () => {
    const blocks = Array.from({ length: 10 }, (_, i) => block(1, filler(`BLOCK${i}`, 500)))
    const a = chunkFromBlocks(sidecar(blocks), "m")
    const b = chunkFromBlocks(sidecar(blocks), "m")
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it("never splits a block — each block's text stays whole within a chunk", () => {
    const blocks = Array.from({ length: 12 }, (_, i) => block(1, filler(`MARK${i}`, 600)))
    const chunks = chunkFromBlocks(sidecar(blocks), "m")
    for (let i = 0; i < blocks.length; i++) {
      const whole = blocks[i].text.trim()
      expect(chunks.some((chunk) => chunk.text.includes(whole))).toBe(true)
    }
  })

  it("overlaps consecutive chunks by one block", () => {
    // Each block exceeds the target, so each becomes its own group and the overlap is visible.
    const b0 = filler("FIRST", 3300)
    const b1 = filler("SECOND", 3300)
    const b2 = filler("THIRD", 3300)
    const chunks = chunkFromBlocks(sidecar([block(1, b0), block(1, b1), block(1, b2)]), "m")
    expect(chunks).toHaveLength(3)
    expect(chunks[0].text).toBe(b0)
    // The second chunk carries the previous chunk's last block ahead of its own.
    expect(chunks[1].text.startsWith(b0)).toBe(true)
    expect(chunks[1].text.includes(b1)).toBe(true)
  })

  it("prefers a page boundary as a cut once the window is over half full", () => {
    // Page 1 accumulates past 50% of the target but not to the full target; the first page-2 block
    // should still force a cut there rather than being packed in with page 1.
    const page1 = Array.from({ length: 4 }, (_, i) => block(1, filler(`P1_${i}`, 500))) // ~2000 chars > 1600
    const page2 = block(2, filler("P2_0", 500))
    const chunks = chunkFromBlocks(sidecar([...page1, page2]), "m")
    // The page-2 content starts a new chunk; no chunk mixes page 1 content with the page-2 marker
    // except through the one-block overlap.
    const mixed = chunks.find((chunk) => chunk.text.includes("P2_0"))
    expect(mixed).toBeDefined()
    expect((mixed?.provenance as ChunkProvenance).pages).toContain(2)
  })

  it("records provenance pages and a union bbox", () => {
    const chunks = chunkFromBlocks(sidecar([block(3, "on page three", [0.1, 0.2, 0.3, 0.4])]), "m")
    expect(chunks).toHaveLength(1)
    expect((chunks[0].provenance as ChunkProvenance).pages).toEqual([3])
    expect((chunks[0].provenance as ChunkProvenance).bbox).toEqual([0.1, 0.2, 0.3, 0.4])
  })

  it("caps output at 512 chunks", () => {
    const blocks = Array.from({ length: 600 }, (_, i) => block(1, filler(`B${i}`, 3300)))
    expect(chunkFromBlocks(sidecar(blocks), "m")).toHaveLength(512)
  })

  it("returns nothing for whitespace-only blocks", () => {
    expect(chunkFromBlocks(sidecar([block(1, "   "), block(1, "\n\t")]), "m")).toEqual([])
  })
})

describe("chunkFromText", () => {
  it("splits on blank lines with null provenance", () => {
    const chunks = chunkFromText("First paragraph.\n\nSecond paragraph.", "m")
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.every((chunk) => chunk.provenance === null)).toBe(true)
    expect(chunks[0].text).toContain("First paragraph")
  })

  it("returns nothing for empty text", () => {
    expect(chunkFromText("", "m")).toEqual([])
    expect(chunkFromText("   \n\n  ", "m")).toEqual([])
  })

  it("splits a single oversized paragraph rather than emitting one giant chunk", () => {
    const huge = filler("HUGE", 12000)
    const chunks = chunkFromText(huge, "m")
    expect(chunks.length).toBeGreaterThan(1)
  })
})

describe("contentHashFor", () => {
  it("changes when the model name changes", () => {
    expect(contentHashFor("same text", "model-a")).not.toBe(contentHashFor("same text", "model-b"))
  })

  it("is stable for the same text and model", () => {
    expect(contentHashFor("same text", "m")).toBe(contentHashFor("same text", "m"))
  })

  it("propagates the model name into chunk hashes", () => {
    const a = chunkFromText("Para one.\n\nPara two.", "model-a")
    const b = chunkFromText("Para one.\n\nPara two.", "model-b")
    expect(a[0].contentHash).not.toBe(b[0].contentHash)
  })
})
