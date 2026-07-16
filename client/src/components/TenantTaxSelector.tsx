import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTenants } from "@/hooks/use-tenants";
import { useSettings } from "@/hooks/use-settings";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2 } from "lucide-react";
import { ZEPHYR_STANDARDS } from "@shared/schema";
import type { Tenant, Location, Settings } from "@shared/schema";

const LAST_TENANT_KEY = "pbc_last_active_tenant_id";

/** Mirrors the formula in Settings.tsx — computes the recommended billing labor rate
 *  from the highest tech pay rate and the user's overhead / profit targets. */
function computeRecommendedLaborRate(techRate: number, s: Settings): number {
  const burdenPct = parseFloat(s.laborBurdenPercent) / 100 || 0;
  const overheadPct = ZEPHYR_STANDARDS.TARGET_OVERHEAD_PCT / 100;
  const opProfitPct = ZEPHYR_STANDARDS.TARGET_OPERATING_PROFIT_PCT / 100;
  const billableUtil = ZEPHYR_STANDARDS.BILLABLE_UTILIZATION_PCT / 100;
  const annualPaidHours = ZEPHYR_STANDARDS.ANNUAL_PAID_HOURS;
  const annualBillableHours = annualPaidHours * billableUtil;
  const truckCost = ZEPHYR_STANDARDS.ANNUAL_TRUCK_FIELD_COST;
  const rounding = ZEPHYR_STANDARDS.ROUNDING_INCREMENT;

  const burdenedWage = techRate * (1 + burdenPct);
  const laborCostPerBillHr = billableUtil > 0 ? burdenedWage / billableUtil : 0;
  const truckCostPerBillHr = annualBillableHours > 0 ? truckCost / annualBillableHours : 0;
  const directCost = laborCostPerBillHr + truckCostPerBillHr;
  const recoveryMargin = 1 - overheadPct - opProfitPct;
  const raw = recoveryMargin > 0 ? directCost / recoveryMargin : 0;
  return rounding > 0 ? Math.ceil(raw / rounding) * rounding : raw;
}

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function guessTenantByEmail(tenants: Tenant[], email?: string | null): Tenant | undefined {
  if (!email || tenants.length === 0) return undefined;
  const domain = email.split("@")[1] || "";
  const domainPart = normalize(domain.split(".")[0] || "");
  if (!domainPart) return undefined;

  let best: Tenant | undefined;
  let bestScore = 0;
  for (const t of tenants) {
    const tenantName = normalize(t.name || "");
    if (!tenantName) continue;
    let score = 0;
    if (tenantName === domainPart) score = 100;
    else if (tenantName.includes(domainPart) || domainPart.includes(tenantName)) {
      score = Math.min(tenantName.length, domainPart.length);
    }
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

interface TenantTaxSelectorProps {
  selectedTenantId: number | null;
  onTenantChange: (id: number | null) => void;
  onTaxChange: (tax: string) => void;
  testIdSuffix?: string;
  variant?: "stacked" | "bar";
}

export function TenantTaxSelector({
  selectedTenantId,
  onTenantChange,
  onTaxChange,
  testIdSuffix = "",
  variant = "stacked",
}: TenantTaxSelectorProps) {
  const { tenants } = useTenants();
  const { user } = useAuth();
  const { settings } = useSettings();
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const queryClient = useQueryClient();
  const autoAppliedRef = useRef(false);

  // React Query caches the rate per tenant — switching back to a previously-seen
  // tenant is instant (no network round-trip). staleTime matches the server-side
  // cache TTL so we don't over-fetch.
  const { data: rateData } = useQuery<{ rate: number; technicianName?: string; technicianCount?: number }>({
    queryKey: ["/api/servicetitan", selectedTenantId, "highest-tech-rate"],
    enabled: !!selectedTenantId,
    staleTime: 60 * 60 * 1000,  // 1 hour — matches server cache TTL
    gcTime: 2 * 60 * 60 * 1000,
    retry: false,
  });

  const applyTenantTax = (tenant: Tenant | undefined) => {
    if (!tenant) return;
    const loc = locations.find((l) => l.id === tenant.locationId);
    if (loc) onTaxChange(loc.salesTaxPercent.toString());
  };

  // Auto-select the best tenant when the page first loads (selectedTenantId is null).
  useEffect(() => {
    if (autoAppliedRef.current || selectedTenantId != null || tenants.length === 0) return;
    if (settings === undefined) return; // wait for settings to load before guessing
    autoAppliedRef.current = true;

    const savedDefault = settings.defaultTenantId != null
      ? tenants.find((t) => t.id === settings.defaultTenantId)
      : undefined;

    const match =
      savedDefault ||
      (tenants.length === 1
        ? tenants[0]
        : guessTenantByEmail(tenants, user?.email) ||
          [...tenants].sort((a, b) => a.name.localeCompare(b.name))[0]);
    if (match) {
      onTenantChange(match.id);
      applyTenantTax(match);
      localStorage.setItem(LAST_TENANT_KEY, String(match.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenants, locations, user?.email, selectedTenantId, settings]);

  // Always keep the tax rate in sync with the selected tenant.
  // This covers the race condition where locations hadn't finished loading
  // when the auto-select fired (autoAppliedRef would already be true by then,
  // so the auto-select effect can't retry). Also covers any future case where
  // selectedTenantId is set externally by the parent.
  useEffect(() => {
    if (!selectedTenantId || locations.length === 0 || tenants.length === 0) return;
    const tenant = tenants.find((t) => t.id === selectedTenantId);
    applyTenantTax(tenant);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId, locations]);

  // When the rate arrives (from React Query cache instantly, or network on first
  // fetch), persist it to settings so all calculator pages reflect the new value.
  // The equality guard prevents an infinite PUT loop when settings already match.
  useEffect(() => {
    if (!rateData || !settings || !selectedTenantId) return;
    const rate = rateData.rate;
    if (typeof rate !== "number" || rate <= 0) return;
    if (parseFloat(settings.highestTechRate || "0") === rate) return; // already up-to-date

    const { id: _id, ...settingsForUpdate } = settings as any;
    const recommendedRate = computeRecommendedLaborRate(rate, settings!);
    const updates: Record<string, string> = { highestTechRate: String(rate) };
    if (recommendedRate > 0) updates.laborHourlyRate = String(recommendedRate);

    apiRequest("PUT", "/api/settings", { ...settingsForUpdate, ...updates })
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/settings"] }))
      .catch(() => {}); // Silent fail — never blocks the calculator UI
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateData, selectedTenantId]);

  if (tenants.length === 0) return null;

  const handleChange = (value: string) => {
    const id = parseInt(value, 10);
    onTenantChange(id);
    applyTenantTax(tenants.find((t) => t.id === id));
    localStorage.setItem(LAST_TENANT_KEY, value);
  };

  const select = (
    <Select
      value={selectedTenantId != null ? selectedTenantId.toString() : undefined}
      onValueChange={handleChange}
    >
      <SelectTrigger
        className={
          variant === "bar"
            ? "h-9 w-full sm:w-64 text-sm font-bold bg-primary/10 border-2 border-primary text-primary shadow-sm hover:bg-primary/15 focus:ring-primary/40"
            : "h-9 text-sm font-bold bg-primary/10 border-2 border-primary text-primary shadow-sm hover:bg-primary/15 focus:ring-primary/40"
        }
        data-testid={`select-tenant${testIdSuffix}`}
      >
        <SelectValue placeholder="Select tenant" />
      </SelectTrigger>
      <SelectContent>
        {tenants.map((t) => (
          <SelectItem key={t.id} value={t.id.toString()} data-testid={`option-tenant-${t.id}`}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (variant === "bar") {
    return (
      <div className="flex items-center gap-3 bg-card border-4 border-black rounded-lg px-4 py-2.5 shadow-sm">
        <Label className="text-xs font-bold text-primary uppercase tracking-wide flex items-center gap-1.5 shrink-0">
          <Building2 className="w-3.5 h-3.5" /> Tenant Selection
        </Label>
        {select}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
        <Building2 className="w-3 h-3" /> Tenant Selection
      </Label>
      {select}
    </div>
  );
}
