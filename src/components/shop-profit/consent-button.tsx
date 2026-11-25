"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { recordShopProfitConsent } from "@/lib/actions/shop-profit";

export function ShopProfitConsentButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function record() {
    startTransition(async () => {
      const result = await recordShopProfitConsent(leadId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(
        result.data.alreadyRecorded
          ? "Lead đã có xác nhận đồng ý."
          : "Đã ghi nhận đồng ý nhận file trong CRM."
      );
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={record}
      disabled={pending}
      className="min-h-11"
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <ShieldCheckIcon />}
      Ghi nhận khách đồng ý
    </Button>
  );
}
