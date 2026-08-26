import { describe, expect, it } from "vitest"
import { assertUrlSafe, ipv4ToBytes, ipv6ToBytes, isBlockedIp, UnsafeUrlError } from "./url-safety"

describe("ipv4ToBytes / ipv6ToBytes", () => {
  it("parses valid v4", () => {
    expect(ipv4ToBytes("192.168.1.1")).toEqual([192, 168, 1, 1])
    expect(ipv4ToBytes("256.0.0.1")).toBeNull()
    expect(ipv4ToBytes("1.2.3")).toBeNull()
  })

  it("expands v6 including :: and embedded v4", () => {
    expect(ipv6ToBytes("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    expect(ipv6ToBytes("::ffff:127.0.0.1")?.slice(12)).toEqual([127, 0, 0, 1])
    expect(ipv6ToBytes("fe80::1")?.slice(0, 2)).toEqual([0xfe, 0x80])
    expect(ipv6ToBytes(":::1")).toBeNull()
  })
})

describe("isBlockedIp", () => {
  it("blocks private, loopback, link-local and metadata ranges", () => {
    for (const ip of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.5.5",
      "127.0.0.1",
      "169.254.169.254", // cloud metadata
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.10",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "::ffff:10.0.0.1", // v4-mapped private
      "64:ff9b::7f00:1", // NAT64 to 127.0.0.1
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true)
    }
  })

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isBlockedIp(ip), ip).toBe(false)
    }
  })

  it("treats 172.15/172.32 as public (boundary of the /12)", () => {
    expect(isBlockedIp("172.15.0.1")).toBe(false)
    expect(isBlockedIp("172.32.0.1")).toBe(false)
  })

  it("fails closed on garbage", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true)
  })
})

describe("assertUrlSafe", () => {
  const publicResolve = async () => [{ address: "93.184.216.34" }]
  const privateResolve = async () => [{ address: "10.0.0.5" }]

  it("accepts a public https URL", async () => {
    await expect(assertUrlSafe("https://hooks.example.com/x", { resolve: publicResolve, allowLocalhost: false })).resolves.toBeInstanceOf(URL)
  })

  it("rejects http in production mode", async () => {
    await expect(assertUrlSafe("http://hooks.example.com/x", { resolve: publicResolve, allowLocalhost: false })).rejects.toMatchObject({ code: "url_scheme_not_https" })
  })

  it("rejects a literal private IP host", async () => {
    await expect(assertUrlSafe("https://169.254.169.254/latest/meta-data", { allowLocalhost: false })).rejects.toMatchObject({ code: "url_private_ip" })
  })

  it("rejects a hostname that resolves to a private IP", async () => {
    await expect(assertUrlSafe("https://rebind.example.com/x", { resolve: privateResolve, allowLocalhost: false })).rejects.toMatchObject({ code: "url_private_ip" })
  })

  it("rejects when ANY resolved address is private", async () => {
    const mixed = async () => [{ address: "93.184.216.34" }, { address: "127.0.0.1" }]
    await expect(assertUrlSafe("https://mixed.example.com/x", { resolve: mixed, allowLocalhost: false })).rejects.toMatchObject({ code: "url_private_ip" })
  })

  it("rejects embedded credentials", async () => {
    await expect(assertUrlSafe("https://user:pass@example.com/x", { resolve: publicResolve, allowLocalhost: false })).rejects.toMatchObject({ code: "url_has_credentials" })
  })

  it("allows localhost only when permitted", async () => {
    await expect(assertUrlSafe("http://localhost:7331/hook", { allowLocalhost: true })).resolves.toBeInstanceOf(URL)
    await expect(assertUrlSafe("http://localhost:7331/hook", { allowLocalhost: false })).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it("rejects an unparseable URL", async () => {
    await expect(assertUrlSafe("not a url", { allowLocalhost: false })).rejects.toMatchObject({ code: "url_invalid" })
  })

  it("rejects when DNS fails", async () => {
    const boom = async () => { throw new Error("ENOTFOUND") }
    await expect(assertUrlSafe("https://nope.example.com/x", { resolve: boom, allowLocalhost: false })).rejects.toMatchObject({ code: "url_dns_failed" })
  })
})
