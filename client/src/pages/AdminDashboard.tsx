import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, BarChart2, CheckCircle2, XCircle, RefreshCw, Building2, Users, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";

type DashboardData = {
  totalPushes: number;
  completedPushes: number;
  failedPushes: number;
  totalUpdated: number;
  successRate: number | null;
  activeTenants: number;
  activeUsers: number;
  byTenant: {
    id: number;
    name: string;
    totalPushes: number;
    completed: number;
    failed: number;
    totalUpdated: number;
    lastPush: string | null;
    successRate: number | null;
  }[];
  monthly: { month: string; pushes: number; updated: number }[];
};

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground font-medium">{title}</p>
            <p className={`text-3xl font-bold mt-1 ${accent ?? "text-foreground"}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className="p-2 bg-muted rounded-lg">
            <Icon className="w-5 h-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminDashboard() {
  const { isAdmin, isLoading: authLoading } = useAuth();

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/admin/dashboard"],
    enabled: isAdmin,
    refetchInterval: 60_000,
  });

  if (authLoading || isLoading) {
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

  if (!data) return null;

  const formatNumber = (n: number) => n.toLocaleString();

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BarChart2 size={22} />
          Dashboard
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Push performance and adoption metrics across all tenants.
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Services Updated"
          value={formatNumber(data.totalUpdated)}
          sub="across all completed pushes"
          icon={TrendingUp}
          accent="text-emerald-600"
        />
        <StatCard
          title="Push Success Rate"
          value={data.successRate !== null ? `${data.successRate}%` : "—"}
          sub={`${formatNumber(data.completedPushes)} completed · ${formatNumber(data.failedPushes)} failed`}
          icon={CheckCircle2}
          accent={data.successRate !== null && data.successRate >= 80 ? "text-emerald-600" : "text-amber-600"}
        />
        <StatCard
          title="Active Tenants"
          value={data.activeTenants}
          sub="tenants with push activity"
          icon={Building2}
        />
        <StatCard
          title="Active Users"
          value={data.activeUsers}
          sub="users with app access"
          icon={Users}
        />
      </div>

      {/* Monthly Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly Activity</CardTitle>
          <CardDescription>Services updated per month over the last 6 months.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.monthly.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              No push activity yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.monthly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(val: number, name: string) => [
                    val.toLocaleString(),
                    name === "updated" ? "Services Updated" : "Push Operations",
                  ]}
                />
                <Bar dataKey="updated" name="updated" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="pushes" name="pushes" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} opacity={0.4} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Per-Tenant Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-Tenant Breakdown</CardTitle>
          <CardDescription>Push history and success rate for each configured tenant.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.byTenant.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No tenants configured yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-left">
                    <th className="pb-3 font-medium">Tenant</th>
                    <th className="pb-3 font-medium text-right">Pushes</th>
                    <th className="pb-3 font-medium text-right">Services Updated</th>
                    <th className="pb-3 font-medium text-right">Success Rate</th>
                    <th className="pb-3 font-medium text-right">Last Push</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.byTenant.map((t) => (
                    <tr key={t.id} className="hover:bg-muted/40 transition-colors" data-testid={`row-tenant-${t.id}`}>
                      <td className="py-3 font-medium">{t.name}</td>
                      <td className="py-3 text-right tabular-nums">
                        <span className="text-foreground">{t.totalPushes}</span>
                        {t.failed > 0 && (
                          <span className="text-destructive ml-1 text-xs">({t.failed} failed)</span>
                        )}
                      </td>
                      <td className="py-3 text-right tabular-nums text-emerald-600 font-semibold">
                        {formatNumber(t.totalUpdated)}
                      </td>
                      <td className="py-3 text-right">
                        {t.successRate !== null ? (
                          <Badge
                            variant="outline"
                            className={
                              t.successRate >= 90
                                ? "border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30"
                                : t.successRate >= 70
                                ? "border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/30"
                                : "border-destructive/40 text-destructive"
                            }
                          >
                            {t.successRate}%
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-3 text-right text-muted-foreground">
                        {t.lastPush ? format(new Date(t.lastPush), "MMM d, yyyy") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Totals row */}
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="pt-3">Total</td>
                    <td className="pt-3 text-right tabular-nums">{formatNumber(data.totalPushes)}</td>
                    <td className="pt-3 text-right tabular-nums text-emerald-600">{formatNumber(data.totalUpdated)}</td>
                    <td className="pt-3 text-right">
                      {data.successRate !== null ? (
                        <Badge
                          variant="outline"
                          className={
                            data.successRate >= 90
                              ? "border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30"
                              : "border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/30"
                          }
                        >
                          {data.successRate}%
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
