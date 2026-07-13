import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTenants } from "@/hooks/use-tenants";
import { useSettings } from "@/hooks/use-settings";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2 } from "lucide-react";
import type { Tenant, Location } from "@shared/schema";

const LAST_TENANT_KEY = "pbc_last_active_tenant_id";

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
  // Track which tenant we've already fetched the rate for — prevents re-fetching on
  // every settings invalidation and avoids an infinite update loop.
  const rateFetchedForTenantRef = useRef<number | null>(null);

  const applyTenantTax = (tenant: Tenant | undefined) => {
    if (!tenant) return;
    const loc = locations.find((l) => l.id === tenant.locationId);
    if (loc) onTaxChange(loc.salesTaxPercent.toString());
  };

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

  // Auto-fetch highest tech rate from ServiceTitan whenever the tenant changes.
  // Silently persists the result so all calculator pages always reflect the
  // latest rate without requiring the user to visit Settings.
  useEffect(() => {
    if (!selectedTenantId || !settings) return;
    // Only fetch once per tenant selection — don't re-run on settings invalidation
    if (rateFetchedForTenantRef.current === selectedTenantId) return;
    rateFetchedForTenantRef.current = selectedTenantId;

    const { id: _id, ...settingsForUpdate } = settings as any;
    apiRequest("GET", `/api/servicetitan/${selectedTenantId}/highest-tech-rate`)
      .then((res) => res.json())
      .then((data: { rate: number }) => {
        if (typeof data.rate === "number" && data.rate > 0) {
          return apiRequest("PUT", "/api/settings", {
            ...settingsForUpdate,
            highestTechRate: String(data.rate),
          });
        }
      })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      })
      .catch(() => {}); // Silent fail — never blocks the calculator UI
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId, settings]);

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
