"use client";

import { useState, type FormEvent } from "react";
import { SearchIcon } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  ACCOUNT_STATUSES,
  ACCOUNT_STATUS_LABEL,
  type AccountStatus
} from "@/lib/constants";

const ALL_STATUSES = "all";

/**
 * URL-driven filters: the server page owns the query, this component only
 * rewrites the search params, so results survive a refresh and can be shared.
 */
export function AccountFilters({
  query,
  status
}: {
  query: string;
  status: AccountStatus | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [term, setTerm] = useState(query);
  const [statusValue, setStatusValue] = useState<string>(status ?? ALL_STATUSES);

  function navigate(nextTerm: string, nextStatus: string) {
    const params = new URLSearchParams(searchParams.toString());
    const trimmed = nextTerm.trim();
    if (trimmed) params.set("q", trimmed);
    else params.delete("q");
    if (nextStatus !== ALL_STATUSES) params.set("status", nextStatus);
    else params.delete("status");

    const search = params.toString();
    // Native navigation: client-side `router.replace` to a new query on the same
    // route did not commit in production (RSC 200, URL unchanged), so the filter
    // looked dead. A real navigation always works and the server renders in ~60ms.
    window.location.assign(search ? `${pathname}?${search}` : pathname);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate(term, statusValue);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative min-w-0 flex-1">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Tìm theo tên hoặc persona"
          aria-label="Tìm kiếm tài khoản"
          className="pl-9"
          autoCapitalize="none"
        />
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={statusValue}
          onValueChange={(value) => {
            setStatusValue(value);
            navigate(term, value);
          }}
        >
          <SelectTrigger className="flex-1 sm:w-44" aria-label="Lọc theo trạng thái">
            <SelectValue placeholder="Tất cả trạng thái" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUSES}>Tất cả trạng thái</SelectItem>
            {ACCOUNT_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {ACCOUNT_STATUS_LABEL[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="submit"
          variant="outline"
          size="icon"
          aria-label="Áp dụng tìm kiếm"
          className="shrink-0"
        >
          <SearchIcon />
        </Button>
      </div>
    </form>
  );
}
