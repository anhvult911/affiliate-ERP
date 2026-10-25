"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { toggleSourceActive } from "@/lib/actions/target-sources";
import { cn } from "@/lib/utils";

/**
 * Optimistic monitoring toggle. The row is re-rendered from the server after
 * the action succeeds, but flipping locally first keeps the tap responsive.
 */
export function SourceActiveSwitch({
  sourceId,
  isActive,
  name,
  showLabel = false,
  className
}: {
  sourceId: string;
  isActive: boolean;
  name: string;
  showLabel?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(isActive);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setChecked(isActive);
  }, [isActive]);

  function handleChange(next: boolean) {
    const previous = checked;
    setChecked(next);

    startTransition(async () => {
      const result = await toggleSourceActive(sourceId, next);
      if (!result.ok) {
        setChecked(previous);
        toast.error(result.error);
        return;
      }

      toast.success(next ? `Monitoring resumed for ${name}.` : `Monitoring paused for ${name}.`);
      router.refresh();
    });
  }

  return (
    <div className={cn("flex min-h-11 items-center gap-2", className)}>
      <Switch
        checked={checked}
        onCheckedChange={handleChange}
        disabled={pending}
        aria-label={`${checked ? "Pause" : "Resume"} monitoring for ${name}`}
        /* Same trick as the product switch: the thumb stays 24px, the hit area
           grows to the 44px a thumb can actually hit on a phone. */
        className="relative before:absolute before:-inset-2.5 before:content-['']"
      />
      {showLabel ? (
        <span className="text-muted-foreground text-xs">{checked ? "Active" : "Paused"}</span>
      ) : null}
    </div>
  );
}
