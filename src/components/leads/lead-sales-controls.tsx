"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeDollarSignIcon,
  CheckIcon,
  Loader2Icon,
  ReceiptTextIcon,
  RepeatIcon,
  Trash2Icon
} from "lucide-react";
import { toast } from "sonner";

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
  clearLeadMilestone,
  deleteLeadReceipt,
  markLeadMilestone,
  recordLeadReceipt,
  saveLeadRecurringRate
} from "@/lib/actions/lead-sales";
import type { LeadMilestone, LeadReceipt, LeadRecurringTerm } from "@/lib/data/leads";
import { formatDateTime, formatVnd } from "@/lib/format";
import { fromDateTimeLocal, toDateTimeLocal } from "@/lib/leads/datetime";
import {
  LEAD_MILESTONE_HINT,
  LEAD_MILESTONE_KINDS,
  LEAD_MILESTONE_LABEL,
  LEAD_MILESTONE_TONE,
  LEAD_RECEIPT_KINDS,
  LEAD_RECEIPT_LABEL,
  LEAD_RECEIPT_TONE,
  isLeadMilestoneKind,
  type LeadMilestoneKind,
  type LeadReceiptKind
} from "@/lib/leads/sales";

function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `receipt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseVnd(value: string) {
  // Allow Vietnamese thousands separators, but never turn "-100" into 100.
  const normalized = value.replace(/[.,\s]/g, "");
  if (!/^\d+$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/**
 * Explicit sales facts for one lead. Nothing here is inferred from the CRM
 * status: the operator records the milestone timestamp or the actual payment.
 */
export function LeadSalesControls({
  leadId,
  milestones,
  receipts,
  recurringTerm
}: {
  leadId: string;
  milestones: LeadMilestone[];
  receipts: LeadReceipt[];
  recurringTerm: LeadRecurringTerm | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const milestoneByKind = new Map<LeadMilestoneKind, LeadMilestone>();
  for (const row of milestones) {
    if (isLeadMilestoneKind(row.kind)) milestoneByKind.set(row.kind, row);
  }

  const [milestoneDates, setMilestoneDates] = useState<Record<LeadMilestoneKind, string>>(() => {
    const initial = {} as Record<LeadMilestoneKind, string>;
    for (const kind of LEAD_MILESTONE_KINDS) {
      initial[kind] = toDateTimeLocal(milestoneByKind.get(kind)?.occurred_at);
    }
    return initial;
  });

  const [receiptKind, setReceiptKind] = useState<LeadReceiptKind>("template");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [receiptNote, setReceiptNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState<string>(newIdempotencyKey);

  const [monthlyRate, setMonthlyRate] = useState(
    recurringTerm ? String(recurringTerm.monthly_vnd) : ""
  );
  const [startedOn, setStartedOn] = useState(recurringTerm?.started_on ?? "");

  function mark(kind: LeadMilestoneKind) {
    const occurredAt = fromDateTimeLocal(milestoneDates[kind]) ?? new Date().toISOString();
    setBusy(`milestone-${kind}`);
    startTransition(async () => {
      const result = await markLeadMilestone({ leadId, kind, occurredAt });
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setMilestoneDates((current) => ({
        ...current,
        [kind]: toDateTimeLocal(result.data.occurredAt)
      }));
      toast.success(`Đã ghi mốc “${LEAD_MILESTONE_LABEL[kind]}”.`);
      router.refresh();
    });
  }

  function clear(kind: LeadMilestoneKind) {
    setBusy(`clear-${kind}`);
    startTransition(async () => {
      const result = await clearLeadMilestone({ leadId, kind });
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setMilestoneDates((current) => ({ ...current, [kind]: "" }));
      toast.success(`Đã xóa mốc “${LEAD_MILESTONE_LABEL[kind]}”; mốc này trở lại trạng thái chưa đạt.`);
      router.refresh();
    });
  }

  function submitReceipt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountVnd = parseVnd(amount);
    if (amountVnd === null) {
      toast.error("Nhập số tiền thực nhận lớn hơn 0.");
      return;
    }

    setBusy("receipt");
    startTransition(async () => {
      const result = await recordLeadReceipt({
        leadId,
        kind: receiptKind,
        amountVnd,
        paidAt: fromDateTimeLocal(paidAt) ?? new Date().toISOString(),
        note: receiptNote,
        idempotencyKey
      });
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setAmount("");
      setPaidAt("");
      setReceiptNote("");
      // A fresh key means the next click is a new payment, never a retry.
      setIdempotencyKey(newIdempotencyKey());
      toast.success(
        result.data.duplicate
          ? "Khoản thu này đã được ghi trước đó — không cộng trùng."
          : `Đã ghi ${formatVnd(amountVnd)} tiền thực nhận.`
      );
      router.refresh();
    });
  }

  function removeReceipt(receipt: LeadReceipt) {
    if (!window.confirm(`Xóa khoản thu ${formatVnd(receipt.amount_vnd)}? Số liệu báo cáo sẽ giảm.`)) {
      return;
    }
    setBusy(`receipt-${receipt.id}`);
    startTransition(async () => {
      const result = await deleteLeadReceipt({ id: receipt.id });
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Đã xóa khoản thu.");
      router.refresh();
    });
  }

  function saveRecurring(nextMonthly: number | null) {
    setBusy("recurring");
    startTransition(async () => {
      const result = await saveLeadRecurringRate({
        leadId,
        monthlyVnd: nextMonthly,
        startedOn: nextMonthly === null || startedOn === "" ? undefined : startedOn
      });
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (nextMonthly === null) {
        setMonthlyRate("");
        toast.success("Đã kết thúc giá duy trì. Không có khoản tiền nào bị tạo.");
      } else {
        toast.success(`Đã lưu giá duy trì ${formatVnd(nextMonthly)}/tháng (không phải MRR).`);
      }
      router.refresh();
    });
  }

  const receiptsTotal = receipts.reduce((sum, receipt) => sum + Number(receipt.amount_vnd), 0);

  return (
    <details className="border-t pt-3">
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 text-sm font-medium">
        <BadgeDollarSignIcon className="size-4" />
        Mốc chốt &amp; tiền thực nhận
        {receipts.length > 0 ? (
          <Badge variant="success">
            {formatVnd(receiptsTotal)} · {receipts.length} khoản
          </Badge>
        ) : (
          <Badge variant="muted">Chưa ghi nhận tiền</Badge>
        )}
        {recurringTerm ? (
          <Badge variant="warning">
            Duy trì {formatVnd(recurringTerm.monthly_vnd)}/tháng (không phải MRR)
          </Badge>
        ) : null}
      </summary>

      <div className="space-y-5 pt-3">
        <section className="space-y-3">
          <div>
            <p className="text-sm font-semibold">Mốc chốt thực tế</p>
            <p className="text-muted-foreground text-xs">
              Chỉ ghi khi đã xảy ra thật. Để trống thời điểm = lấy lúc bấm; nhập ngày cũ để ghi bù
              đúng lịch sử. Thời điểm tương lai được ghi bằng hiện tại. Không suy ra mốc từ trạng
              thái chăm sóc.
            </p>
          </div>

          {LEAD_MILESTONE_KINDS.map((kind) => {
            const existing = milestoneByKind.get(kind);
            return (
              <div key={kind} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={existing ? LEAD_MILESTONE_TONE[kind] : "muted"}>
                        {LEAD_MILESTONE_LABEL[kind]}
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        {existing
                          ? `Đã ghi · ${formatDateTime(existing.occurred_at)}`
                          : "Chưa đạt (không suy diễn)"}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">{LEAD_MILESTONE_HINT[kind]}</p>
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label htmlFor={`milestone-${leadId}-${kind}`} className="text-xs">
                      Thời điểm thực tế
                    </Label>
                    <Input
                      id={`milestone-${leadId}-${kind}`}
                      type="datetime-local"
                      value={milestoneDates[kind]}
                      onChange={(event) =>
                        setMilestoneDates((current) => ({ ...current, [kind]: event.target.value }))
                      }
                      disabled={pending}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="min-h-11 sm:min-h-9"
                      onClick={() => mark(kind)}
                      disabled={pending}
                    >
                      {busy === `milestone-${kind}` ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <CheckIcon />
                      )}
                      {existing ? "Cập nhật" : "Ghi nhận"}
                    </Button>
                    {existing ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="min-h-11 sm:min-h-9"
                        onClick={() => clear(kind)}
                        disabled={pending}
                      >
                        {busy === `clear-${kind}` ? (
                          <Loader2Icon className="animate-spin" />
                        ) : (
                          <Trash2Icon />
                        )}
                        Xóa
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        <section className="space-y-3 rounded-lg border p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Ghi nhận tiền thực nhận</p>
              <p className="text-muted-foreground text-xs">
                Chỉ nhập số tiền khách đã trả. Nhiều lần thu là nhiều khoản; bấm lại cùng một biểu
                mẫu không tạo khoản trùng.
              </p>
            </div>
            <ReceiptTextIcon className="text-muted-foreground size-4 shrink-0" />
          </div>

          <form onSubmit={submitReceipt} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`receipt-kind-${leadId}`}>Loại khoản thu</Label>
                <Select
                  value={receiptKind}
                  onValueChange={(value) => setReceiptKind(value as LeadReceiptKind)}
                  disabled={pending}
                >
                  <SelectTrigger id={`receipt-kind-${leadId}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_RECEIPT_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {LEAD_RECEIPT_LABEL[kind]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`receipt-amount-${leadId}`}>Số tiền thực nhận (VND)</Label>
                <Input
                  id={`receipt-amount-${leadId}`}
                  inputMode="numeric"
                  placeholder="Ví dụ: 1500000"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  disabled={pending}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`receipt-paid-${leadId}`}>Ngày trả tiền</Label>
                <Input
                  id={`receipt-paid-${leadId}`}
                  type="datetime-local"
                  value={paidAt}
                  onChange={(event) => setPaidAt(event.target.value)}
                  disabled={pending}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`receipt-note-${leadId}`}>Ghi chú (tùy chọn)</Label>
                <Input
                  id={`receipt-note-${leadId}`}
                  value={receiptNote}
                  onChange={(event) => setReceiptNote(event.target.value)}
                  maxLength={500}
                  placeholder="Chuyển khoản, đợt 1…"
                  disabled={pending}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">
                {parseVnd(amount) !== null ? `Sẽ ghi: ${formatVnd(parseVnd(amount))}` : "Chưa có số tiền"}
                {" · "}Để trống ngày = hôm nay; ngày tương lai được ghi bằng hiện tại.
              </p>
              <Button type="submit" size="sm" className="min-h-11 sm:min-h-9" disabled={pending}>
                {busy === "receipt" ? <Loader2Icon className="animate-spin" /> : <BadgeDollarSignIcon />}
                Ghi khoản thu
              </Button>
            </div>
          </form>

          {receipts.length > 0 ? (
            <ul className="space-y-2">
              {receipts.map((receipt) => (
                <li
                  key={receipt.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        LEAD_RECEIPT_TONE[receipt.kind as LeadReceiptKind] ?? "muted"
                      }
                    >
                      {LEAD_RECEIPT_LABEL[receipt.kind as LeadReceiptKind] ?? receipt.kind}
                    </Badge>
                    <span className="font-medium tabular-nums">{formatVnd(receipt.amount_vnd)}</span>
                    <span className="text-muted-foreground text-xs">
                      {formatDateTime(receipt.paid_at)}
                    </span>
                    {receipt.note ? (
                      <span className="text-muted-foreground truncate text-xs">· {receipt.note}</span>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-h-11 sm:min-h-9"
                    onClick={() => removeReceipt(receipt)}
                    disabled={pending}
                  >
                    {busy === `receipt-${receipt.id}` ? (
                      <Loader2Icon className="animate-spin" />
                    ) : (
                      <Trash2Icon />
                    )}
                    Xóa
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">
              Chưa có khoản thu nào. Khách chưa trả tiền thì không ghi.
            </p>
          )}
        </section>

        <section className="space-y-3 rounded-lg border p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Giá duy trì đã thỏa thuận</p>
              <p className="text-muted-foreground text-xs">
                Chỉ là mức giá/tháng hai bên đã chốt. Không phải MRR, không cộng vào tiền thực nhận
                và không tự tạo khoản thu.
              </p>
            </div>
            <RepeatIcon className="text-muted-foreground size-4 shrink-0" />
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor={`recurring-amount-${leadId}`}>Giá/tháng (VND)</Label>
              <Input
                id={`recurring-amount-${leadId}`}
                inputMode="numeric"
                placeholder="Ví dụ: 500000"
                value={monthlyRate}
                onChange={(event) => setMonthlyRate(event.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`recurring-start-${leadId}`}>Bắt đầu (trống = hôm nay)</Label>
              <Input
                id={`recurring-start-${leadId}`}
                type="date"
                value={startedOn}
                onChange={(event) => setStartedOn(event.target.value)}
                disabled={pending}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button
                type="button"
                size="sm"
                className="min-h-11 sm:min-h-9"
                onClick={() => {
                  const value = parseVnd(monthlyRate);
                  if (value === null) {
                    toast.error("Nhập giá duy trì lớn hơn 0 hoặc bấm kết thúc.");
                    return;
                  }
                  saveRecurring(value);
                }}
                disabled={pending}
              >
                {busy === "recurring" ? <Loader2Icon className="animate-spin" /> : <RepeatIcon />}
                Lưu giá
              </Button>
              {recurringTerm ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-11 sm:min-h-9"
                  onClick={() => saveRecurring(null)}
                  disabled={pending}
                >
                  Kết thúc
                </Button>
              ) : null}
            </div>
          </div>

          <p className="text-muted-foreground text-xs">
            {recurringTerm
              ? `Đang ghi nhận ${formatVnd(recurringTerm.monthly_vnd)}/tháng từ ${recurringTerm.started_on}.`
              : "Chưa có thỏa thuận duy trì."}
          </p>
        </section>
      </div>
    </details>
  );
}
