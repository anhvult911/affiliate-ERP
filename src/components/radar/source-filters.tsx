"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SlidersHorizontalIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { SOURCE_TYPE_LABEL, SOURCE_TYPES, type SourceType } from "@/lib/constants";

type TypeFilter = SourceType | "all";

function FilterFields({
  idPrefix,
  query,
  onQueryChange,
  typeFilter,
  onTypeChange,
  activeOnly,
  onActiveChange
}: {
  idPrefix: string;
  query: string;
  onQueryChange: (value: string) => void;
  typeFilter: TypeFilter;
  onTypeChange: (value: TypeFilter) => void;
  activeOnly: boolean;
  onActiveChange: (value: boolean) => void;
}) {
  return (
    <>
      <div className="space-y-2 lg:min-w-64 lg:flex-1">
        <Label htmlFor={`${idPrefix}-search`}>Tìm kiếm</Label>
        <Input
          id={`${idPrefix}-search`}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Tên nguồn hoặc URL"
          inputMode="search"
          maxLength={120}
        />
      </div>

      <div className="space-y-2 lg:w-56">
        <Label htmlFor={`${idPrefix}-type`}>Loại nguồn</Label>
        <Select value={typeFilter} onValueChange={(value) => onTypeChange(value as TypeFilter)}>
          <SelectTrigger id={`${idPrefix}-type`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả các loại</SelectItem>
            {SOURCE_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {SOURCE_TYPE_LABEL[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex min-h-11 items-center justify-between gap-2 rounded-md border px-3 lg:min-h-9 lg:w-auto lg:justify-start lg:gap-3">
        <Label htmlFor={`${idPrefix}-active`} className="text-sm">
          Chỉ nguồn đang chạy
        </Label>
        <Switch id={`${idPrefix}-active`} checked={activeOnly} onCheckedChange={onActiveChange} />
      </div>
    </>
  );
}

/**
 * Filters round-trip through the URL (?type=&active=&q=). Local inputs stay in
 * sync with `useSearchParams`, so mobile back/forward restores the previous
 * filter set instead of leaving stale state on screen.
 */
export function SourceFilters() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending] = useTransition();
  const [mobileOpen, setMobileOpen] = useState(false);

  const initialTypeParam = searchParams.get("type");

  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(
    initialTypeParam && SOURCE_TYPES.includes(initialTypeParam as SourceType)
      ? (initialTypeParam as SourceType)
      : "all"
  );
  const [activeOnly, setActiveOnly] = useState(searchParams.get("active") === "1");

  useEffect(() => {
    const nextType = searchParams.get("type");
    setQuery(searchParams.get("q") ?? "");
    setTypeFilter(
      nextType && SOURCE_TYPES.includes(nextType as SourceType)
        ? (nextType as SourceType)
        : "all"
    );
    setActiveOnly(searchParams.get("active") === "1");
  }, [searchParams]);

  function navigate(nextQuery: string, nextType: TypeFilter, nextActiveOnly: boolean) {
    const params = new URLSearchParams();
    const term = nextQuery.trim();
    if (term) params.set("q", term);
    if (nextType !== "all") params.set("type", nextType);
    if (nextActiveOnly) params.set("active", "1");
    const search = params.toString();
    // See account-filters: same-route client transitions were unreliable in
    // production, so the filter performs a real navigation.
    window.location.assign(search ? `${pathname}?${search}` : pathname);
  }

  function applyFilters() {
    setMobileOpen(false);
    navigate(query, typeFilter, activeOnly);
  }

  function clearFilters() {
    setQuery("");
    setTypeFilter("all");
    setActiveOnly(false);
    setMobileOpen(false);
    navigate("", "all", false);
  }

  const activeFilterCount =
    (searchParams.get("q") ? 1 : 0) +
    (searchParams.get("type") ? 1 : 0) +
    (searchParams.get("active") ? 1 : 0);

  return (
    <div className="space-y-3">
      <div className="lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="lg" className="w-full justify-between">
              <span className="inline-flex items-center gap-2">
                <SlidersHorizontalIcon className="size-4" />
                Bộ lọc
              </span>
              {activeFilterCount > 0 ? (
                <Badge variant="info">{activeFilterCount} đang áp dụng</Badge>
              ) : (
                <span className="text-muted-foreground text-xs">Mặc định</span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="px-4 pt-4">
            <SheetHeader className="px-0">
              <SheetTitle>Lọc danh sách nguồn</SheetTitle>
              <SheetDescription>
                Bộ lọc được lưu trên URL, có thể lưu trữ hoặc chia sẻ.
              </SheetDescription>
            </SheetHeader>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                applyFilters();
              }}
              className="space-y-4"
            >
              <FilterFields
                idPrefix="mobile"
                query={query}
                onQueryChange={setQuery}
                typeFilter={typeFilter}
                onTypeChange={setTypeFilter}
                activeOnly={activeOnly}
                onActiveChange={setActiveOnly}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="flex-1"
                  onClick={clearFilters}
                  disabled={isPending}
                >
                  Đặt lại
                </Button>
                <Button type="submit" size="lg" className="flex-1" disabled={isPending}>
                  Áp dụng bộ lọc
                </Button>
              </div>
            </form>
          </SheetContent>
        </Sheet>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters();
        }}
        className="hidden flex-wrap items-end gap-2 lg:flex"
      >
        <FilterFields
          idPrefix="desktop"
          query={query}
          onQueryChange={setQuery}
          typeFilter={typeFilter}
          onTypeChange={setTypeFilter}
          activeOnly={activeOnly}
          onActiveChange={setActiveOnly}
        />
        <Button type="submit" size="default" disabled={isPending}>
          Áp dụng
        </Button>
        {activeFilterCount > 0 ? (
          <Button type="button" variant="ghost" size="default" onClick={clearFilters}>
            Đặt lại
          </Button>
        ) : null}
      </form>
    </div>
  );
}
