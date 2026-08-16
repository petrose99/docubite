import { PoorManCache } from "@/lib/cache"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("PoorManCache", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("stores and retrieves values", () => {
    const cache = new PoorManCache<string>(1000)
    cache.set("a", "hello")
    expect(cache.get("a")).toBe("hello")
    expect(cache.has("a")).toBe(true)
    expect(cache.size()).toBe(1)
  })

  it("returns undefined for missing keys", () => {
    const cache = new PoorManCache<string>(1000)
    expect(cache.get("missing")).toBeUndefined()
    expect(cache.has("missing")).toBe(false)
  })

  it("expires entries after the configured duration", () => {
    const cache = new PoorManCache<string>(500)
    cache.set("key", "value")
    expect(cache.get("key")).toBe("value")

    vi.advanceTimersByTime(501)
    expect(cache.get("key")).toBeUndefined()
    expect(cache.has("key")).toBe(false)
  })

  it("does not expire entries before the duration", () => {
    const cache = new PoorManCache<string>(500)
    cache.set("key", "value")
    vi.advanceTimersByTime(499)
    expect(cache.get("key")).toBe("value")
  })

  it("deletes specific keys", () => {
    const cache = new PoorManCache<number>(1000)
    cache.set("x", 42)
    cache.delete("x")
    expect(cache.get("x")).toBeUndefined()
  })

  it("clears all entries", () => {
    const cache = new PoorManCache<number>(1000)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.clear()
    expect(cache.size()).toBe(0)
  })

  it("cleans up only expired entries", () => {
    const cache = new PoorManCache<string>(500)
    cache.set("early", "1")
    vi.advanceTimersByTime(300)
    cache.set("late", "2")
    vi.advanceTimersByTime(250)

    cache.cleanup()
    expect(cache.has("early")).toBe(false)
    expect(cache.has("late")).toBe(true)
    expect(cache.size()).toBe(1)
  })

  it("overwrites existing keys and resets the timer", () => {
    const cache = new PoorManCache<string>(500)
    cache.set("key", "old")
    vi.advanceTimersByTime(400)
    cache.set("key", "new")
    vi.advanceTimersByTime(200)
    expect(cache.get("key")).toBe("new")
  })
})
