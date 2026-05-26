import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ScrollText, LogIn, Upload, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import type { PushHistory, Tenant } from "@shared/schema";

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
  const { isAdmin, isLoading: authLoading } = useAuth();

  const { data: logins = [], isLoading: loginsLoading } = useQuery<LoginEvent[]>({
    queryKey: ["/api/admin/history/logins"],
    enabled: isAdmin,
    queryFn: async () => {
      const res = await fetch("/api/admin/history/logins", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch logins");
      return res.json();
    },
  });

  const { data: pushes = [], isLoading: pushesLoading } = useQuery<PushHistory[]>({
    queryKey: ["/api/push-history"],
    enabled: isAdmin,
  });

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
    enabled: isAdmin,
  });

  const tenantMap = Object.fromEntries(tenants.map(t => [t.id, t.name]));

  const errorPushes = pushes.filter(p => (p.errorCount ?? 0) > 0 && p.errorMessages);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin w-6 h-6 text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full p-8 text-muted-foreground">
        Admin access required.
      </div>
    );
  }

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

      <Tabs defaultValue="logins">
        <TabsList className="grid w-full grid-cols-3">
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
            {pushes.length > 0 && (
              <span className="ml-1.5 text-xs bg-muted rounded-full px-1.5 py-0.5">{pushes.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="errors" data-testid="tab-errors">
            <AlertTriangle size={14} className="mr-1.5" />
            Errors
            {errorPushes.length > 0 && (
              <span className="ml-1.5 text-xs bg-destructive/20 text-destructive rounded-full px-1.5 py-0.5">{errorPushes.length}</span>
            )}
          </TabsTrigger>
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
              <CardTitle className="text-base">ServiceTitan Push History</CardTitle>
              <CardDescription>All pricebook pushes across every tenant, most recent first.</CardDescription>
            </CardHeader>
            <CardContent>
              {pushesLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                  <Loader2 className="animate-spin w-4 h-4" /> Loading…
                </div>
              ) : pushes.length === 0 ? (
                <EmptyState icon={Upload} message="No pushes have been made yet." />
              ) : (
                <div className="divide-y divide-border">
                  {[...pushes].sort((a, b) =>
                    new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
                  ).map(push => (
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
                        <div className="text-right shrink-0">
                          <p className="text-xs text-muted-foreground" title={fullDate(push.createdAt ? String(push.createdAt) : null)}>
                            {timeAgo(push.createdAt ? String(push.createdAt) : null)}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-4 pl-1 text-xs text-muted-foreground">
                        {push.processedCount != null && <span>{push.processedCount} processed</span>}
                        {push.updatedCount != null && <span className="text-green-600">{push.updatedCount} updated</span>}
                        {push.skippedCount != null && push.skippedCount > 0 && <span>{push.skippedCount} skipped</span>}
                        {push.errorCount != null && push.errorCount > 0 && (
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
              ) : errorPushes.length === 0 ? (
                <EmptyState icon={AlertTriangle} message="No errors recorded — everything has been clean." />
              ) : (
                <div className="divide-y divide-border">
                  {[...errorPushes].sort((a, b) =>
                    new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
                  ).map(push => (
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
                      {push.errorMessages && <ErrorMessages messages={push.errorMessages} />}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
