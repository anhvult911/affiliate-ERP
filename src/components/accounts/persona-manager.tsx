"use client";

import { useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { SubmitButton } from "@/components/patterns/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateAccountPersona } from "@/lib/actions/accounts";
import type { AccountRow } from "@/lib/data/accounts";
import { useFormAction } from "@/lib/hooks/use-form-action";
import { parsePersonaSchedule, type PersonaScheduleEntry } from "@/lib/validations/account";

const MAX_SCHEDULE_ROWS = 24;
const NEW_ROW: PersonaScheduleEntry = { at: "09:00", kind: "" };

export function PersonaManager({ account }: { account: AccountRow }) {
  const [entries, setEntries] = useState<PersonaScheduleEntry[]>(() =>
    parsePersonaSchedule(account.persona_schedule)
  );

  const { fieldErrors, pending, submit } = useFormAction(
    async (formData) =>
      updateAccountPersona(account.id, {
        persona_type: formData.get("persona_type"),
        persona_schedule: formData.get("persona_schedule")
      }),
    {
      onSuccess: () => toast.success("Đã lưu lịch nuôi persona"),
      onError: (message) => toast.error(message)
    }
  );

  function updateEntry(index: number, patch: Partial<PersonaScheduleEntry>) {
    setEntries((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry
      )
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="persona-type">Loại persona</Label>
        <Input
          id="persona-type"
          name="persona_type"
          defaultValue={account.persona_type}
          maxLength={40}
          required
          aria-invalid={Boolean(fieldErrors.persona_type) || undefined}
        />
        {fieldErrors.persona_type ? (
          <p className="text-destructive text-xs">{fieldErrors.persona_type[0]}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Lịch nuôi nick</p>
            <p className="text-muted-foreground text-xs">
              {entries.length} of {MAX_SCHEDULE_ROWS} daily slots
            </p>
          </div>
        </div>

        {entries.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
            No time slots yet. Add the first action the worker should run for this persona.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map((entry, index) => (
              <div
                key={index}
                className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-end gap-2"
              >
                <div className="grid gap-1">
                  <Label htmlFor={`schedule-at-${index}`} className="text-xs">
                    Time
                  </Label>
                  <Input
                    id={`schedule-at-${index}`}
                    type="time"
                    value={entry.at}
                    onChange={(event) => updateEntry(index, { at: event.target.value })}
                    required
                  />
                </div>
                <div className="grid min-w-0 gap-1">
                  <Label htmlFor={`schedule-kind-${index}`} className="text-xs">
                    Action
                  </Label>
                  <Input
                    id={`schedule-kind-${index}`}
                    value={entry.kind}
                    placeholder="lifestyle_post"
                    maxLength={80}
                    onChange={(event) => updateEntry(index, { kind: event.target.value })}
                    required
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${entry.at} slot`}
                  onClick={() =>
                    setEntries((current) => current.filter((_, entryIndex) => entryIndex !== index))
                  }
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full sm:w-auto"
          disabled={entries.length >= MAX_SCHEDULE_ROWS}
          onClick={() => setEntries((current) => [...current, { ...NEW_ROW }])}
        >
          <PlusIcon />
          Add time slot
        </Button>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-amber-600">
          Chưa có mục nào: nick sẽ không tự đăng bài hay cross-warm. Thêm ít nhất một mục
          (ví dụ 09:30 lifestyle_post) hoặc tắt nuôi nick nếu không muốn.
        </p>
      ) : null}
      <input type="hidden" name="persona_schedule" value={JSON.stringify(entries)} />
      {fieldErrors.persona_schedule ? (
        <p className="text-destructive text-xs">{fieldErrors.persona_schedule[0]}</p>
      ) : null}

      <SubmitButton size="lg" className="w-full sm:w-auto" pending={pending} pendingLabel="Đang lưu…">
        Lưu persona
      </SubmitButton>
    </form>
  );
}
