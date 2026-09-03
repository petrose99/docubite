// Mock Bigcapital API server for local development.
// Started automatically by dev-with-system-ca.mjs when BIGCAPITAL_ENABLED=true.
// Returns a sample trial balance for every /api/reports/* endpoint so the
// "From Accounting" flow works without a real Bigcapital instance.
import http from "node:http"

const trialBalance = {
  table: {
    columns: [
      { key: "name", label: "Account" },
      { key: "totals", label: "Totals", children: [
        { key: "debit", label: "Debit" },
        { key: "credit", label: "Credit" },
      ]},
    ],
    rows: [
      { cells: [{ key: "name", value: "Assets" }, { key: "debit", value: "$125,400.00" }, { key: "credit", value: "" }], children: [
        { cells: [{ key: "name", value: "Cash and Cash Equivalents" }, { key: "debit", value: "$45,200.00" }, { key: "credit", value: "" }], children: [
          { cells: [{ key: "name", value: "Checking Account" }, { key: "debit", value: "$32,100.00" }, { key: "credit", value: "" }] },
          { cells: [{ key: "name", value: "Savings Account" }, { key: "debit", value: "$13,100.00" }, { key: "credit", value: "" }] },
        ]},
        { cells: [{ key: "name", value: "Accounts Receivable" }, { key: "debit", value: "$38,750.00" }, { key: "credit", value: "" }] },
        { cells: [{ key: "name", value: "Inventory" }, { key: "debit", value: "$22,450.00" }, { key: "credit", value: "" }] },
        { cells: [{ key: "name", value: "Prepaid Expenses" }, { key: "debit", value: "$5,000.00" }, { key: "credit", value: "" }] },
        { cells: [{ key: "name", value: "Fixed Assets" }, { key: "debit", value: "$14,000.00" }, { key: "credit", value: "" }] },
      ]},
      { cells: [{ key: "name", value: "Liabilities" }, { key: "debit", value: "" }, { key: "credit", value: "$62,300.00" }], children: [
        { cells: [{ key: "name", value: "Accounts Payable" }, { key: "debit", value: "" }, { key: "credit", value: "$28,900.00" }] },
        { cells: [{ key: "name", value: "Accrued Expenses" }, { key: "debit", value: "" }, { key: "credit", value: "$8,400.00" }] },
        { cells: [{ key: "name", value: "Sales Tax Payable" }, { key: "debit", value: "" }, { key: "credit", value: "$3,200.00" }] },
        { cells: [{ key: "name", value: "Long-Term Debt" }, { key: "debit", value: "" }, { key: "credit", value: "$21,800.00" }] },
      ]},
      { cells: [{ key: "name", value: "Equity" }, { key: "debit", value: "" }, { key: "credit", value: "$63,100.00" }], children: [
        { cells: [{ key: "name", value: "Owner's Capital" }, { key: "debit", value: "" }, { key: "credit", value: "$50,000.00" }] },
        { cells: [{ key: "name", value: "Retained Earnings" }, { key: "debit", value: "" }, { key: "credit", value: "$13,100.00" }] },
      ]},
      { cells: [{ key: "name", value: "Total" }, { key: "debit", value: "$125,400.00" }, { key: "credit", value: "$125,400.00" }] },
    ],
  },
}

