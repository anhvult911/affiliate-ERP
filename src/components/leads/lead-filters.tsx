"use client";

import { useState } from "react";
import { SearchIcon, SlidersHorizontalIcon } from "lucide-react";

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
  LEAD_CATEGORIES,
  LEAD_CATEGORY_LABEL,
  LEAD_STATUSES,
  LEAD_STATUS_LABEL,
  type LeadCategory,
  type LeadStatus
} from "@/lib/leads/status";
import { buildLeadsHref, hasLeadFilters, type LeadListUrlState } from "@/lib/leads/url";

const ALL_STATUSES = "all";
const ALL_CATEGORIES = "all";
const ALL_SCORES = "all";

/**
 * Filters round-trip through `/leads?status=&score=&category=&q=` and reset the
 * page to 1. All values are validated again by the server page, so a
 * hand-edited URL cannot inject a wildcard or a huge offset.
 */
export function LeadFilters({ state }: { state: LeadListUrlState }) {
  const [query, setQuery] = useState(state.query);
  const [status, setStatus] = useState<LeadStatus | null>(state.status);
  const [minScore, setMinScore] = useState<number | null>(state.minScore);
  const [category, setCategory] = useState<LeadCategory | null>(state.category);

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    window.location.assign(
      buildLeadsHref({ status, minScore, category, query, page: 1 })
    );
  }

  function resetFilters() {
    setQuery("");
    setStatus(null);
    setMinScore(null);
    setCategory(null);
    window.location.assign(buildLeadsHref({}));
  }

  const active = hasLeadFilters(state);

  return (
    <form
      onSubmit={applyFilters}
      className="bg-card flex flex-col gap-3 rounded-xl border p-3 sm:p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-sm font-medium">
          <SlidersHorizontalIcon className="size-4" />
          Bộ lọc lead
        </p>
        {active ? <Badge variant="info">Đang áp dụng</Badge> : null}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="lead-search">Tìm kiếm</Label>
        <Input
          id="lead-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tên nhóm, tác giả, nội dung, tóm tắt, ghi chú…"
          inputMode="search"
          maxLength={120}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="lead-status-filter">Trạng thái</Label>
          <Select
            value={status ?? ALL_STATUSES}
            onValueChange={(value) =>
              setStatus(value === ALL_STATUSES ? null : (value as LeadStatus))
            }
          >
            <SelectTrigger id="lead-status-filter" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>Tất cả trạng thái</SelectItem>
              {LEAD_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {LEAD_STATUS_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="lead-score-filter">Điểm tối thiểu</Label>
          <Select
            value={minScore === null ? ALL_SCORES : String(minScore)}
            onValueChange={(value) => setMinScore(value === ALL_SCORES ? null : Number(value))}
          >
            <SelectTrigger id="lead-score-filter" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SCORES}>Mọi điểm số</SelectItem>
              {[3, 4, 5].map((value) => (
                <SelectItem key={value} value={String(value)}>
                  Từ {value}/5 trở lên
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="lead-category-filter">Nhóm nhu cầu</Label>
          <Select
            value={category ?? ALL_CATEGORIES}
            onValueChange={(value) =>
              setCategory(value === ALL_CATEGORIES ? null : (value as LeadCategory))
            }
          >
            <SelectTrigger id="lead-category-filter" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES}>Mọi nhóm nhu cầu</SelectItem>
              {LEAD_CATEGORIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {LEAD_CATEGORY_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" size="lg" className="sm:w-auto">
          <SearchIcon />
          Áp dụng bộ lọc
        </Button>
        {active ? (
          <Button type="button" variant="outline" size="lg" onClick={resetFilters}>
            Xóa tất cả bộ lọc
          </Button>
        ) : null}
      </div>
    </form>
  );
}
