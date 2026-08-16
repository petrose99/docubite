"use client"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { InputHTMLAttributes } from "react"

type FormInputProps = InputHTMLAttributes<HTMLInputElement> & { title?: string; isRequired?: boolean }

export function FormInput({ title, isRequired = false, ...props }: FormInputProps) {
  const empty = (!props.defaultValue || props.defaultValue.toString().trim() === "") && !props.value
  return <label className="flex flex-col gap-1"><span className="text-sm font-medium">{title}</span><Input {...props} id={props.id || props.name} className={cn(isRequired && empty && "bg-yellow-50", props.className)} data-1p-ignore /></label>
}