const profitLoss = {
  table: {
    columns: [
      { key: "name", label: "Account" },
      { key: "total", label: "Total" },
    ],
    rows: [
      { cells: [{ key: "name", value: "Income" }, { key: "total", value: "$89,500.00" }], children: [
        { cells: [{ key: "name", value: "Sales Revenue" }, { key: "total", value: "$72,000.00" }] },
        { cells: [{ key: "name", value: "Service Revenue" }, { key: "total", value: "$15,500.00" }] },
        { cells: [{ key: "name", value: "Interest Income" }, { key: "total", value: "$2,000.00" }] },
      ]},
      { cells: [{ key: "name", value: "Cost of Goods Sold" }, { key: "total", value: "($34,200.00)" }], children: [
        { cells: [{ key: "name", value: "Materials" }, { key: "total", value: "($22,800.00)" }] },
        { cells: [{ key: "name", value: "Direct Labor" }, { key: "total", value: "($11,400.00)" }] },
      ]},
      { cells: [{ key: "name", value: "Gross Profit" }, { key: "total", value: "$55,300.00" }] },
      { cells: [{ key: "name", value: "Operating Expenses" }, { key: "total", value: "($42,200.00)" }], children: [
        { cells: [{ key: "name", value: "Rent" }, { key: "total", value: "($12,000.00)" }] },
        { cells: [{ key: "name", value: "Salaries" }, { key: "total", value: "($18,500.00)" }] },
        { cells: [{ key: "name", value: "Utilities" }, { key: "total", value: "($3,200.00)" }] },
        { cells: [{ key: "name", value: "Marketing" }, { key: "total", value: "($5,500.00)" }] },
        { cells: [{ key: "name", value: "Insurance" }, { key: "total", value: "($3,000.00)" }] },
      ]},
      { cells: [{ key: "name", value: "Net Income" }, { key: "total", value: "$13,100.00" }] },
    ],
  },
}

const balanceSheet = {
  table: {
    columns: [
      { key: "name", label: "Account" },
      { key: "total", label: "Total" },
    ],
    rows: [
      { cells: [{ key: "name", value: "Assets" }, { key: "total", value: "$125,400.00" }], children: [
        { cells: [{ key: "name", value: "Current Assets" }, { key: "total", value: "$111,400.00" }], children: [
          { cells: [{ key: "name", value: "Cash" }, { key: "total", value: "$45,200.00" }] },
          { cells: [{ key: "name", value: "Accounts Receivable" }, { key: "total", value: "$38,750.00" }] },
          { cells: [{ key: "name", value: "Inventory" }, { key: "total", value: "$22,450.00" }] },
          { cells: [{ key: "name", value: "Prepaid Expenses" }, { key: "total", value: "$5,000.00" }] },
        ]},
        { cells: [{ key: "name", value: "Non-Current Assets" }, { key: "total", value: "$14,000.00" }] },
      ]},
      { cells: [{ key: "name", value: "Liabilities" }, { key: "total", value: "$62,300.00" }], children: [
        { cells: [{ key: "name", value: "Current Liabilities" }, { key: "total", value: "$40,500.00" }] },
        { cells: [{ key: "name", value: "Long-Term Liabilities" }, { key: "total", value: "$21,800.00" }] },
      ]},
      { cells: [{ key: "name", value: "Equity" }, { key: "total", value: "$63,100.00" }] },
      { cells: [{ key: "name", value: "Total Liabilities & Equity" }, { key: "total", value: "$125,400.00" }] },
    ],
  },
}

const agingSummary = {
  table: {
    columns: [
      { key: "name", label: "Contact" },
      { key: "current", label: "Current" },
      { key: "1_30", label: "1-30 days" },
      { key: "31_60", label: "31-60 days" },
      { key: "61_90", label: "61-90 days" },
      { key: "over_90", label: "Over 90 days" },
      { key: "total", label: "Total" },
    ],
    rows: [
      { cells: [{ key: "name", value: "Acme Corp" }, { key: "current", value: "$4,500.00" }, { key: "1_30", value: "$2,200.00" }, { key: "31_60", value: "" }, { key: "61_90", value: "" }, { key: "over_90", value: "" }, { key: "total", value: "$6,700.00" }] },
      { cells: [{ key: "name", value: "Beta Industries" }, { key: "current", value: "$8,100.00" }, { key: "1_30", value: "" }, { key: "31_60", value: "$3,400.00" }, { key: "61_90", value: "" }, { key: "over_90", value: "" }, { key: "total", value: "$11,500.00" }] },
      { cells: [{ key: "name", value: "Gamma Ltd" }, { key: "current", value: "" }, { key: "1_30", value: "" }, { key: "31_60", value: "" }, { key: "61_90", value: "$5,600.00" }, { key: "over_90", value: "$2,100.00" }, { key: "total", value: "$7,700.00" }] },
      { cells: [{ key: "name", value: "Total" }, { key: "current", value: "$12,600.00" }, { key: "1_30", value: "$2,200.00" }, { key: "31_60", value: "$3,400.00" }, { key: "61_90", value: "$5,600.00" }, { key: "over_90", value: "$2,100.00" }, { key: "total", value: "$25,900.00" }] },
    ],
  },
}

