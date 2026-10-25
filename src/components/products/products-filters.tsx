"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontalIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const ALL_NICHES = "all";

type FilterFieldsProps = {
  idPrefix: string;
  search: string;
  onSearchChange: (value: string) => void;
  niche: string;
  onNicheChange: (value: string) => void;
  niches: string[];
  onlyActive: boolean;
  onOnlyActiveChange: (value: boolean) => void;
  actions: ReactNode;
  className?: string;
};

function FilterFields({
  idPrefix,
  search,
  onSearchChange,
  niche,
  onNicheChange,
  niches,
  onlyActive,
  onOnlyActiveChange,
  actions,
  className
}: FilterFieldsProps) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-search`} className="text-xs">
          Tìm kiếm
        </Label>
        <Input
          id={`${idPrefix}-search`}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Tìm theo tên sản phẩm"
          autoComplete="off"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-niche`} className="text-xs">
          Ngách sản phẩm
        </Label>
        <Select value={niche} onValueChange={onNicheChange}>
          <SelectTrigger id={`${idPrefix}-niche`}>
            <SelectValue placeholder="Tất cả ngách" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_NICHES}>Tất cả ngách</SelectItem>
            {niches.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-3 lg:pb-1.5">
        <Label htmlFor={`${idPrefix}-active`}>Chỉ sản phẩm kích hoạt</Label>
        <Switch
          id={`${idPrefix}-active`}
          className="relative before:absolute before:-inset-2.5 before:content-['']"
          checked={onlyActive}
          onCheckedChange={onOnlyActiveChange}
        />
      </div>

      {actions}
    </div>
  );
}

/**
 * Filter state is URL state: applying pushes /products?q=...&niche=...
 * so the server component re-queries and the view stays shareable.
 */
export function ProductsFilters({
  niches,
  query,
  niche,
  activeOnly
}: {
  niches: string[];
  query: string;
  niche: string;
  activeOnly: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(query);
  const [nicheValue, setNicheValue] = useState(niche || ALL_NICHES);
  const [onlyActive, setOnlyActive] = useState(activeOnly);

  const activeFilterCount =
    Number(search.trim() !== "") + Number(nicheValue !== ALL_NICHES) + Number(onlyActive);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const params = new URLSearchParams();
    const trimmed = search.trim();
    if (trimmed) params.set("q", trimmed);
    if (nicheValue !== ALL_NICHES) params.set("niche", nicheValue);
    if (onlyActive) params.set("active", "1");

    const searchString = params.toString();
    router.push(searchString ? `/products?${searchString}` : "/products");
    setOpen(false);
  }

  function clear() {
    setSearch("");
    setNicheValue(ALL_NICHES);
    setOnlyActive(false);
    setOpen(false);
    router.push("/products");
  }

  return (
    <>
      <Card className="hidden p-4 lg:block">
        <form onSubmit={apply}>
          <FilterFields
            idPrefix="desktop-filter"
            className="lg:grid lg:grid-cols-[minmax(0,1fr)_220px_auto_auto] lg:items-end lg:gap-3"
            search={search}
            onSearchChange={setSearch}
            niche={nicheValue}
            onNicheChange={setNicheValue}
            niches={niches}
            onlyActive={onlyActive}
            onOnlyActiveChange={setOnlyActive}
            actions={
              <div className="flex gap-2">
                <Button type="submit" size="lg">
                  Áp dụng
                </Button>
                <Button type="button" variant="ghost" size="lg" onClick={clear}>
                  Đặt lại
                </Button>
              </div>
            }
          />
        </form>
      </Card>

      <div className="lg:hidden">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full justify-between"
          onClick={() => setOpen(true)}
        >
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontalIcon />
            Bộ lọc
          </span>
          {activeFilterCount > 0 ? (
            <Badge variant="secondary">
              {activeFilterCount} đang áp dụng
            </Badge>
          ) : null}
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Lọc sản phẩm</SheetTitle>
            <SheetDescription>Tìm kiếm trong kho sản phẩm hoặc lọc theo ngách và trạng thái.</SheetDescription>
          </SheetHeader>
          <form onSubmit={apply} className="px-4 pb-4">
            <FilterFields
              idPrefix="mobile-filter"
              search={search}
              onSearchChange={setSearch}
              niche={nicheValue}
              onNicheChange={setNicheValue}
              niches={niches}
              onlyActive={onlyActive}
              onOnlyActiveChange={setOnlyActive}
              actions={
                <div className="grid gap-2 pt-2">
                  <Button type="submit" size="block">
                    Áp dụng bộ lọc
                  </Button>
                  <Button type="button" variant="ghost" size="block" onClick={clear}>
                    Đặt lại tất cả
                  </Button>
                </div>
              }
            />
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
