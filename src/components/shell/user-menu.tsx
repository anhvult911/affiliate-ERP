"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOutIcon, UserRoundIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { ThemeToggleDropdown } from "@/components/shell/theme-toggle";
import { signOutAction } from "@/lib/actions/auth";

export function UserMenu({ email, className }: { email: string | null; className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function signOut() {
    startTransition(async () => {
      const result = await signOutAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.replace("/login");
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={className ?? "h-auto w-full justify-start gap-2 px-3 py-2"}
          disabled={pending}
        >
          <UserRoundIcon className="size-4 shrink-0" />
          <span className="truncate text-sm font-normal">{email ?? "Operator"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="truncate">{email ?? "Operator"}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ThemeToggleDropdown />
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={signOut} disabled={pending}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
