"use client"

import { Camera, Upload } from "lucide-react"
import { useEffect, useState } from "react"

export function MobileUploadButtons({ workspaceId, fileId }: { workspaceId: string; fileId: string }) {
  const [isPwa, setIsPwa] = useState(false)

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true)
    setIsPwa(standalone)
  }, [])

  return <div className="flex gap-2.5 md:hidden">
    {isPwa && <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-[13px] bg-[linear-gradient(180deg,#0b8f66,#047857)] py-[13px] text-[14.5px] font-semibold text-white shadow-[0_1px_2px_rgba(4,120,87,0.4),0_6px_16px_rgba(4,120,87,0.22)]">
      <Camera className="h-[18px] w-[18px]" />
      Scan with camera
      <input type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) window.location.href = `/workspaces/${workspaceId}/files/${fileId}`
        }} />
    </label>}
    <a href={`/workspaces/${workspaceId}/files/${fileId}`}
      className="flex flex-1 items-center justify-center gap-2 rounded-[13px] border border-[#d5dee6] bg-white py-[13px] text-[14.5px] font-semibold text-emerald-700 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
      <Upload className="h-[18px] w-[18px]" />
      Upload
    </a>
  </div>
}
