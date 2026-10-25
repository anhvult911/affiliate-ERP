import Link from "next/link";
import { DatabaseIcon, TerminalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * Rendered instead of the dashboard when NEXT_PUBLIC_SUPABASE_URL / ANON_KEY are
 * missing. Deliberately shows the exact steps — a silent empty dashboard would
 * look like working software.
 */
export function SetupRequired() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <DatabaseIcon className="size-5" />
            Kết nối Supabase để tiếp tục
          </CardTitle>
          <CardDescription>
            Cấu trúc database, phân quyền RLS và các truy vấn đã sẵn sàng — hệ thống cần thông tin kết nối tới dự án Supabase của bạn.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 text-sm">
          <ol className="list-inside list-decimal space-y-2">
            <li>
              Tạo một dự án trên Supabase, sau đó sao chép file <code className="font-mono">.env.example</code> thành{" "}
              <code className="font-mono">.env.local</code>.
            </li>
            <li>
              Điền các giá trị <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
              <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>,{" "}
              <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> và{" "}
              <code className="font-mono">GEMINI_API_KEY</code>.
            </li>
            <li>
              Chạy migration cấu trúc bảng: <code className="font-mono">pnpm db:push</code> (hoặc dán nội dung file{" "}
              <code className="font-mono">supabase/migrations/20261020090000_init_schema.sql</code>{" "}
              vào trình soạn thảo SQL của Supabase).
            </li>
            <li>
              Tạo tài khoản người vận hành (operator), sau đó cấp quyền vào hệ thống:
              <pre className="bg-muted mt-2 overflow-x-auto rounded-md p-3 font-mono text-xs">
                {`insert into public.operators (user_id, email)
select id, email from auth.users where email = 'you@example.com'
on conflict (user_id) do nothing;`}
              </pre>
            </li>
          </ol>

          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <TerminalIcon className="size-4" />
            Hoặc chạy stack local qua Supabase CLI: <code className="font-mono">npx supabase start</code> rồi{" "}
            <code className="font-mono">pnpm db:reset</code> (tự động nạp dữ liệu mẫu seed).
          </div>

          <Button asChild size="block">
            <Link href="/login">Thử đăng nhập lại</Link>
          </Button>

          <p className="text-muted-foreground text-xs">
            Trạng thái hiện tại: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY{" "}
            {isSupabaseConfigured ? "đã nhận diện." : "chưa được cấu hình."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
