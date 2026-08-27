/** A phone camera's default JPEG is routinely 8-12 MB — the document itself compresses to a
 * fraction of that once resized, and re-uploading the huge original wastes a mobile visitor's
 * data for the exact same OCR result. Downscaled client-side via canvas, entirely in the browser
 * (WP13's camera capture) — nothing here touches the network. */
const MAX_DIMENSION = 2400
const JPEG_QUALITY = 0.85

export async function downscaleImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/heic") return file

  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return file

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  if (scale >= 1) { bitmap.close(); return file }

  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext("2d")
  if (!context) { bitmap.close(); return file }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY))
  if (!blob) return file

  return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" })
}
