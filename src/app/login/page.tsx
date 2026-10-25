import type { Metadata } from "next";
import { Zap } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";
import { SetupRequired } from "@/components/shell/setup-required";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Đăng nhập" };

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequired />;

  const { next } = await searchParams;
  const nextPath = next && next.startsWith("/") ? next : "/queue";

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <span className="bg-primary text-primary-foreground mb-1 flex size-9 items-center justify-center rounded-md">
            <Zap className="size-5" />
          </span>
          <CardTitle className="text-lg">Affiliate Automation ERP</CardTitle>
          <CardDescription>
            Đăng nhập bằng tài khoản Operator được cấp quyền trong{" "}
            <code className="font-mono">public.operators</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm nextPath={nextPath} />
        </CardContent>
      </Card>
    </div>
  );
}
