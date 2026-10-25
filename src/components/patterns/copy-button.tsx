"use client";

import { useState, type ComponentProps } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Copies affiliate links, Sub_IDs and proxy strings — used from mobile too. */
export function CopyButton({
  value,
  label = "Sao chép",
  className,
  size = "icon-sm",
  variant = "ghost"
}: {
  value: string;
  label?: string;
  className?: string;
  size?: ComponentProps<typeof Button>["size"];
  variant?: ComponentProps<typeof Button>["variant"];
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Đã sao chép vào bộ nhớ tạm");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Trình duyệt không hỗ trợ truy cập bộ nhớ tạm");
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={copy}
      className={cn(className)}
      aria-label={label}
    >
      {copied ? <CheckIcon className="text-success" /> : <CopyIcon />}
      {size === "icon-sm" || size === "icon" ? null : <span>{label}</span>}
    </Button>
  );
}
