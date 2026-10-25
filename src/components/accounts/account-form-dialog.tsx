"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { AlertCircleIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { SubmitButton } from "@/components/patterns/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toLocalDateTimeInputValue } from "@/components/accounts/datetime";
import { createAccount, updateAccount } from "@/lib/actions/accounts";
import { defaultSchedule } from "@/lib/warming/defaults";
import {
  ACCOUNT_STATUSES,
  ACCOUNT_STATUS_LABEL,
  SOCIAL_PLATFORMS,
  type AccountStatus,
  type SocialPlatform
} from "@/lib/constants";
import type { AccountRow } from "@/lib/data/accounts";
import type { ActionResult } from "@/lib/result";
import { parsePersonaSchedule } from "@/lib/validations/account";

function formValues(formData: FormData) {
  return {
    name: formData.get("name"),
    platform: formData.get("platform"),
    persona_type: formData.get("persona_type"),
    browser_profile_id: formData.get("browser_profile_id"),
    proxy_ip: formData.get("proxy_ip"),
    status: formData.get("status"),
    trust_score: formData.get("trust_score"),
    bio_link_url: formData.get("bio_link_url"),
    notes: formData.get("notes"),
    persona_schedule: formData.get("persona_schedule"),
    warmup_enabled: formData.get("warmup_enabled"),
    cooldown_until: formData.get("cooldown_until"),
    daily_comment_limit: formData.get("daily_comment_limit"),
    daily_warming_limit: formData.get("daily_warming_limit"),
    min_action_gap_minutes: formData.get("min_action_gap_minutes")
  };
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return <p className="text-destructive text-xs">{messages[0]}</p>;
}

