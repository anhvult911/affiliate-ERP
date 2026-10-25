import {
  CircleCheckIcon,
  CircleDashedIcon,
  ImageIcon,
  ImagePlusIcon,
  MessageSquareTextIcon,
  UserRoundIcon
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelative } from "@/lib/format";
import type { ProfileReadiness } from "@/lib/data/warming";

/**
 * What a stranger sees in the first two seconds of a profile visit: picture,
 * cover, intro line, and whether there is anything on the wall. An account with
 * text posts but no avatar is the clearest tell of a farm, so this card exists to
 * make that visible before anyone clicks the profile.
 */
export function ProfileReadinessCard({ readiness }: { readiness: ProfileReadiness }) {
  const checks: { key: ProfileReadiness["missing"][number]; label: string; done: boolean; icon: typeof ImageIcon }[] = [
    { key: "avatar", label: "Ảnh đại diện", done: Boolean(readiness.avatarSetAt), icon: UserRoundIcon },
    { key: "cover", label: "Ảnh bìa", done: Boolean(readiness.coverSetAt), icon: ImagePlusIcon },
    { key: "bio", label: "Tiểu sử", done: Boolean(readiness.bio), icon: MessageSquareTextIcon },
    { key: "posts", label: `Bài viết (${readiness.posts}/3)`, done: readiness.posts >= 3, icon: CircleCheckIcon }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="size-4" />
          Hồ sơ công khai
          <span className="text-muted-foreground text-sm font-normal tabular-nums">
            {readiness.score}%
          </span>
        </CardTitle>
        <CardDescription>
          Thứ người lạ thấy khi bấm vào nick. Nick trống ảnh đại diện là dấu hiệu rõ nhất của nick ảo.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${readiness.score}%` }}
          />
        </div>

        <ul className="grid gap-2 sm:grid-cols-2">
          {checks.map((check) => {
            const Icon = check.done ? CircleCheckIcon : check.icon;
            return (
              <li key={check.key} className="flex items-center gap-2 text-sm">
                <Icon
                  aria-hidden
                  className={check.done ? "size-4 text-emerald-600" : "text-muted-foreground size-4"}
                />
                <span className={check.done ? "" : "text-muted-foreground"}>{check.label}</span>
              </li>
            );
          })}
        </ul>

        {readiness.bio ? (
          <p className="bg-muted/50 rounded-md p-2 text-sm">{readiness.bio}</p>
        ) : null}

        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>
            Dựng hồ sơ: {readiness.profileBuiltAt ? formatRelative(readiness.profileBuiltAt) : "chưa dựng"}
          </span>
          {readiness.lastSetupAt ? <span>Lần thử gần nhất: {formatRelative(readiness.lastSetupAt)}</span> : null}
        </div>

        {readiness.missing.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            {readiness.missing.includes("avatar") || readiness.missing.includes("cover")
              ? "Cần ảnh trong workers/assets/<persona>/avatar.* và cover.* để worker tự dựng."
              : "Worker sẽ tự dựng nốt trong chu kỳ warming tiếp theo."}
          </p>
        ) : (
          <p className="flex items-center gap-1 text-xs text-emerald-600">
            <CircleDashedIcon aria-hidden className="size-3" />
            Hồ sơ đủ để người lạ nhìn không thấy bất thường.
          </p>
        )}

        {readiness.lastSetupError ? (
          <p className="text-destructive text-xs">Lỗi gần nhất: {readiness.lastSetupError}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
