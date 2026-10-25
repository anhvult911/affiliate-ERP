"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Module-level error boundary. A failed Supabase query (RLS misconfiguration,
 * expired project, network drop on mobile) lands here with a retry instead of
 * Next's generic error screen.
 */
export default function DashboardError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side logs already carry the stack; this keeps the browser console usable.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TriangleAlertIcon className="text-destructive size-5" />
            Không thể tải màn hình này
          </CardTitle>
          <CardDescription>
            Hệ thống kết nối trực tiếp với Supabase — lỗi mất kết nối mạng, dự án tạm dừng hoặc quyền truy cập của người vận hành chưa được cấp sẽ xuất hiện tại đây.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">{error.message}</p>
          {error.digest ? (
            <p className="text-muted-foreground text-xs">Mã lỗi (Digest): {error.digest}</p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="block" onClick={reset}>
              <RotateCcwIcon />
              Thử lại
            </Button>
            <Button variant="outline" size="block" asChild>
              <Link href="/queue">Quay về Hàng đợi duyệt</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
