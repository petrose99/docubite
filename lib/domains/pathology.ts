/** The pathology domain pack.
 *
 * Nothing here is plumbing — it is data in the same field DSL the finance pack uses, which is the
 * whole argument for the adapter design: a new clinical domain is a template, not a code path.
 *
 * Two deliberate choices. Dates are `date`, not string, so "cases signed out last quarter" is an
 * index scan rather than a text comparison. `ihc_markers` is an array with itemFields, so each
 * marker projects to its own filterable row (models/document-field-values) and a query can ask for
 * "ER-positive cases" without parsing a prose blob.
 *
 * Grade and stage are left as free strings on purpose: grading systems are organ- and
 * protocol-specific (Gleason, Nottingham, FIGO), and an enum here would silently drop any value
 * outside whichever system we happened to hard-code. Constraining them belongs in the per-specimen
 * report template, not in the extraction schema. */
export const PATHOLOGY_TEMPLATES = [
  {
    code: "pathology_report", name: "Pathology report", documentType: "pathology_report", isSystem: false, multiRow: false,
    fields: [
      { key: "patient_id", label: "Patient identifier", type: "string", instruction: "Medical record number or patient identifier exactly as printed", required: false },
      { key: "accession_no", label: "Accession number", type: "string", instruction: "Surgical pathology accession or case number", required: true },
      { key: "specimen_type", label: "Specimen type", type: "string", instruction: "The specimen as received, e.g. core biopsy, resection, excision", required: true },
      { key: "anatomical_site", label: "Anatomical site", type: "string", instruction: "Body site the specimen was taken from, including laterality if stated", required: true },
      { key: "collection_date", label: "Collection date", type: "date", instruction: "Date the specimen was collected", required: false },
      { key: "sign_out_date", label: "Sign-out date", type: "date", instruction: "Date the case was signed out", required: false },
      { key: "diagnosis", label: "Diagnosis", type: "string", instruction: "The final diagnosis line, quoted as stated; do not summarize or reinterpret", required: true },
      { key: "diagnosis_code", label: "Diagnosis code", type: "string", instruction: "ICD-O, ICD-10, or SNOMED code if one is printed; omit if absent", required: false },
      { key: "grade", label: "Grade", type: "string", instruction: "Histologic grade exactly as stated, including the grading system named", required: false },
      { key: "stage", label: "Stage", type: "string", instruction: "Pathologic stage exactly as stated, e.g. pT2N0", required: false },
      { key: "margin_status", label: "Margin status", type: "string", instruction: "Margin involvement as stated, with the closest margin distance if given", required: false },
      { key: "ihc_markers", label: "IHC markers", type: "array", instruction: "Each immunohistochemical marker reported", required: false, itemFields: [
        { key: "name", label: "Marker", type: "string", instruction: "Marker name, e.g. ER, PR, HER2, Ki-67", required: true },
        { key: "result", label: "Result", type: "string", instruction: "Reported result, e.g. positive, negative, equivocal", required: false },
        { key: "intensity", label: "Intensity", type: "string", instruction: "Staining intensity if reported, e.g. weak, moderate, strong", required: false },
        { key: "percent_positive", label: "Percent positive", type: "number", instruction: "Percentage of positive cells, as a plain number", required: false },
      ] },
    ],
  },
] as const

/** Context-biasing terms for the ASR backend (Stage 3). Dictated pathology is dense with vocabulary
 * a general speech model has never been trained on, and biasing is the cheapest correction
 * available — these are the terms whose mis-transcription would change a diagnosis. */
export const PATHOLOGY_BIAS_TERMS = [
  "adenocarcinoma", "carcinoma in situ", "invasive ductal carcinoma", "lobular", "squamous cell",
  "immunohistochemistry", "IHC", "ER", "PR", "HER2", "Ki-67", "p53", "CK7", "CK20", "TTF-1",
  "Gleason", "Nottingham", "FIGO", "perineural invasion", "lymphovascular invasion",
  "margin", "resection", "excision", "core biopsy", "frozen section", "accession",
  "hyperplasia", "dysplasia", "metaplasia", "necrosis", "mitotic figures", "pleomorphism",
] as const
