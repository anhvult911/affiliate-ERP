"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { toLocalDateTimeInputValue } from "@/components/accounts/datetime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  adjustTrustScore,
  setAccountStatus,
  toggleWarmup
} from "@/lib/actions/accounts";
import {
  ACCOUNT_STATUSES,
  ACCOUNT_STATUS_LABEL,
  type AccountStatus
} from "@/lib/constants";
import type { AccountRow } from "@/lib/data/accounts";

export function AccountControls({ account }: { account: AccountRow }) {
  const warmupId = useId();
  const [pending, startTransition] = useTransition();
  const [cooldownOpen, setCooldownOpen] = useState(account.status === "cooldown");
  const [cooldownValue, setCooldownValue] = useState(() =>
    toLocalDateTimeInputValue(account.cooldown_until)
  );
  const [warmup, setWarmup] = useState(account.warmup_enabled);

  function applyStatus(next: AccountStatus, until?: string) {
    startTransition(async () => {
      const result = await setAccountStatus(account.id, next, until);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Status set to ${ACCOUNT_STATUS_LABEL[next].toLowerCase()}`);
      if (next !== "cooldown") setCooldownOpen(false);
    });
  }

  function adjust(delta: number) {
    startTransition(async () => {
      const result = await adjustTrustScore(account.id, delta);
      if (result.ok) toast.success(`Trust score adjusted by ${delta > 0 ? "+" : ""}${delta}`);
      else toast.error(result.error);
    });
  }

  function changeWarmup(enabled: boolean) {
    setWarmup(enabled);
    startTransition(async () => {
      const result = await toggleWarmup(account.id, enabled);
      if (result.ok) {
        toast.success(enabled ? "Warmup enabled" : "Warmup paused");
      } else {
        setWarmup(!enabled);
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">Execution status</p>
        <div className="grid grid-cols-3 gap-2">
          {ACCOUNT_STATUSES.map((value) => {
            const selected = account.status === value;
            return (
              <Button
                key={value}
                type="button"
                size="lg"
                variant={selected ? "default" : "outline"}
                aria-pressed={selected}
                disabled={pending}
                className="px-2"
                onClick={() => {
                  if (value === "cooldown") {
                    setCooldownOpen(true);
                    return;
                  }
                  applyStatus(value);
                }}
              >
                {ACCOUNT_STATUS_LABEL[value]}
              </Button>
            );
          })}
        </div>
        {cooldownOpen ? (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="grid gap-1">
              <Label htmlFor="cooldown-until">Cooldown ends</Label>
              <Input
                id="cooldown-until"
                type="datetime-local"
                value={cooldownValue}
                onChange={(event) => setCooldownValue(event.target.value)}
              />
            </div>
            <Button
              type="button"
              size="lg"
              disabled={pending || cooldownValue.length === 0}
              onClick={() => applyStatus("cooldown", cooldownValue)}
            >
              Apply cooldown
            </Button>
          </div>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Cooldown pauses the worker until the chosen time; checkpoint requires a manual reset.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Trust score</p>
          <p className="text-muted-foreground text-xs">Always clamped between 0 and 100.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Decrease trust score by 5"
            disabled={pending || account.trust_score <= 0}
            onClick={() => adjust(-5)}
          >
            −5
          </Button>
          <span className="w-10 text-center text-lg font-semibold tabular-nums">
            {account.trust_score}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Increase trust score by 5"
            disabled={pending || account.trust_score >= 100}
            onClick={() => adjust(5)}
          >
            +5
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Warmup enabled</p>
          <p className="text-muted-foreground text-xs">
            Runs the persona schedule to build trust before commenting.
          </p>
        </div>
        <Label
          htmlFor={warmupId}
          className="flex min-h-11 shrink-0 cursor-pointer items-center"
        >
          <Switch
            id={warmupId}
            checked={warmup}
            disabled={pending}
            onCheckedChange={changeWarmup}
          />
        </Label>
      </div>
    </div>
  );
}
