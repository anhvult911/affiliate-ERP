import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  AlertTriangleIcon,
  KeyRoundIcon,
  PauseCircleIcon,
  ShieldCheckIcon,
  UsersIcon
} from "lucide-react";

import {
  AccountFormDialog,
  NewAccountTrigger
} from "@/components/accounts/account-form-dialog";
import { AccountFilters } from "@/components/accounts/account-filters";
import { ImportAccountsDialog } from "@/components/accounts/import-accounts-dialog";
import { AccountRowActions } from "@/components/accounts/account-row-actions";
import { TrustProgress } from "@/components/accounts/trust-progress";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { ResponsiveView } from "@/components/patterns/responsive-view";
import { StatCard } from "@/components/patterns/stat-card";
import { AccountStatusBadge } from "@/components/patterns/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  ACCOUNT_STATUSES,
  type AccountStatus
} from "@/lib/constants";
import {
  getAccountStats,
  listAccountDailyUsage,
  listAccounts,
  listPersonaTypes,
  type AccountDailyUsage,
  type AccountRow
} from "@/lib/data/accounts";
import { formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Dàn tài khoản & Persona" };

/** "3/8" today, so an idle queue can be explained at a glance. */
function DailyBudget({ account, usage }: { account: AccountRow; usage?: AccountDailyUsage }) {
  const used = usage?.comments24h ?? 0;
  const limit = account.daily_comment_limit;
  const exhausted = used >= limit;

  return (
    <span className={exhausted ? "text-amber-600" : "text-muted-foreground"}>
      {used}/{limit} comment · {usage?.warming24h ?? 0}/{account.daily_warming_limit} warming
    </span>
  );
}

function AccountTable({
  accounts,
  personaTypes,
  usage
}: {
  accounts: AccountRow[];
  personaTypes: string[];
  usage: Map<string, AccountDailyUsage>;
}) {
  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tài khoản</TableHead>
            <TableHead>Persona</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead>Trust score</TableHead>
            <TableHead>Profile / proxy</TableHead>
            <TableHead>Hoạt động gần nhất</TableHead>
            <TableHead className="text-right">Thao tác</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account) => (
            <TableRow key={account.id}>
              <TableCell>
                <Link
                  href={`/accounts/${account.id}`}
                  className="block max-w-56 truncate font-medium hover:underline"
                >
                  {account.name}
                </Link>
                <span className="text-muted-foreground text-xs capitalize">
                  {account.platform}
                </span>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{account.persona_type}</Badge>
                  {account.login_identifier ? (
                    <Badge variant="secondary" title={`Đã nhập thông tin đăng nhập: ${account.login_identifier}`}>
                      <KeyRoundIcon aria-hidden className="size-3" />
                      login
                    </Badge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <AccountStatusBadge status={account.status} />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <TrustProgress score={account.trust_score} className="w-24" />
                  <span className="w-8 text-xs tabular-nums">{account.trust_score}</span>
                </div>
              </TableCell>
              <TableCell>
                <p className="max-w-48 truncate font-mono text-xs">
                  {account.browser_profile_id ?? "—"}
                </p>
                <p className="text-muted-foreground max-w-48 truncate font-mono text-xs">
                  {account.proxy_ip ?? "—"}
                </p>
              </TableCell>
              <TableCell className="text-xs">
                <p className="text-muted-foreground">{formatRelative(account.last_action_at)}</p>
                <DailyBudget account={account} usage={usage.get(account.id)} />
              </TableCell>
              <TableCell className="text-right">
                <AccountRowActions account={account} personaTypes={personaTypes} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AccountMobileCard({
  account,
  personaTypes,
  usage
}: {
  account: AccountRow;
  personaTypes: string[];
  usage?: AccountDailyUsage;
}) {
  return (
    <Card className="p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/accounts/${account.id}`} className="flex min-h-11 items-center hover:underline">
            <span className="truncate font-medium">{account.name}</span>
          </Link>
          <p className="text-muted-foreground text-xs capitalize">{account.platform}</p>
        </div>
        <AccountStatusBadge status={account.status} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{account.persona_type}</Badge>
        {account.login_identifier ? (
          <Badge variant="secondary">
            <KeyRoundIcon aria-hidden className="size-3" />
            login
          </Badge>
        ) : null}
        <span className="text-muted-foreground text-xs">
          Thao tác gần nhất {formatRelative(account.last_action_at)}
        </span>
        <span className="text-muted-foreground text-xs">
          <DailyBudget account={account} usage={usage} />
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Trust score</span>
          <span className="font-medium tabular-nums">{account.trust_score}/100</span>
        </div>
        <TrustProgress score={account.trust_score} className="h-2.5" />
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div className="min-w-0">
          <dt className="text-muted-foreground">Browser profile</dt>
          <dd className="truncate font-mono">{account.browser_profile_id ?? "—"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Proxy</dt>
          <dd className="truncate font-mono">{account.proxy_ip ?? "—"}</dd>
        </div>
      </dl>

      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="lg" className="flex-1">
          <Link href={`/accounts/${account.id}`}>Open account</Link>
        </Button>
        <AccountRowActions account={account} personaTypes={personaTypes} />
      </div>
    </Card>
  );
}

export default async function AccountsPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const rawStatus = typeof params.status === "string" ? params.status : null;
  const statusFilter =
    rawStatus && (ACCOUNT_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as AccountStatus)
      : null;

  const [accounts, stats, personaTypes, usage] = await Promise.all([
    listAccounts({ query, status: statusFilter ?? undefined }),
    getAccountStats(),
    listPersonaTypes(),
    listAccountDailyUsage()
  ]);

  const filtering = query.trim().length > 0 || statusFilter !== null;

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Dàn tài khoản &amp; Persona"
        description="Quản lý dàn nick mạng xã hội: nuôi nick tự động (warming), điểm tin cậy (trust score) và trạng thái sẵn sàng seeding."
        actions={
          <>
            <ImportAccountsDialog personaTypes={personaTypes} />
            <AccountFormDialog
              personaTypes={personaTypes}
              trigger={<NewAccountTrigger />}
            />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Tổng tài khoản" value={stats.total} icon={UsersIcon} />
        <StatCard
          label="Hoạt động"
          value={stats.active}
          icon={ShieldCheckIcon}
          tone="success"
        />
        <StatCard
          label="Nghỉ ngơi"
          value={stats.cooldown}
          icon={PauseCircleIcon}
          tone="warning"
        />
        <StatCard
          label="Checkpoint"
          value={stats.checkpoint}
          icon={AlertTriangleIcon}
          tone="destructive"
        />
        <StatCard
          label="Trust TB"
          value={`${stats.averageTrustScore}/100`}
          hint="Toàn bộ dàn tài khoản"
        />
      </div>

      <Suspense fallback={<div className="h-11" aria-hidden />}>
        <AccountFilters query={query} status={statusFilter} />
      </Suspense>

      {accounts.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={filtering ? "Không tìm thấy tài khoản nào khớp bộ lọc" : "Chưa có tài khoản nào"}
          description={
            filtering
              ? "Xóa tìm kiếm hoặc chọn trạng thái khác để xem các tài khoản còn lại."
              : "Thêm tài khoản Facebook đầu tiên, gán persona và lịch warming để worker tự động nuôi nick."
          }
          action={
            filtering ? undefined : (
              <AccountFormDialog
                personaTypes={personaTypes}
                trigger={<NewAccountTrigger />}
              />
            )
          }
        />
      ) : (
        <ResponsiveView
          desktop={<AccountTable accounts={accounts} personaTypes={personaTypes} usage={usage} />}
          mobile={accounts.map((account) => (
            <AccountMobileCard
              key={account.id}
              account={account}
              personaTypes={personaTypes}
              usage={usage.get(account.id)}
            />
          ))}
        />
      )}

      {accounts.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          {accounts.length} {accounts.length === 1 ? "account" : "accounts"} shown
          {filtering ? " for the current filters" : ""}.
        </p>
      ) : null}
    </div>
  );
}
