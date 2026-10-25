"use client";

import { LaptopIcon, MoonIcon, SunIcon } from "lucide-react";

import { useTheme } from "@/components/shell/theme-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

export function ThemeToggleDropdown() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  return (
    <div className="flex items-center justify-between px-2 py-1.5 text-sm">
      <span className="text-muted-foreground flex items-center gap-2 text-xs">
        {resolvedTheme === "dark" ? (
          <MoonIcon className="size-3.5" />
        ) : (
          <SunIcon className="size-3.5" />
        )}
        Giao diện
      </span>
      <div className="flex items-center gap-1 rounded-md border p-0.5">
        <button
          type="button"
          onClick={() => setTheme("light")}
          title="Giao diện sáng"
          className={`flex size-6 items-center justify-center rounded-sm transition-colors ${
            theme === "light"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <SunIcon className="size-3.5" />
          <span className="sr-only">Sáng</span>
        </button>
        <button
          type="button"
          onClick={() => setTheme("dark")}
          title="Giao diện tối"
          className={`flex size-6 items-center justify-center rounded-sm transition-colors ${
            theme === "dark"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <MoonIcon className="size-3.5" />
          <span className="sr-only">Tối</span>
        </button>
        <button
          type="button"
          onClick={() => setTheme("system")}
          title="Theo hệ điều hành"
          className={`flex size-6 items-center justify-center rounded-sm transition-colors ${
            theme === "system"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <LaptopIcon className="size-3.5" />
          <span className="sr-only">Hệ thống</span>
        </button>
      </div>
    </div>
  );
}

export function ThemeToggleButton() {
  const { setTheme, resolvedTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Đổi giao diện">
          {resolvedTheme === "dark" ? (
            <MoonIcon className="size-4.5" />
          ) : (
            <SunIcon className="size-4.5" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")} className="gap-2 text-xs">
          <SunIcon className="size-3.5" /> Sáng
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")} className="gap-2 text-xs">
          <MoonIcon className="size-3.5" /> Tối
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")} className="gap-2 text-xs">
          <LaptopIcon className="size-3.5" /> Theo hệ thống
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
