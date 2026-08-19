/** The logistics domain pack: shipment and delivery documents.
 *
 * `status` is an enum here, unlike pathology's grade/stage, because carrier status vocabulary is
 * small and closed enough to be worth constraining — a constrained enum is what lets "all delayed
 * shipments" be an exact filter rather than a fuzzy text match over a dozen phrasings. */
export const LOGISTICS_TEMPLATES = [
  {
    code: "shipment", name: "Shipment document", documentType: "shipment", isSystem: false, multiRow: true,
    fields: [
      { key: "shipment_id", label: "Shipment ID", type: "string", instruction: "Shipment, consignment, or booking reference", required: true },
      { key: "tracking_no", label: "Tracking number", type: "string", instruction: "Carrier tracking or airway bill number", required: false },
      { key: "carrier", label: "Carrier", type: "string", instruction: "Carrier or freight forwarder name", required: false },
      { key: "origin", label: "Origin", type: "string", instruction: "Origin location as printed, city and country where given", required: false },
      { key: "destination", label: "Destination", type: "string", instruction: "Destination location as printed, city and country where given", required: false },
      { key: "order_date", label: "Order date", type: "date", instruction: "Date the order was placed", required: false },
      { key: "ship_date", label: "Ship date", type: "date", instruction: "Date the shipment departed", required: false },
      { key: "delivery_date", label: "Delivery date", type: "date", instruction: "Delivery date, actual if stated, otherwise the estimate", required: false },
      { key: "status", label: "Status", type: "enum", instruction: "Current shipment status; choose the closest listed option", required: false,
        options: ["pending", "in_transit", "out_for_delivery", "delivered", "delayed", "exception", "returned", "cancelled"] },
      { key: "skus", label: "Items", type: "array", instruction: "Each line of the packing list", required: false, itemFields: [
        { key: "sku", label: "SKU", type: "string", instruction: "Stock keeping unit or part number", required: true },
        { key: "description", label: "Description", type: "string", instruction: "Item description", required: false },
        { key: "quantity", label: "Quantity", type: "number", instruction: "Quantity shipped", required: false },
      ] },
    ],
  },
] as const

/** Context-biasing terms for the ASR backend (Stage 3). */
export const LOGISTICS_BIAS_TERMS = [
  "airway bill", "bill of lading", "consignment", "SKU", "pallet", "container", "TEU",
  "customs", "incoterms", "FOB", "CIF", "DDP", "freight forwarder", "in transit", "out for delivery",
] as const