export function AccountForm({
  account,
  personaTypes,
  onSuccess
}: {
  account?: AccountRow;
  personaTypes: string[];
  onSuccess?: () => void;
}) {
  const formId = useId();
  const personaListId = `${formId}-persona-types`;
  const [platform, setPlatform] = useState<SocialPlatform>(account?.platform ?? "facebook");
  const [status, setStatus] = useState<AccountStatus>(account?.status ?? "active");
  const [warmup, setWarmup] = useState(account?.warmup_enabled ?? true);
  const [scheduleText, setScheduleText] = useState(() =>
    JSON.stringify(
      account ? parsePersonaSchedule(account.persona_schedule) : defaultSchedule(),
      null,
      2
    )
  );

  // Called from onSubmit rather than passed as <form action>: React's form-action
  // plumbing did not apply the returned state in the production build (the write
  // happened, the button spun forever). A direct action call inside a transition is
  // the path that demonstrably commits.
  const [state, setState] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = account
        ? await updateAccount(account.id, formValues(formData))
        : await createAccount(formValues(formData));
      setState(result);
    });
  }

  const handledState = useRef<ActionResult | null>(null);
  useEffect(() => {
    if (!state || handledState.current === state) return;
    handledState.current = state;
    if (state.ok) {
      toast.success(account ? "Đã cập nhật tài khoản" : "Đã tạo tài khoản mới");
      onSuccess?.();
    } else {
      toast.error(state.error);
    }
  }, [state, account, onSuccess]);

  const fieldErrors: Record<string, string[]> =
    state && !state.ok ? state.fieldErrors ?? {} : {};

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {state && !state.ok ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor={`${formId}-name`}>Tên tài khoản</Label>
          <Input
            id={`${formId}-name`}
            name="name"
            defaultValue={account?.name ?? ""}
            placeholder="vd: Minh Anh — decor"
            maxLength={80}
            required
            aria-invalid={Boolean(fieldErrors.name) || undefined}
          />
          <FieldError messages={fieldErrors.name} />
        </div>

        <div className="grid gap-2">
          <Label>Nền tảng</Label>
          <Select
            name="platform"
            value={platform}
            onValueChange={(value) => setPlatform(value as SocialPlatform)}
          >
            <SelectTrigger aria-label="Nền tảng">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOCIAL_PLATFORMS.map((value) => (
                <SelectItem key={value} value={value} className="capitalize">
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError messages={fieldErrors.platform} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor={`${formId}-persona`}>Loại persona</Label>
          <Input
            id={`${formId}-persona`}
            name="persona_type"
            list={personaListId}
            defaultValue={account?.persona_type ?? ""}
            placeholder="vd: decor"
            maxLength={40}
            required
            aria-invalid={Boolean(fieldErrors.persona_type) || undefined}
          />
          <datalist id={personaListId}>
            {personaTypes.map((persona) => (
              <option key={persona} value={persona} />
            ))}
          </datalist>
          <FieldError messages={fieldErrors.persona_type} />
        </div>

        <div className="grid gap-2">
          <Label>Trạng thái</Label>
          <Select
            name="status"
            value={status}
            onValueChange={(value) => setStatus(value as AccountStatus)}
          >
            <SelectTrigger aria-label="Trạng thái">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {ACCOUNT_STATUS_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError messages={fieldErrors.status} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor={`${formId}-trust`}>Điểm uy tín (0–100)</Label>
          <Input
            id={`${formId}-trust`}
            name="trust_score"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            defaultValue={account?.trust_score ?? 10}
            required
            aria-invalid={Boolean(fieldErrors.trust_score) || undefined}
          />
          <FieldError messages={fieldErrors.trust_score} />
        </div>

        {status === "cooldown" ? (
          <div className="grid gap-2">
            <Label htmlFor={`${formId}-cooldown`}>Tạm dừng đến khi</Label>
            <Input
              id={`${formId}-cooldown`}
              name="cooldown_until"
              type="datetime-local"
              defaultValue={toLocalDateTimeInputValue(account?.cooldown_until)}
              required
              aria-invalid={Boolean(fieldErrors.cooldown_until) || undefined}
            />
            <FieldError messages={fieldErrors.cooldown_until} />
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor={`${formId}-comment-limit`}>Comment / ngày</Label>
            <Input
              id={`${formId}-comment-limit`}
              name="daily_comment_limit"
              type="number"
              inputMode="numeric"
              min={0}
              max={50}
              step={1}
              defaultValue={account?.daily_comment_limit ?? 8}
              aria-invalid={Boolean(fieldErrors.daily_comment_limit) || undefined}
            />
            <FieldError messages={fieldErrors.daily_comment_limit} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${formId}-warming-limit`}>Warming / ngày</Label>
            <Input
              id={`${formId}-warming-limit`}
              name="daily_warming_limit"
              type="number"
              inputMode="numeric"
              min={0}
              max={20}
              step={1}
              defaultValue={account?.daily_warming_limit ?? 4}
              aria-invalid={Boolean(fieldErrors.daily_warming_limit) || undefined}
            />
            <FieldError messages={fieldErrors.daily_warming_limit} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${formId}-gap`}>Giãn cách (phút)</Label>
            <Input
              id={`${formId}-gap`}
              name="min_action_gap_minutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={1440}
              step={1}
              defaultValue={account?.min_action_gap_minutes ?? 20}
              aria-invalid={Boolean(fieldErrors.min_action_gap_minutes) || undefined}
            />
            <FieldError messages={fieldErrors.min_action_gap_minutes} />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor={`${formId}-profile`}>Browser Profile ID</Label>
          <Input
            id={`${formId}-profile`}
            name="browser_profile_id"
            defaultValue={account?.browser_profile_id ?? ""}
            placeholder="Mã profile GPM-Login / AdsPower"
            maxLength={120}
            autoCapitalize="none"
            aria-invalid={Boolean(fieldErrors.browser_profile_id) || undefined}
          />
          <FieldError messages={fieldErrors.browser_profile_id} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor={`${formId}-proxy`}>Proxy</Label>
          <Input
            id={`${formId}-proxy`}
            name="proxy_ip"
            defaultValue={account?.proxy_ip ?? ""}
            placeholder="host:port hoặc ip:port"
            maxLength={120}
            autoCapitalize="none"
            aria-invalid={Boolean(fieldErrors.proxy_ip) || undefined}
          />
          <FieldError messages={fieldErrors.proxy_ip} />
        </div>

        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor={`${formId}-bio`}>URL link Bio</Label>
          <Input
            id={`${formId}-bio`}
            name="bio_link_url"
            type="url"
            inputMode="url"
            defaultValue={account?.bio_link_url ?? ""}
            placeholder="https://"
            maxLength={500}
            autoCapitalize="none"
            aria-invalid={Boolean(fieldErrors.bio_link_url) || undefined}
          />
          <FieldError messages={fieldErrors.bio_link_url} />
        </div>

        <div className="grid gap-2 sm:col-span-2">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Bật nuôi tài khoản (Warmup)</p>
              <p className="text-muted-foreground text-xs">
                Trình xây dựng profile tự động sẽ duy trì lịch trình hoạt động cho persona này.
              </p>
            </div>
            <Switch checked={warmup} onCheckedChange={setWarmup} aria-label="Bật nuôi tài khoản" />
          </div>
          <input type="hidden" name="warmup_enabled" value={String(warmup)} />
          <FieldError messages={fieldErrors.warmup_enabled} />
        </div>

        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor={`${formId}-schedule`}>Lịch trình nuôi nick (JSON)</Label>
          <Textarea
            id={`${formId}-schedule`}
            name="persona_schedule"
            value={scheduleText}
            onChange={(event) => setScheduleText(event.target.value)}
            spellCheck={false}
            className="min-h-28 font-mono text-xs"
            aria-invalid={Boolean(fieldErrors.persona_schedule) || undefined}
          />
          <p className="text-muted-foreground text-xs">
            Mảng các mục dạng <code className="font-mono">{`{ "at": "09:30", "kind": "lifestyle_post" }`}</code>. Giờ dùng định dạng 24h HH:MM.
          </p>
          <FieldError messages={fieldErrors.persona_schedule} />
        </div>

        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor={`${formId}-notes`}>Ghi chú</Label>
          <Textarea
            id={`${formId}-notes`}
            name="notes"
            defaultValue={account?.notes ?? ""}
            placeholder="Ngách, phong cách tương tác, lịch sử checkpoint…"
            maxLength={2000}
            className="min-h-20"
            aria-invalid={Boolean(fieldErrors.notes) || undefined}
          />
          <FieldError messages={fieldErrors.notes} />
        </div>
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" size="lg" className="w-full sm:w-auto">
            Hủy
          </Button>
        </DialogClose>
        <SubmitButton
          size="lg"
          className="w-full sm:w-auto"
          pending={pending}
          pendingLabel="Đang lưu…"
        >
          {account ? "Lưu thay đổi" : "Tạo tài khoản"}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

/** Trigger + dialog wrapper for the list header and the detail page. */
export function AccountFormDialog({
  account,
  personaTypes,
  trigger
}: {
  account?: AccountRow;
  personaTypes: string[];
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account ? "Chỉnh sửa tài khoản" : "Tài khoản mới"}</DialogTitle>
          <DialogDescription>
            {account
              ? "Cập nhật danh tính, trạng thái và lịch trình nuôi persona tương tác."
              : "Đăng ký tài khoản mạng xã hội mới và thiết lập persona cùng lịch trình nuôi."}
          </DialogDescription>
        </DialogHeader>
        <AccountForm
          account={account}
          personaTypes={personaTypes}
          onSuccess={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Small helper so pages can render the trigger button without duplicating markup. */
export function NewAccountTrigger() {
  return (
    <Button size="lg" className="w-full sm:w-auto">
      <PlusIcon />
      Thêm tài khoản
    </Button>
  );
}