const generalLedger = {
  table: {
    columns: [
      { key: "date", label: "Date" },
      { key: "ref", label: "Reference" },
      { key: "description", label: "Description" },
      { key: "debit", label: "Debit" },
      { key: "credit", label: "Credit" },
      { key: "balance", label: "Balance" },
    ],
    rows: [
      { cells: [{ key: "date", value: "Checking Account (1010)" }, { key: "ref", value: "" }, { key: "description", value: "" }, { key: "debit", value: "" }, { key: "credit", value: "" }, { key: "balance", value: "" }], children: [
        { cells: [{ key: "date", value: "2026-01-05" }, { key: "ref", value: "INV-001" }, { key: "description", value: "Client payment" }, { key: "debit", value: "$12,500.00" }, { key: "credit", value: "" }, { key: "balance", value: "$12,500.00" }] },
        { cells: [{ key: "date", value: "2026-01-12" }, { key: "ref", value: "BILL-042" }, { key: "description", value: "Office supplies" }, { key: "debit", value: "" }, { key: "credit", value: "$1,200.00" }, { key: "balance", value: "$11,300.00" }] },
        { cells: [{ key: "date", value: "2026-01-20" }, { key: "ref", value: "INV-002" }, { key: "description", value: "Consulting fee" }, { key: "debit", value: "$8,500.00" }, { key: "credit", value: "" }, { key: "balance", value: "$19,800.00" }] },
        { cells: [{ key: "date", value: "2026-01-31" }, { key: "ref", value: "EXP-015" }, { key: "description", value: "Rent payment" }, { key: "debit", value: "" }, { key: "credit", value: "$4,000.00" }, { key: "balance", value: "$15,800.00" }] },
      ]},
      { cells: [{ key: "date", value: "Accounts Receivable (1200)" }, { key: "ref", value: "" }, { key: "description", value: "" }, { key: "debit", value: "" }, { key: "credit", value: "" }, { key: "balance", value: "" }], children: [
        { cells: [{ key: "date", value: "2026-01-03" }, { key: "ref", value: "INV-001" }, { key: "description", value: "Invoice to Acme Corp" }, { key: "debit", value: "$12,500.00" }, { key: "credit", value: "" }, { key: "balance", value: "$12,500.00" }] },
        { cells: [{ key: "date", value: "2026-01-05" }, { key: "ref", value: "PMT-001" }, { key: "description", value: "Payment received" }, { key: "debit", value: "" }, { key: "credit", value: "$12,500.00" }, { key: "balance", value: "$0.00" }] },
      ]},
    ],
  },
}

const REPORT_DATA = {
  "trial-balance-sheet": trialBalance,
  "general-ledger": generalLedger,
  "payable-aging-summary": agingSummary,
  "receivable-aging-summary": agingSummary,
  "profit-loss-sheet": profitLoss,
  "balance-sheet": balanceSheet,
}

const server = http.createServer((req, res) => {
  const url = req.url?.split("?")[0] ?? ""
  console.log(`${req.method} ${url}`)

  if (url.startsWith("/api/reports/")) {
    const reportType = url.replace("/api/reports/", "")
    const data = REPORT_DATA[reportType] ?? trialBalance
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify(data))
    return
  }

  // Catch-all for other API endpoints (accounts, vendors, etc.)
  if (url.startsWith("/api/")) {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ data: [] }))
    return
  }

  res.writeHead(404)
  res.end("not found")
})

server.listen(4000, () => console.log("Mock Bigcapital API on :4000"))
