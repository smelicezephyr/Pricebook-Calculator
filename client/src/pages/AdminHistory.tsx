import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, ScrollText, LogIn, Upload, AlertTriangle, ChevronDown, ChevronUp, Bell, Users, FileText } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import type { PushHistory, Tenant } from "@shared/schema";

type TeamMember = {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: string;
  pushPermission: string;
};

type TeamQuote = {
  id: number;
  userId: number;
  userName: string;
  type: string;
  name: string | null;
  createdAt: string | null;
  [key: string]: any;
};

type LoginEvent = {
  id: number;
  userId: number | null;
  userEmail: string;
  userName: string;
  createdAt: string | null;
};

function timeAgo(dateStr: string | null) {
  if (!dateStr) return "—";
  return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
}

function fullDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return format(new Date(dateStr), "MMM d, yyyy h:mm a");
}

function pushStatusBadge(status: string) {
  const map: Record<string, string> = {
    completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    cancelled: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    pending: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    reverted: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  };
  return map[status] ?? "bg-gray-100 text-gray-700";
}

function EmptyState({ icon: Icon, message }: { icon: any; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
      <Icon size={32} className="opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function ErrorMessages({ messages }: { messages: string }) {
  const [expanded, setExpanded] = useState(false);
  let parsed: string[] = [];
  try { parsed = JSON.parse(messages); } catch { parsed = [messages]; }
  if (parsed.length === 0) return null;
  const preview = parsed.slice(0, expanded ? parsed.length : 3);
  return (
    <div className="mt-2 space-y-1">
      {preview.map((msg, i) => (
        <p key={i} className="text-xs text-destructive bg-destructive/5 rounded px-2 py-1 font-mono break-all">{msg}</p>
      ))}
      {parsed.length > 3 && (
        <button
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? "Show less" : `Show ${parsed.length - 3} more`}
        </button>
      )}
    </div>
  );
}

