import { Button } from "@/components/ui/button"
import { FileQuestion } from "lucide-react"
import Link from "next/link"

export default function DocumentNotFound() {
  return <main className="flex flex-1 items-center justify-center p-8">
    <div className="max-w-md space-y-4 text-center">
      <FileQuestion className="mx-auto h-12 w-12 text-slate-400" />
      <h1 className="text-2xl font-bold text-slate-900">Document not found</h1>
      <p className="text-sm text-slate-500">It may have been deleted, or it belongs to a different workspace.</p>
      <Button asChild variant="outline"><Link href="../">Back to documents</Link></Button>
    </div>
  </main>
}
