import { describe, expect, it } from "vitest"
import { checkVatNumber } from "@/lib/checks/vat-number"

const GB_PATTERN = "^GB\\d{9}$"

describe("checkVatNumber", () => {
  it("returns null when there is no VAT number to check", () => {
    expect(checkVatNumber({ vatNumber: null, registrationNumberPattern: GB_PATTERN })).toBeNull()
  })

  it("passes when the VAT number matches the region's format", () => {
    const result = checkVatNumber({ vatNumber: "GB123456789", registrationNumberPattern: GB_PATTERN })
    expect(result?.status).toBe("pass")
    expect(result?.checkCode).toBe("vat_number_format")
  })

  it("strips spaces before matching", () => {
    const result = checkVatNumber({ vatNumber: "GB 123 456 789", registrationNumberPattern: GB_PATTERN })
    expect(result?.status).toBe("pass")
  })

  it("warns when the VAT number does not match the region's format", () => {
    const result = checkVatNumber({ vatNumber: "FR123456789", registrationNumberPattern: GB_PATTERN })
    expect(result?.status).toBe("warn")
    expect(result?.message).toContain("FR123456789")
  })

  it("returns null when the stored pattern is not a valid regex", () => {
    expect(checkVatNumber({ vatNumber: "GB123456789", registrationNumberPattern: "(" })).toBeNull()
  })
})
