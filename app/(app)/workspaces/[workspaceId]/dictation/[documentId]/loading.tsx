import { Loader2 } from "lucide-react"

export default function Loading() {
  return <div className="flex min-h-0 flex-1 items-center justify-center">
    <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
  </div>
}
