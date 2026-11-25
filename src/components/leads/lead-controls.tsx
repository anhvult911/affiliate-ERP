"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, SaveIcon } from "lucide-react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { updateLead } from "@/lib/actions/leads";
import { fromDateTimeLocal, toDateTimeLocal } from "@/lib/leads/datetime";
import { LEAD_STATUSES, leadStatusLabel } from "@/lib/leads/status";
import { formatDateTime } from "@/lib/format";

export function LeadControls({
  leadId,
  status,
  notes,
  nextFollowupAt
}: {
  leadId: string;
  status: string;
  notes: string | null;
  nextFollowupAt: string | null;
}) {
  const router = useRouter();
  const [statusValue, setStatusValue] = useState(status);
  const [notesValue, setNotesValue] = useState(notes ?? "");
  const [followupValue, setFollowupValue] = useState(toDateTimeLocal(nextFollowupAt));
  const [statusPending, startStatusTransition] = useTransition();
  const [savePending, startSaveTransition] = useTransition();
  const pending = statusPending || savePending;

  function changeStatus(next: string) {
    const previous = statusValue;
    setStatusValue(next);

    startStatusTransition(async () => {
      const result = await updateLead({
        id: leadId,
        status: next,
        // A date the operator typed (or cleared) before changing status is an
        // explicit override; an untouched blank field lets the DB trigger
        // schedule +48h / clear the clock for this transition.
        next_followup_at: fromDateTimeLocal(followupValue)
      });
      if (!result.ok) {
        setStatusValue(previous);
        toast.error(result.error);
        return;
      }

      // A successful reply/freebie moves the authoritative reminder 48h out;
      // mirror the server value so the manual field is not stale.
      setFollowupValue(toDateTimeLocal(result.data.nextFollowupAt));
      toast.success(`Đã chuyển lead sang “${leadStatusLabel(result.data.status)}”`, {
        description: result.data.nextFollowupAt
          ? `Nhắc lại: ${formatDateTime(result.data.nextFollowupAt)}`
          : "Không còn lịch nhắc lại cho lead này."
      });
      router.refresh();
    });
  }

  function saveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startSaveTransition(async () => {
      const result = await updateLead({
        id: leadId,
        notes: notesValue,
        next_followup_at: fromDateTimeLocal(followupValue)
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setFollowupValue(toDateTimeLocal(result.data.nextFollowupAt));
      toast.success("Đã lưu ghi chú và lịch nhắc lại.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`lead-status-${leadId}`}>Trạng thái chăm sóc</Label>
          <Select value={statusValue} onValueChange={changeStatus} disabled={pending}>
            <SelectTrigger id={`lead-status-${leadId}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAD_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {leadStatusLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            “Đã trả lời” / “Đã gửi template” tự hẹn nhắc lại sau 48 giờ. Trạng thái mua, upsell
            hoặc bỏ qua sẽ xóa lịch nhắc.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`lead-followup-${leadId}`}>Nhắc lại (tùy chọn)</Label>
          <Input
            id={`lead-followup-${leadId}`}
            type="datetime-local"
            value={followupValue}
            onChange={(event) => setFollowupValue(event.target.value)}
            disabled={pending}
          />
          <p className="text-muted-foreground text-xs">
            Nhập để ghi đè mốc 48 giờ; để trống và bấm lưu để xóa lịch nhắc.
          </p>
        </div>
      </div>

      <form onSubmit={saveDetails} className="space-y-2">
        <Label htmlFor={`lead-notes-${leadId}`}>Ghi chú</Label>
        <Textarea
          id={`lead-notes-${leadId}`}
          value={notesValue}
          onChange={(event) => setNotesValue(event.target.value)}
          placeholder="Đã inbox chưa, khách phản hồi gì, bước tiếp theo…"
          maxLength={4000}
          rows={3}
          disabled={pending}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">{notesValue.length}/4.000</span>
          <Button type="submit" size="sm" className="min-h-11 sm:min-h-9" disabled={pending}>
            {savePending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            Lưu ghi chú
          </Button>
        </div>
      </form>
    </div>
  );
}
