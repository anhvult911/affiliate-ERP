import { ExternalLinkIcon, MessageSquareIcon, SendIcon } from "lucide-react";
import type { ReactNode } from "react";

import { CopyButton } from "@/components/patterns/copy-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { LeadWithSales } from "@/lib/data/leads";
import { formatHostname, formatRelative, formatVnd } from "@/lib/format";
import {
  LEAD_FOLLOWUP_STATUSES,
  isLeadStatus,
  leadCategoryLabel,
  leadIntentLabel
} from "@/lib/leads/status";
import { isLeadMilestoneKind, LEAD_MILESTONE_LABEL } from "@/lib/leads/sales";

import { LeadScoreBadge, LeadStatusBadge } from "./lead-badges";
import { LeadControls } from "./lead-controls";
import { LeadSalesControls } from "./lead-sales-controls";

function DraftBlock({
  title,
  value,
  copyLabel
}: {
  title: ReactNode;
  value: string | null;
  copyLabel: string;
}) {
  const draft = value?.trim() ?? "";

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</p>
        {draft ? (
          <CopyButton
            value={draft}
            label={copyLabel}
            size="sm"
            variant="outline"
            className="min-h-11"
          />
        ) : null}
      </div>
      {draft ? (
        <pre className="bg-muted/50 rounded-md p-2 font-sans text-sm break-words whitespace-pre-wrap">
          {draft}
        </pre>
      ) : (
        <p className="text-muted-foreground text-sm">Chưa có gợi ý cho lead này.</p>
      )}
    </div>
  );
}

function RawPost({ content, alwaysVisible }: { content: string | null; alwaysVisible: boolean }) {
  const body = content?.trim() ?? "";

  if (!body) {
    return <p className="text-muted-foreground text-sm">Bài viết không có nội dung chữ.</p>;
  }

  const block = (
    <pre className="bg-muted/50 max-h-72 overflow-auto rounded-lg border p-3 font-sans text-sm break-words whitespace-pre-wrap">
      {body}
    </pre>
  );

  if (alwaysVisible) return block;

  return (
    <details className="space-y-2">
      <summary className="text-muted-foreground hover:text-foreground inline-flex min-h-11 cursor-pointer items-center text-sm">
        Xem nội dung bài gốc
      </summary>
      <div className="pt-2">{block}</div>
    </details>
  );
}

export function LeadCard({ lead }: { lead: LeadWithSales }) {
  const pending = lead.status === "pending_review";
  const followupDue =
    lead.next_followup_at !== null &&
    isLeadStatus(lead.status) &&
    LEAD_FOLLOWUP_STATUSES.includes(lead.status) &&
    new Date(lead.next_followup_at).getTime() <= Date.now();
  const receiptTotal = lead.receipts.reduce((sum, receipt) => sum + Number(receipt.amount_vnd), 0);
  const milestoneKinds = new Set(
    lead.milestones.filter((row) => isLeadMilestoneKind(row.kind)).map((row) => row.kind)
  );

  return (
    <Card className={pending ? "border-warning/50 bg-warning/5" : undefined}>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <LeadScoreBadge score={lead.score} />
          <LeadStatusBadge status={lead.status} />
          {lead.matched_category ? (
            <Badge variant="outline">{leadCategoryLabel(lead.matched_category)}</Badge>
          ) : null}
          <Badge variant="muted">{leadIntentLabel(lead.intent_type)}</Badge>
          {milestoneKinds.has("qualified") ? (
            <Badge variant="info">{LEAD_MILESTONE_LABEL.qualified}</Badge>
          ) : null}
          {milestoneKinds.has("two_way_conversation") ? (
            <Badge variant="warning">{LEAD_MILESTONE_LABEL.two_way_conversation}</Badge>
          ) : null}
          {milestoneKinds.has("trial_use_confirmed") ? (
            <Badge variant="success">{LEAD_MILESTONE_LABEL.trial_use_confirmed}</Badge>
          ) : null}
          {lead.receipts.length > 0 ? (
            <Badge variant="success">
              Đã trả {formatVnd(receiptTotal)} · {lead.receipts.length} khoản
            </Badge>
          ) : null}
          {followupDue ? <Badge variant="warning">Đến hạn nhắc lại</Badge> : null}
          <span className="text-muted-foreground ml-auto text-xs">
            {formatRelative(lead.created_at)}
          </span>
        </div>

        <div className="min-w-0 space-y-1">
          <a
            href={lead.post_url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-11 items-center gap-1 font-medium hover:underline"
          >
            <span className="truncate">{lead.group_name || "Nhóm Facebook"}</span>
            <ExternalLinkIcon className="size-3.5 shrink-0" />
          </a>
          <p className="text-muted-foreground truncate text-xs">
            {lead.author_name ? `${lead.author_name} · ` : ""}
            {formatHostname(lead.post_url)}
          </p>
        </div>

        <p className="text-sm font-medium text-pretty">{lead.summary || "Chưa có tóm tắt."}</p>

        {pending ? (
          <div className="border-warning/40 bg-warning/10 space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">
              Bài viết thô đang chờ phân loại — nội dung gốc bên dưới được giữ nguyên để không mất
              lead.
            </p>
            <RawPost content={lead.post_content} alwaysVisible />
          </div>
        ) : (
          <RawPost content={lead.post_content} alwaysVisible={false} />
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          <DraftBlock
            title={
              <>
                <MessageSquareIcon className="mr-1 inline size-3.5" />
                Gợi ý comment
              </>
            }
            value={lead.suggested_comment}
            copyLabel="Sao chép comment"
          />
          <DraftBlock
            title={
              <>
                <SendIcon className="mr-1 inline size-3.5" />
                Gợi ý inbox
              </>
            }
            value={lead.suggested_dm}
            copyLabel="Sao chép tin nhắn"
          />
        </div>

        <LeadControls
          leadId={lead.id}
          status={lead.status}
          notes={lead.notes}
          nextFollowupAt={lead.next_followup_at}
        />

        <LeadSalesControls
          leadId={lead.id}
          milestones={lead.milestones}
          receipts={lead.receipts}
          recurringTerm={lead.recurringTerm}
        />
      </div>
    </Card>
  );
}
