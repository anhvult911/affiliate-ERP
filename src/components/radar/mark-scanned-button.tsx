"use client";

import { useTransition, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, ScanLineIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { markSourceScanned } from "@/lib/actions/target-sources";

export function MarkScannedButton({
  sourceId,
  variant = "outline",
  size = "lg",
  className
}: {
  sourceId: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function markScanned() {
    startTransition(async () => {
      const result = await markSourceScanned(sourceId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Scan clock reset — the worker skips this source until the interval elapses.");
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={markScanned}
      disabled={pending}
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <ScanLineIcon />}
      Mark scanned
    </Button>
  );
}
