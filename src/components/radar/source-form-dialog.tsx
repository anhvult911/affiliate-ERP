"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PencilIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { SubmitButton } from "@/components/patterns/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
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
import { createSource, updateSource } from "@/lib/actions/target-sources";
import { SOURCE_TYPE_LABEL, SOURCE_TYPES } from "@/lib/constants";
import type { Tables } from "@/lib/database.types";
import { useFormAction } from "@/lib/hooks/use-form-action";

/** Only the fields the form reads/writes — a full row (with captureCount) is accepted too. */
export type SourceFormSource = Pick<
  Tables<"target_sources">,
  | "id"
  | "name"
  | "url"
  | "source_type"
  | "niche"
  | "tone_of_voice"
  | "group_rules"
  | "scan_interval_mins"
  | "is_active"
>;

export function SourceFormDialog({
  mode,
  source,
  triggerLabel,
  open: controlledOpen,
  onOpenChange
}: {
  mode: "create" | "edit";
  source?: SourceFormSource;
  /** Overrides the built-in trigger label (e.g. in an empty state). */
  triggerLabel?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [isActive, setIsActive] = useState(source?.is_active ?? true);
  const { fieldErrors, error, pending, submit } = useFormAction(
    async (formData) => {
      const input = {
        name: formData.get("name"),
        url: formData.get("url"),
        source_type: formData.get("source_type"),
        niche: formData.get("niche"),
        tone_of_voice: formData.get("tone_of_voice"),
        group_rules: formData.get("group_rules"),
        scan_interval_mins: formData.get("scan_interval_mins"),
        is_active: formData.get("is_active")
      };

      if (mode === "create") return createSource(input);

      const id = formData.get("id");
      return updateSource(typeof id === "string" ? id : "", input);
    },
    {
      onSuccess: () => {
        toast.success(
          mode === "create" ? "Đã thêm nguồn theo dõi vào Radar." : "Đã cập nhật nguồn theo dõi."
        );
        setOpen(false);
        router.refresh();
      },
      onError: (message) => toast.error(message)
    }
  );

  useEffect(() => {
    if (!open) return;
    setIsActive(source?.is_active ?? true);
  }, [open, source?.is_active]);

  const fieldError = (field: string) => fieldErrors?.[field]?.[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {controlledOpen === undefined ? (
        <DialogTrigger asChild>
          <Button
            variant={mode === "create" ? "default" : "outline"}
            size="lg"
            className="w-full sm:w-auto"
          >
            {mode === "create" ? <PlusIcon /> : <PencilIcon />}
            {triggerLabel ?? (mode === "create" ? "Thêm nguồn" : "Chỉnh sửa")}
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Thêm nguồn Radar" : "Chỉnh sửa nguồn Radar"}</DialogTitle>
          <DialogDescription>
            Bộ quét tự động sẽ kiểm tra nguồn theo chu kỳ đã đặt. Giọng văn và luật nhóm sẽ được đưa trực tiếp vào prompt tạo nội dung của Gemini.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          {mode === "edit" && source ? <input type="hidden" name="id" value={source.id} /> : null}

          <div className="space-y-2">
            <Label htmlFor="source-name">Tên nguồn</Label>
            <Input
              id="source-name"
              name="name"
              defaultValue={source?.name ?? ""}
              placeholder="vd: Hội pass đồ decor Hà Nội"
              required
              maxLength={120}
              autoComplete="off"
              aria-invalid={Boolean(fieldError("name"))}
            />
            {fieldError("name") ? (
              <p className="text-destructive text-xs">{fieldError("name")}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="source-url">URL nguồn</Label>
            <Input
              id="source-url"
              name="url"
              type="url"
              inputMode="url"
              defaultValue={source?.url ?? ""}
              placeholder="https://facebook.com/groups/…"
              required
              autoComplete="off"
              aria-invalid={Boolean(fieldError("url"))}
            />
            {fieldError("url") ? (
              <p className="text-destructive text-xs">{fieldError("url")}</p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="source-type">Loại nguồn</Label>
              <Select name="source_type" defaultValue={source?.source_type ?? "group"}>
                <SelectTrigger
                  id="source-type"
                  className="w-full"
                  aria-invalid={Boolean(fieldError("source_type"))}
                >
                  <SelectValue placeholder="Chọn loại nguồn" />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {SOURCE_TYPE_LABEL[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldError("source_type") ? (
                <p className="text-destructive text-xs">{fieldError("source_type")}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="source-niche">Ngách nội dung</Label>
              <Input
                id="source-niche"
                name="niche"
                defaultValue={source?.niche ?? ""}
                placeholder="Thời trang, decor, công nghệ…"
                maxLength={120}
                aria-invalid={Boolean(fieldError("niche"))}
              />
              {fieldError("niche") ? (
                <p className="text-destructive text-xs">{fieldError("niche")}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="source-interval">Chu kỳ quét (phút)</Label>
            <Input
              id="source-interval"
              name="scan_interval_mins"
              type="number"
              inputMode="numeric"
              min={1}
              max={1440}
              step={1}
              defaultValue={source?.scan_interval_mins ?? 15}
              required
              aria-invalid={Boolean(fieldError("scan_interval_mins"))}
            />
            <p className="text-muted-foreground text-xs">
              Tần suất bot kiểm tra bài viết mới. Từ 1 đến 1.440 phút.
            </p>
            {fieldError("scan_interval_mins") ? (
              <p className="text-destructive text-xs">{fieldError("scan_interval_mins")}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="source-tone">Giọng văn tương tác</Label>
            <Textarea
              id="source-tone"
              name="tone_of_voice"
              defaultValue={source?.tone_of_voice ?? ""}
              placeholder="Thân thiện, câu ngắn, dùng từ ngữ giới trẻ, không nói quá đà…"
              maxLength={500}
              rows={3}
              aria-invalid={Boolean(fieldError("tone_of_voice"))}
            />
            <p className="text-muted-foreground text-xs">
              Được đưa vào prompt Gemini để câu trả lời tự nhiên như thành viên quen thuộc của nhóm.
            </p>
            {fieldError("tone_of_voice") ? (
              <p className="text-destructive text-xs">{fieldError("tone_of_voice")}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="source-rules">Quy định / Luật nhóm</Label>
            <Textarea
              id="source-rules"
              name="group_rules"
              defaultValue={source?.group_rules ?? ""}
              placeholder="Không thả link ở comment đầu. Không viết hoa toàn bộ. Mỗi bài chỉ cmt 1 lần…"
              maxLength={2000}
              rows={5}
              aria-invalid={Boolean(fieldError("group_rules"))}
            />
            <p className="text-muted-foreground text-xs">
              Được truyền trực tiếp vào Gemini để không vi phạm luật nhóm, tránh các từ cấm và gắn hashtag bắt buộc nếu có.
            </p>
            {fieldError("group_rules") ? (
              <p className="text-destructive text-xs">{fieldError("group_rules")}</p>
            ) : null}
          </div>

          <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="source-active">Đang giám sát chủ động</Label>
              <p className="text-muted-foreground text-xs">
                Nguồn tạm dừng sẽ bị bộ quét bỏ qua.
              </p>
            </div>
            <Switch id="source-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <input type="hidden" name="is_active" value={isActive ? "true" : "false"} />

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}

          <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setOpen(false)}
              className="w-full sm:w-auto"
            >
              Hủy
            </Button>
            <SubmitButton
              size="lg"
              className="w-full sm:w-auto"
              pending={pending}
              pendingLabel={mode === "create" ? "Đang thêm…" : "Đang lưu…"}
            >
              {mode === "create" ? (
                <>
                  <PlusIcon />
                  Thêm nguồn
                </>
              ) : (
                "Lưu thay đổi"
              )}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
