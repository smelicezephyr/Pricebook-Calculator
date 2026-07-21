import { useQuery } from "@tanstack/react-query";
import { useRef, useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2, BarChart2, CheckCircle2, Building2, Users,
  TrendingUp, FileDown, CalendarRange, RotateCcw, LogIn,
  RefreshCw, Plus, Wrench, FileText, DatabaseZap,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format, subDays, subMonths, startOfYear, startOfMonth, startOfWeek, endOfWeek, subWeeks } from "date-fns";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

// ── Types ────────────────────────────────────────────────────────────────────

type DashboardData = {
  totalPushes: number;
  completedPushes: number;
  failedPushes: number;
  totalUpdated: number;
  successRate: number | null;
  activeTenants: number;
  activeUsers: number;
  loginCount: number;
  totalQuotes: number;
  byType: { update: number; newSystem: number; newRepair: number };
  recentLogins: { id: number; name: string; email: string; role: string; createdAt: string }[];
  byTenant: {
    id: number;
    name: string;
    totalPushes: number;
    completed: number;
    failed: number;
    totalUpdated: number;
    lastPush: string | null;
    totalQuotes: number;
    successRate: number | null;
  }[];
  monthly: { month: string; pushes: number; updated: number; quotes: number }[];
};

type DateRange = { startDate: string; endDate: string };

const STORAGE_KEY = "adminDashboard_dateRange";

const fmt = (d: Date) => format(d, "yyyy-MM-dd");
const today = () => fmt(new Date());

const PRESETS = [
  { label: "Today",         range: () => ({ startDate: today(), endDate: today() }) },
  { label: "Yesterday",     range: () => ({ startDate: fmt(subDays(new Date(), 1)), endDate: fmt(subDays(new Date(), 1)) }) },
  { label: "Week to date",  range: () => ({ startDate: fmt(startOfWeek(new Date(), { weekStartsOn: 1 })), endDate: today() }) },
  { label: "Prev week",     range: () => {
    const lastWeek = subWeeks(new Date(), 1);
    return { startDate: fmt(startOfWeek(lastWeek, { weekStartsOn: 1 })), endDate: fmt(endOfWeek(lastWeek, { weekStartsOn: 1 })) };
  }},
  { label: "Month to date", range: () => ({ startDate: fmt(startOfMonth(new Date())), endDate: today() }) },
  { label: "Last 30 days",  range: () => ({ startDate: fmt(subDays(new Date(), 29)), endDate: today() }) },
  { label: "Last 90 days",  range: () => ({ startDate: fmt(subDays(new Date(), 89)), endDate: today() }) },
  { label: "Last 6 months", range: () => ({ startDate: fmt(subMonths(new Date(), 6)), endDate: today() }) },
  { label: "This year",     range: () => ({ startDate: fmt(startOfYear(new Date())), endDate: today() }) },
  { label: "All time",      range: () => ({ startDate: "", endDate: "" }) },
];

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  user: "User",
  everyone: "View-only",
};

// ── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  title, value, sub, icon: Icon, accent,
}: {
  title: string; value: string | number; sub?: string;
  icon: React.ElementType; accent?: string;
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

// ── Main Page ────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { isAdmin, isManager, isReporting, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");

  const { data: tenants = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/tenants"],
    enabled: isReporting,
  });

  useEffect(() => {
    if (isManager && tenants.length > 0 && !selectedTenantId) {
      setSelectedTenantId(String(tenants[0].id));
    }
  }, [isManager, tenants, selectedTenantId]);

  // Date range state — load from localStorage on mount
  const [range, setRange] = useState<DateRange>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return PRESETS[2].range(); // default: last 6 months
  });

  // Active preset label (derived)
  const activePreset = PRESETS.find(
    p => p.range().startDate === range.startDate && p.range().endDate === range.endDate,
  )?.label ?? "Custom";

  // Persist whenever range changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(range));
  }, [range]);

  // Build query key + URL params
  const queryParams = new URLSearchParams();
  if (range.startDate) queryParams.set("startDate", range.startDate);
  if (range.endDate)   queryParams.set("endDate",   range.endDate);
  if (selectedTenantId) queryParams.set("tenantId", selectedTenantId);
  const queryString = queryParams.toString();

  const { data, isLoading, isError } = useQuery<DashboardData>({
    queryKey: ["/api/admin/dashboard", range.startDate, range.endDate, selectedTenantId],
    queryFn: async () => {
      const url = `/api/admin/dashboard${queryString ? `?${queryString}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: isReporting && (!isManager || !!selectedTenantId),
    refetchInterval: 60_000,
  });

  // ── PDF Export ──────────────────────────────────────────────────────────────
  const handleExportPdf = useCallback(async () => {
    if (!printRef.current || !data) return;
    setExporting(true);
    try {
      const canvas = await toPng(printRef.current, { cacheBust: true, pixelRatio: 2 });
      const img = new Image();
      img.src = canvas;
      await new Promise(r => { img.onload = r; });

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const availW = pageW - margin * 2;

      // Header
      pdf.setFontSize(16);
      pdf.setFont("helvetica", "bold");
      pdf.text("PricebookCalc — Admin Dashboard", margin, margin + 6);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(120);
      const rangeLabel = range.startDate && range.endDate
        ? `${format(new Date(range.startDate), "MMM d, yyyy")} – ${format(new Date(range.endDate), "MMM d, yyyy")}`
        : "All time";
      pdf.text(`Report period: ${rangeLabel}   ·   Generated ${format(new Date(), "MMM d, yyyy h:mm a")}`, margin, margin + 12);
      pdf.setTextColor(0);

      // Dashboard image below header
      const headerH = 22;
      const imgAspect = img.naturalHeight / img.naturalWidth;
      let imgH = availW * imgAspect;
      const maxImgH = pageH - margin - headerH - margin;
      if (imgH > maxImgH) imgH = maxImgH;

      pdf.addImage(canvas, "PNG", margin, margin + headerH, availW, imgH);

      const dateTag = format(new Date(), "yyyy-MM-dd");
      pdf.save(`pricebookcalc-dashboard-${dateTag}.pdf`);
    } catch (e) {
      console.error("PDF export failed", e);
    } finally {
      setExporting(false);
    }
  }, [data, range]);

  const handleBackfillTenants = useCallback(async () => {
    if (!confirm("This will assign a tenant to any quote that was saved without one, but only when the author has exactly one tenant. Safe to run multiple times. Continue?")) return;
    setBackfilling(true);
    try {
      const res = await apiRequest("POST", "/api/admin/backfill-quote-tenants");
      const json = await res.json();
      toast({ title: `Backfill complete`, description: `${json.fixed} quote(s) updated.` });
    } catch {
      toast({ title: "Backfill failed", description: "Check console for details.", variant: "destructive" });
    } finally {
      setBackfilling(false);
    }
  }, [toast]);

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (authLoading) return <Spinner />;
  if (!isReporting) return <Center>Admin or manager access required.</Center>;
  if (isManager && tenants.length === 0) {
    return <Center>You haven't been assigned to any tenants yet. Contact an admin.</Center>;
  }
  if (isLoading) return <Spinner />;
  if (isError || !data) return <Center>Failed to load dashboard data. Please try again.</Center>;

  const fmtNum = (n: number) => n.toLocaleString();
  const byType = data.byType ?? { update: 0, newSystem: 0, newRepair: 0 };
  const loginCount = data.loginCount ?? 0;
  const recentLogins = data.recentLogins ?? [];

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">

      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart2 size={22} />
            Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {isManager
              ? "Push performance and adoption metrics for your tenant."
              : "Push performance and adoption metrics across all tenants."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleBackfillTenants}
              disabled={backfilling}
              data-testid="button-backfill-tenants"
              title="Assign tenant to quotes saved without one (safe to run multiple times)"
            >
              {backfilling
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <DatabaseZap className="w-4 h-4 mr-2" />}
              Fix Unlinked Quotes
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPdf}
            disabled={exporting || !data}
            data-testid="button-export-pdf"
          >
            {exporting
              ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              : <FileDown className="w-4 h-4 mr-2" />}
            Export PDF
          </Button>
        </div>
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

      {/* Date Range Controls */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col gap-3">
            {/* Preset dropdown */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-1 shrink-0">
                <CalendarRange size={13} /> Period:
              </span>
              <select
                value={activePreset}
                onChange={e => {
                  const preset = PRESETS.find(p => p.label === e.target.value);
                  if (preset) setRange(preset.range());
                }}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                data-testid="select-period-preset"
              >
                {activePreset === "Custom" && <option value="Custom">Custom</option>}
                {PRESETS.map(p => (
                  <option key={p.label} value={p.label}>{p.label}</option>
                ))}
              </select>
            </div>

            {/* Custom date inputs */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">From</Label>
                <Input
                  type="date"
                  value={range.startDate}
                  max={range.endDate || today()}
                  onChange={e => setRange(r => ({ ...r, startDate: e.target.value }))}
                  className="h-8 text-sm w-40"
                  data-testid="input-start-date"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">To</Label>
                <Input
                  type="date"
                  value={range.endDate}
                  min={range.startDate}
                  max={today()}
                  onChange={e => setRange(r => ({ ...r, endDate: e.target.value }))}
                  className="h-8 text-sm w-40"
                  data-testid="input-end-date"
                />
              </div>
              {(range.startDate || range.endDate) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs text-muted-foreground"
                  onClick={() => setRange({ startDate: "", endDate: "" })}
                  data-testid="button-clear-dates"
                >
                  <RotateCcw size={12} className="mr-1" /> Clear
                </Button>
              )}
            </div>

            {activePreset !== "All time" && (
              <p className="text-xs text-muted-foreground -mt-1">
                Showing data for: <span className="font-medium text-foreground">{activePreset}</span>
                {range.startDate && range.endDate && ` (${format(new Date(range.startDate), "MMM d, yyyy")} – ${format(new Date(range.endDate), "MMM d, yyyy")})`}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Printable content area */}
      <div ref={printRef} className="space-y-6 bg-background p-1 rounded-lg">

        {/* Stat Cards — row 1: overall performance */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Services Updated"
            value={fmtNum(data.totalUpdated)}
            sub="across all completed pushes"
            icon={TrendingUp}
            accent="text-emerald-600"
          />
          <StatCard
            title="Push Success Rate"
            value={data.successRate !== null ? `${data.successRate}%` : "—"}
            sub={`${fmtNum(data.completedPushes)} completed · ${fmtNum(data.failedPushes)} failed`}
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

        {/* Stat Cards — row 2: push type breakdown + logins + quotes */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard
            title="Pricebook Updates"
            value={fmtNum(byType.update)}
            sub="bulk reprice pushes"
            icon={RefreshCw}
          />
          <StatCard
            title="New System Tasks"
            value={fmtNum(byType.newSystem)}
            sub="new install tasks created"
            icon={Plus}
            accent="text-blue-600"
          />
          <StatCard
            title="New Repair Tasks"
            value={fmtNum(byType.newRepair)}
            sub="new repair tasks created"
            icon={Wrench}
            accent="text-violet-600"
          />
          <StatCard
            title="Quotes Saved"
            value={fmtNum(data.totalQuotes)}
            sub="calculations saved in period"
            icon={FileText}
            accent="text-orange-600"
          />
          <StatCard
            title="Logins"
            value={fmtNum(loginCount)}
            sub="user sign-ins in period"
            icon={LogIn}
          />
        </div>

        {/* Monthly Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly Activity</CardTitle>
            <CardDescription>Services updated, push operations, and quotes saved by month.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.monthly.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                No activity in this period.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.monthly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(val: number, name: string) => [
                      val.toLocaleString(),
                      name === "updated" ? "Services Updated" : name === "quotes" ? "Quotes Saved" : "Push Operations",
                    ]}
                  />
                  <Legend
                    formatter={(value) => value === "updated" ? "Services Updated" : value === "quotes" ? "Quotes Saved" : "Push Operations"}
                    wrapperStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="updated" name="updated" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="quotes" name="quotes" fill="#f97316" radius={[4, 4, 0, 0]} />
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
                      <th className="pb-3 font-medium text-right">Quotes Saved</th>
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
                        <td className="py-3 text-right tabular-nums text-orange-600 font-semibold">
                          {fmtNum(t.totalQuotes)}
                        </td>
                        <td className="py-3 text-right tabular-nums">
                          <span>{t.totalPushes}</span>
                          {t.failed > 0 && (
                            <span className="text-destructive ml-1 text-xs">({t.failed} failed)</span>
                          )}
                        </td>
                        <td className="py-3 text-right tabular-nums text-emerald-600 font-semibold">
                          {fmtNum(t.totalUpdated)}
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
                  <tfoot>
                    <tr className="border-t-2 border-b-2 border-border font-semibold">
                      <td className="pt-3">Total</td>
                      <td className="pt-3 text-right tabular-nums text-orange-600">{fmtNum(data.totalQuotes)}</td>
                      <td className="pt-3 text-right tabular-nums">{fmtNum(data.totalPushes)}</td>
                      <td className="pt-3 text-right tabular-nums text-emerald-600">{fmtNum(data.totalUpdated)}</td>
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

        {/* Recent Login Activity */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <LogIn size={16} />
              Recent Login Activity
            </CardTitle>
            <CardDescription>Last 30 sign-ins within the selected period.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentLogins.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No logins recorded in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-left">
                      <th className="pb-3 font-medium">User</th>
                      <th className="pb-3 font-medium">Email</th>
                      <th className="pb-3 font-medium">Role</th>
                      <th className="pb-3 font-medium text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recentLogins.map((login) => (
                      <tr key={login.id} className="hover:bg-muted/40 transition-colors" data-testid={`row-login-${login.id}`}>
                        <td className="py-2.5 font-medium">{login.name}</td>
                        <td className="py-2.5 text-muted-foreground">{login.email}</td>
                        <td className="py-2.5">
                          <Badge variant="outline" className="text-xs">
                            {ROLE_LABEL[login.role] ?? login.role}
                          </Badge>
                        </td>
                        <td className="py-2.5 text-right text-muted-foreground tabular-nums">
                          {format(new Date(login.createdAt), "MMM d, yyyy h:mm a")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>{/* /printRef */}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="animate-spin w-6 h-6 text-muted-foreground" />
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-full p-8 text-muted-foreground">
      {children}
    </div>
  );
}
