"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toggleProductActive } from "@/lib/actions/products";

/**
 * Optimistic active toggle: the switch flips immediately, then reverts with a
 * toast if the Server Action fails (e.g. the product was deleted elsewhere).
 */
export function ProductActiveSwitch({
  productId,
  isActive,
  showLabel = false,
  className
}: {
  productId: string;
  isActive: boolean;
  showLabel?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [checked, setChecked] = useState(isActive);

  useEffect(() => {
    setChecked(isActive);
  }, [isActive]);

  function handleChange(next: boolean) {
    setChecked(next);
    startTransition(async () => {
      const result = await toggleProductActive(productId, next);
      if (!result.ok) {
        setChecked(!next);
        toast.error(result.error);
        return;
      }

      toast.success(next ? "Product activated" : "Product paused");
      router.refresh();
    });
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Switch
        checked={checked}
        onCheckedChange={handleChange}
        disabled={pending}
        aria-label={checked ? "Pause product" : "Activate product"}
        className="relative before:absolute before:-inset-2.5 before:content-['']"
      />
      {showLabel ? (
        <span className="text-muted-foreground text-sm">{checked ? "Active" : "Paused"}</span>
      ) : null}
    </div>
  );
}
