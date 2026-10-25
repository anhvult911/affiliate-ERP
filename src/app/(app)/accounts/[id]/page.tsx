import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ClipboardListIcon } from "lucide-react";

import { AccountControls } from "@/components/accounts/account-controls";
import { AccountFormDialog } from "@/components/accounts/account-form-dialog";
import { PersonaManager } from "@/components/accounts/persona-manager";
import { TrustProgress } from "@/components/accounts/trust-progress";
import { ProfileReadinessCard } from "@/components/accounts/profile-readiness-card";
import { WarmingActivity } from "@/components/accounts/warming-activity";
import { CopyButton } from "@/components/patterns/copy-button";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import {
  AccountStatusBadge,
  TaskStatusBadge
} from "@/components/patterns/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  formatDateTime,
  formatHostname,
  formatMatchScore,
  formatNumber,
  formatRelative,
  formatVnd
} from "@/lib/format";
import {
  getAccount,
  getAccountPerformance,
  getAccountRecentTasks,
  listPersonaTypes
} from "@/lib/data/accounts";
import { getProfileReadiness, getWarmingStats, listWarmingRuns } from "@/lib/data/warming";

export async function generateMetadata({
  params
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const account = await getAccount(id);
  return { title: account ? `${account.name} — Accounts` : "Account" };
}

export default async function AccountDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const account = await getAccount(id);
  if (!account) notFound();

  const [performance, tasks, personaTypes, warmingRuns, warmingStats, profileReadiness] = await Promise.all([
    getAccountPerformance(id),
    getAccountRecentTasks(id, 10),
    listPersonaTypes(),
    listWarmingRuns(id),
    getWarmingStats(id),
    getProfileReadiness(id)
  ]);

  const platformLabel =
    account.platform.charAt(0).toUpperCase() + account.platform.slice(1);

  return (
    <div className="space-y-4 sm:space-y-6">
      <Button asChild variant="ghost" size="lg" className="-ml-2 w-fit">
        <Link href="/accounts">
          <ArrowLeftIcon />
          Accounts
        </Link>
      </Button>

      <PageHeader
        title={account.name}
        description={`${platformLabel} account · ${account.persona_type} persona · registered ${formatDateTime(account.created_at)}`}
        actions={
          <AccountFormDialog
            account={account}
            personaTypes={personaTypes}
            trigger={
              <Button size="lg" className="w-full sm:w-auto">
                Sửa tài khoản
              </Button>
            }
          />
        }
      />

      <Card>
        <div className="space-y-4 px-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <AccountStatusBadge status={account.status} />
            <Badge variant="outline" className="capitalize">
              {platformLabel}
            </Badge>
            <Badge variant="secondary">{account.persona_type}</Badge>
            <Badge variant={account.warmup_enabled ? "info" : "muted"}>
              {account.warmup_enabled ? "Warmup on" : "Warmup off"}
            </Badge>
            {account.status === "cooldown" && account.cooldown_until ? (
              <span className="text-muted-foreground text-xs">
                Until {formatDateTime(account.cooldown_until)}
              </span>
            ) : null}
          </div>
          <div className="max-w-xl space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Trust score</span>
              <span className="font-semibold tabular-nums">{account.trust_score}/100</span>
            </div>
            <TrustProgress score={account.trust_score} className="h-3" />
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Last warmed</span>
              <span>{account.last_warmed_at ? formatRelative(account.last_warmed_at) : "never"}</span>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <div className="space-y-4 sm:space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Persona manager</CardTitle>
              <CardDescription>
                Persona key and the daily warming slots the worker executes in order.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PersonaManager account={account} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status &amp; warming controls</CardTitle>
              <CardDescription>
                Pause the account, clamp its trust score or stop the warming schedule.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AccountControls account={account} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent tasks</CardTitle>
              <CardDescription>
                Latest comment tasks assigned to this account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 ? (
                <EmptyState
                  icon={ClipboardListIcon}
                  title="No tasks yet"
                  description="Approved drafts assigned to this account will show up here."
                />
              ) : (
                <ul className="-mx-1 divide-y">
                  {tasks.map((task) => (
                    <li key={task.id}>
                      <Link
                        href={`/queue?task=${task.id}`}
                        className="hover:bg-muted/50 flex min-h-11 flex-col gap-2 rounded-md px-1 py-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <TaskStatusBadge status={task.status} />
                          <span className="text-muted-foreground shrink-0 text-xs">
                            {formatRelative(task.created_at)}
                          </span>
                        </div>
                        <p className="line-clamp-2 text-sm">
                          {task.ai_draft_comment ?? task.post_content ?? "No draft yet"}
                        </p>
                        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <span className="truncate">
                            {task.product?.name ?? "Unmatched product"}
                          </span>
                          <span className="truncate">
                            {task.source?.name ?? "Unknown source"}
                          </span>
                          <span>{formatMatchScore(task.match_score)} match</span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <ProfileReadinessCard readiness={profileReadiness} />
          <WarmingActivity runs={warmingRuns} stats={warmingStats} />
        </div>

        <div className="space-y-4 sm:space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Identity</CardTitle>
              <CardDescription>Browser profile, proxy and bio link.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs">Browser profile id</p>
                  <p className="truncate font-mono text-sm">
                    {account.browser_profile_id ?? "—"}
                  </p>
                </div>
                {account.browser_profile_id ? (
                  <CopyButton
                    value={account.browser_profile_id}
                    label="Copy browser profile id"
                    size="icon"
                  />
                ) : null}
              </div>

              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs">Proxy</p>
                  <p className="truncate font-mono text-sm">{account.proxy_ip ?? "—"}</p>
                </div>
                {account.proxy_ip ? (
                  <CopyButton value={account.proxy_ip} label="Copy proxy" size="icon" />
                ) : null}
              </div>

              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs">Bio link</p>
                  {account.bio_link_url ? (
                    <a
                      href={account.bio_link_url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-sm underline underline-offset-4"
                    >
                      {formatHostname(account.bio_link_url)}
                    </a>
                  ) : (
                    <p className="text-sm">—</p>
                  )}
                </div>
                {account.bio_link_url ? (
                  <CopyButton
                    value={account.bio_link_url}
                    label="Copy bio link"
                    size="icon"
                  />
                ) : null}
              </div>

              <div>
                <p className="text-muted-foreground text-xs">Notes</p>
                <p className="text-sm whitespace-pre-wrap">{account.notes ?? "—"}</p>
              </div>

              <div className="text-muted-foreground space-y-1 text-xs">
                <p>Created {formatDateTime(account.created_at)}</p>
                <p>Updated {formatDateTime(account.updated_at)}</p>
                <p>Thao tác gần nhất {formatRelative(account.last_action_at)}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Performance</CardTitle>
              <CardDescription>Attribution from executed tasks.</CardDescription>
            </CardHeader>
            <CardContent>
              {performance ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-muted-foreground text-xs">Comments published</p>
                      <p className="text-xl font-semibold tabular-nums">
                        {formatNumber(performance.comments_published ?? 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Comments failed</p>
                      <p className="text-xl font-semibold tabular-nums">
                        {formatNumber(performance.comments_failed ?? 0)}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Revenue</p>
                    <p className="text-xl font-semibold tabular-nums">
                      {formatVnd(performance.revenue ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Settled commission</p>
                    <p className="text-xl font-semibold tabular-nums">
                      {formatVnd(performance.settled_commission ?? 0)}
                    </p>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Last executed {formatRelative(performance.last_executed_at)}
                  </p>
                </div>
              ) : (
                <EmptyState
                  title="No performance yet"
                  description="The account has not executed a task."
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