export default function AdminHistory() {
  const { user, isAdmin, isManager, isReporting, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
    enabled: isReporting,
  });

  useEffect(() => {
    if (isManager && tenants.length > 0 && !selectedTenantId) {
      setSelectedTenantId(String(tenants[0].id));
    }
  }, [isManager, tenants, selectedTenantId]);

  const loginsQueryParams = new URLSearchParams();
  if (selectedTenantId) loginsQueryParams.set("tenantId", selectedTenantId);
  const loginsQueryString = loginsQueryParams.toString();

  const { data: logins = [], isLoading: loginsLoading } = useQuery<LoginEvent[]>({
    queryKey: ["/api/admin/history/logins", selectedTenantId],
    enabled: isReporting && (!isManager || !!selectedTenantId),
    queryFn: async () => {
      const url = `/api/admin/history/logins${loginsQueryString ? `?${loginsQueryString}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch logins");
      return res.json();
    },
  });

  const { data: pushes = [], isLoading: pushesLoading } = useQuery<PushHistory[]>({
    queryKey: ["/api/push-history"],
    enabled: isReporting,
  });

  const { data: team = [], isLoading: teamLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/reporting/team", selectedTenantId],
    enabled: isManager && !!selectedTenantId,
    queryFn: async () => {
      const res = await fetch(`/api/reporting/team?tenantId=${selectedTenantId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch team");
      return res.json();
    },
  });

  const { data: teamQuotes = [], isLoading: teamQuotesLoading } = useQuery<TeamQuote[]>({
    queryKey: ["/api/reporting/quotes", selectedTenantId],
    enabled: isManager && !!selectedTenantId,
    queryFn: async () => {
      const res = await fetch(`/api/reporting/quotes?tenantId=${selectedTenantId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch quotes");
      return res.json();
    },
  });

  const { data: smtpStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/config/smtp-status"],
  });
  const smtpConfigured = smtpStatus?.configured ?? false;

  const tenantMap = Object.fromEntries(tenants.map(t => [t.id, t.name]));
  const errorPushes = pushes.filter(p => (p.errorCount ?? 0) > 0 && p.errorMessages);

  const emailToggleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      await apiRequest("PUT", "/api/users/me/email-notifications", { enabled });
    },
    onSuccess: (_data, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({
        title: enabled ? "Email notifications on" : "Email notifications off",
        description: enabled
          ? "You'll receive an email when any push completes."
          : "You will no longer receive push notification emails.",
      });
    },
    onError: () => {
      toast({ title: "Failed to update preference", variant: "destructive" });
    },
  });

  const sortedPushes = [...pushes].sort(
    (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
  );
  const sortedErrors = [...errorPushes].sort(
    (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
  );

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin w-6 h-6 text-muted-foreground" />
      </div>
    );
  }

  if (!isReporting) {
    return (
      <div className="flex items-center justify-center h-full p-8 text-muted-foreground">
        Admin or manager access required.
      </div>
    );
  }

  if (isManager && tenants.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-8 text-muted-foreground">
        You haven't been assigned to any tenants yet. Contact an admin.
      </div>
    );
  }

  const scopedPushes = isManager && selectedTenantId
    ? pushes.filter(p => String(p.tenantId) === selectedTenantId)
    : pushes;
  const scopedErrorPushes = scopedPushes.filter(p => (p.errorCount ?? 0) > 0 && p.errorMessages);
  const scopedSortedPushes = [...scopedPushes].sort(
    (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
  );
  const scopedSortedErrors = [...scopedErrorPushes].sort(
    (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ScrollText size={22} />
          Activity Log
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          A record of user logins, ServiceTitan pushes, and any errors that occurred.
        </p>
      </div>

      {/* Tenant Selector — admin (optional filter) or manager (required) */}
      {tenants.length > 0 && (isManager || isAdmin) && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <Label className="text-xs text-muted-foreground shrink-0">Tenant:</Label>
              <select
                value={selectedTenantId}
                onChange={e => setSelectedTenantId(e.target.value)}
                className="h-8 text-sm border border-input rounded-md px-2 bg-background"
                data-testid="select-tenant-filter"
              >
                {isAdmin && <option value="">All tenants</option>}
                {tenants.map(t => (
                  <option key={t.id} value={String(t.id)}>{t.name}</option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="logins">
        <TabsList className={`grid w-full ${isManager ? "grid-cols-5" : "grid-cols-3"}`}>
          <TabsTrigger value="logins" data-testid="tab-logins">
            <LogIn size={14} className="mr-1.5" />
            Logins
            {logins.length > 0 && (
              <span className="ml-1.5 text-xs bg-muted rounded-full px-1.5 py-0.5">{logins.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="pushes" data-testid="tab-pushes">
            <Upload size={14} className="mr-1.5" />
            Push History
            {scopedPushes.length > 0 && (
              <span className="ml-1.5 text-xs bg-muted rounded-full px-1.5 py-0.5">{scopedPushes.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="errors" data-testid="tab-errors">
            <AlertTriangle size={14} className="mr-1.5" />
            Errors
            {scopedErrorPushes.length > 0 && (
              <span className="ml-1.5 text-xs bg-destructive/20 text-destructive rounded-full px-1.5 py-0.5">{scopedErrorPushes.length}</span>
            )}
          </TabsTrigger>
          {isManager && (
            <TabsTrigger value="team" data-testid="tab-team">
              <Users size={14} className="mr-1.5" />
              Team
              {team.length > 0 && (
                <span className="ml-1.5 text-xs bg-muted rounded-full px-1.5 py-0.5">{team.length}</span>
              )}
            </TabsTrigger>
          )}
          {isManager && (
            <TabsTrigger value="quotes" data-testid="tab-quotes">
              <FileText size={14} className="mr-1.5" />
              Quotes
              {teamQuotes.length > 0 && (
                <span className="ml-1.5 text-xs bg-muted rounded-full px-1.5 py-0.5">{teamQuotes.length}</span>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── Logins ───────────────────────────────────────────── */}
        <TabsContent value="logins">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">User Logins</CardTitle>
              <CardDescription>Every Google sign-in, most recent first.</CardDescription>
            </CardHeader>
            <CardContent>
              {loginsLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                  <Loader2 className="animate-spin w-4 h-4" /> Loading…
                </div>
              ) : logins.length === 0 ? (
                <EmptyState icon={LogIn} message="No logins recorded yet." />
              ) : (
                <div className="divide-y divide-border">
                  {logins.map(event => (
                    <div key={event.id} className="flex items-center justify-between py-3 gap-4" data-testid={`row-login-${event.id}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{event.userName}</p>
                        <p className="text-xs text-muted-foreground truncate">{event.userEmail}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-muted-foreground" title={fullDate(event.createdAt)}>
                          {timeAgo(event.createdAt)}
                        </p>
                        <p className="text-xs text-muted-foreground/60">{fullDate(event.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Push History ─────────────────────────────────────── */}
        <TabsContent value="pushes">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base">ServiceTitan Push History</CardTitle>
                  <CardDescription>All pricebook pushes across every tenant, most recent first.</CardDescription>
                </div>
                {/* Per-admin email notification toggle */}
                <div
                  className={`flex items-center gap-2 shrink-0 pt-0.5 ${!smtpConfigured ? "opacity-50 cursor-not-allowed" : ""}`}
                  data-testid="email-notifications-toggle"
                  title={!smtpConfigured ? "SMTP not configured — set SMTP_HOST, SMTP_USER, and SMTP_PASS to enable email delivery" : undefined}
                >
                  <Bell size={14} className={user?.emailNotifications && smtpConfigured ? "text-primary" : "text-muted-foreground"} />
                  <Switch
                    id="email-notifications"
                    checked={!!user?.emailNotifications}
                    disabled={emailToggleMutation.isPending || !smtpConfigured}
                    onCheckedChange={enabled => emailToggleMutation.mutate(enabled)}
                    data-testid="switch-email-notifications"
                  />
                  <Label
                    htmlFor="email-notifications"
                    className={`text-sm select-none ${smtpConfigured ? "cursor-pointer" : "cursor-not-allowed"}`}
                  >
                    Email me on completion
                  </Label>
                </div>
              </div>
              {!smtpConfigured && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
                  ⚠ No SMTP configured — set SMTP_HOST, SMTP_USER, and SMTP_PASS to enable email delivery.
                </p>
              )}
            </CardHeader>
            <CardContent>
              {pushesLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                  <Loader2 className="animate-spin w-4 h-4" /> Loading…
                </div>
              ) : scopedSortedPushes.length === 0 ? (
                <EmptyState icon={Upload} message="No pushes have been made yet." />
              ) : (
                <div className="divide-y divide-border">
                  {scopedSortedPushes.map(push => (
                    <div key={push.id} className="py-3 space-y-1" data-testid={`row-push-${push.id}`}>
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0 flex items-center gap-2">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${pushStatusBadge(push.status)}`}>
                            {push.status}
                          </span>
                          <span className="text-sm font-medium truncate">
                            {tenantMap[push.tenantId] ?? `Tenant #${push.tenantId}`}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground shrink-0" title={fullDate(push.createdAt ? String(push.createdAt) : null)}>
                          {timeAgo(push.createdAt ? String(push.createdAt) : null)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 pl-1 text-xs text-muted-foreground">
                        {(push as any).pushedByName && (
                          <span className="font-medium text-foreground/70">↑ {(push as any).pushedByName}</span>
                        )}
                        {push.processedCount != null && <span>{push.processedCount} processed</span>}
                        {push.updatedCount != null && <span className="text-green-600 dark:text-green-400">{push.updatedCount} updated</span>}
                        {(push.skippedCount ?? 0) > 0 && <span>{push.skippedCount} skipped</span>}
                        {(push.errorCount ?? 0) > 0 && (
                          <span className="text-destructive">{push.errorCount} errors</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Errors ───────────────────────────────────────────── */}
        <TabsContent value="errors">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Push Errors</CardTitle>
              <CardDescription>Pushes that encountered one or more errors.</CardDescription>
            </CardHeader>
            <CardContent>
              {pushesLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                  <Loader2 className="animate-spin w-4 h-4" /> Loading…
                </div>
              ) : scopedSortedErrors.length === 0 ? (
                <EmptyState icon={AlertTriangle} message="No errors recorded — everything has been clean." />
              ) : (
                <div className="divide-y divide-border">
                  {scopedSortedErrors.map(push => (
                    <div key={push.id} className="py-3 space-y-1" data-testid={`row-error-${push.id}`}>
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="destructive" className="text-xs shrink-0">
                            {push.errorCount} error{(push.errorCount ?? 0) > 1 ? "s" : ""}
                          </Badge>
                          <span className="text-sm font-medium truncate">
                            {tenantMap[push.tenantId] ?? `Tenant #${push.tenantId}`}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground shrink-0" title={fullDate(push.createdAt ? String(push.createdAt) : null)}>
                          {timeAgo(push.createdAt ? String(push.createdAt) : null)}
                        </p>
                      </div>
                      {(push as any).pushedByName && (
                        <p className="text-xs text-muted-foreground pl-1">↑ {(push as any).pushedByName}</p>
                      )}
                      {push.errorMessages && <ErrorMessages messages={push.errorMessages} />}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Team (manager only) ─────────────────────────────────── */}
        {isManager && (
          <TabsContent value="team">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Team Members</CardTitle>
                <CardDescription>Everyone with access to this tenant. Read-only — contact an admin to make changes.</CardDescription>
              </CardHeader>
              <CardContent>
                {teamLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                    <Loader2 className="animate-spin w-4 h-4" /> Loading…
                  </div>
                ) : team.length === 0 ? (
                  <EmptyState icon={Users} message="No team members found for this tenant." />
                ) : (
                  <div className="divide-y divide-border">
                    {team.map(member => (
                      <div key={member.id} className="flex items-center justify-between py-3 gap-4" data-testid={`row-team-${member.id}`}>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{member.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                        </div>
                        <Badge variant="outline" className="text-xs capitalize shrink-0">{member.role}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ── Quotes (manager only) ────────────────────────────────── */}
        {isManager && (
          <TabsContent value="quotes">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Saved Quotes</CardTitle>
                <CardDescription>Quotes saved by anyone on this tenant, most recent first.</CardDescription>
              </CardHeader>
              <CardContent>
                {teamQuotesLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                    <Loader2 className="animate-spin w-4 h-4" /> Loading…
                  </div>
                ) : teamQuotes.length === 0 ? (
                  <EmptyState icon={FileText} message="No quotes saved yet for this tenant." />
                ) : (
                  <div className="divide-y divide-border">
                    {[...teamQuotes]
                      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
                      .map(quote => (
                        <div key={quote.id} className="flex items-center justify-between py-3 gap-4" data-testid={`row-quote-${quote.id}`}>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{quote.name || `${quote.type} quote`}</p>
                            <p className="text-xs text-muted-foreground truncate">by {quote.userName} · {quote.type}</p>
                          </div>
                          <p className="text-xs text-muted-foreground shrink-0" title={fullDate(quote.createdAt)}>
                            {timeAgo(quote.createdAt)}
                          </p>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
