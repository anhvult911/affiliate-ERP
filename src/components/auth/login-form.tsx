"use client";

import { AlertCircleIcon } from "lucide-react";

import { SubmitButton } from "@/components/patterns/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction } from "@/lib/actions/auth";
import { useFormAction } from "@/lib/hooks/use-form-action";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const { state, pending, submit } = useFormAction((formData) => signInAction(null, formData));

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={nextPath} />

      <div className="grid gap-2">
        <Label htmlFor="email">Email người vận hành (Operator)</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          required
          placeholder="op@local.test"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="password">Mật khẩu</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={6}
        />
      </div>

      {state && !state.ok ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <SubmitButton size="block" pending={pending} pendingLabel="Đang đăng nhập…">
        Đăng nhập
      </SubmitButton>
    </form>
  );
}
