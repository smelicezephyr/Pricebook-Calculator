import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTenants } from "@/hooks/use-tenants";
import { useAuth } from "@/contexts/AuthContext";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2 } from "lucide-react";
import type { Tenant, Location } from "@shared/schema";

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
}

export function TenantTaxSelector({
  selectedTenantId,
  onTenantChange,
  onTaxChange,
  testIdSuffix = "",
}: TenantTaxSelectorProps) {
  const { tenants } = useTenants();
  const { user } = useAuth();
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const autoAppliedRef = useRef(false);

  const applyTenantTax = (tenant: Tenant | undefined) => {
    if (!tenant) return;
    const loc = locations.find((l) => l.id === tenant.locationId);
    if (loc) onTaxChange(loc.salesTaxPercent.toString());
  };

  useEffect(() => {
    if (autoAppliedRef.current || selectedTenantId != null || tenants.length === 0) return;
    autoAppliedRef.current = true;

    const match = tenants.length === 1 ? tenants[0] : guessTenantByEmail(tenants, user?.email);
    if (match) {
      onTenantChange(match.id);
      applyTenantTax(match);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenants, locations, user?.email, selectedTenantId]);

  if (tenants.length === 0) return null;

  const handleChange = (value: string) => {
    const id = parseInt(value, 10);
    onTenantChange(id);
    applyTenantTax(tenants.find((t) => t.id === id));
  };

  return (
    <div className="space-y-1">
      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
        <Building2 className="w-3 h-3" /> Tenant
      </Label>
      <Select
        value={selectedTenantId != null ? selectedTenantId.toString() : undefined}
        onValueChange={handleChange}
      >
        <SelectTrigger className="h-9 text-sm font-medium bg-background border-border shadow-sm" data-testid={`select-tenant${testIdSuffix}`}>
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
    </div>
  );
}
