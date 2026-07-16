import { useSettings } from "@/hooks/use-settings";
import { useTenants } from "@/hooks/use-tenants";
import { useAuth } from "@/contexts/AuthContext";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertSettingsSchema, ZEPHYR_STANDARDS } from "@shared/schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Location } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, ArrowLeft, Lock, Calculator, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { z } from "zod";

type SettingsFormValues = z.infer<typeof insertSettingsSchema>;

function safeNum(raw: string | null | undefined, fallback: number): number {
  const n = parseFloat(raw ?? "");
  return Number.isNaN(n) ? fallback : n;
}

function computeLaborRateOutputs(values: SettingsFormValues) {
  const highestTechRate = safeNum(values.highestTechRate, 0);
  const annualPaidHours = ZEPHYR_STANDARDS.ANNUAL_PAID_HOURS;
  const billableUtil = ZEPHYR_STANDARDS.BILLABLE_UTILIZATION_PCT / 100;
  const annualTruckCost = ZEPHYR_STANDARDS.ANNUAL_TRUCK_FIELD_COST;
  const overheadPct = safeNum(values.targetOverheadPercent, 35) / 100;
  const opProfitPct = safeNum(values.targetOperatingProfitPercent, 14) / 100;
  const roundingIncrement = ZEPHYR_STANDARDS.ROUNDING_INCREMENT;
  const burdenPct = safeNum(values.laborBurdenPercent, 20) / 100;

  const annualBillableHours = annualPaidHours * billableUtil;
  const burdenedHourlyWage = highestTechRate * (1 + burdenPct);
  const laborCostPerBillableHour = billableUtil > 0 ? burdenedHourlyWage / billableUtil : 0;
  const truckCostPerBillableHour = annualBillableHours > 0 ? annualTruckCost / annualBillableHours : 0;
  const directCostPerBillableHour = laborCostPerBillableHour + truckCostPerBillableHour;
  const recoveryMargin = 1 - overheadPct - opProfitPct;
  const rawLaborRate = recoveryMargin > 0 ? directCostPerBillableHour / recoveryMargin : 0;
  const recommendedLaborRate = roundingIncrement > 0
    ? Math.ceil(rawLaborRate / roundingIncrement) * roundingIncrement
    : rawLaborRate;
  const impliedWageMultiplier = highestTechRate > 0 ? recommendedLaborRate / highestTechRate : 0;

  return { annualBillableHours, directCostPerBillableHour, recommendedLaborRate, impliedWageMultiplier };
}

// Constant strings so the form always submits the Zephyr standard values
const ZEPHYR_FORM_DEFAULTS = {
  annualPaidHours: String(ZEPHYR_STANDARDS.ANNUAL_PAID_HOURS),
  billableUtilizationPercent: String(ZEPHYR_STANDARDS.BILLABLE_UTILIZATION_PCT),
  annualTruckFieldCost: String(ZEPHYR_STANDARDS.ANNUAL_TRUCK_FIELD_COST),
  laborRateRoundingIncrement: String(ZEPHYR_STANDARDS.ROUNDING_INCREMENT),
  targetOverheadPercent: String(ZEPHYR_STANDARDS.TARGET_OVERHEAD_PCT),
  laborBurdenPercent: String(ZEPHYR_STANDARDS.LABOR_BURDEN_PCT),
  commissionBurdenPercent: String(ZEPHYR_STANDARDS.LABOR_BURDEN_PCT),
  targetOperatingProfitPercent: String(ZEPHYR_STANDARDS.TARGET_OPERATING_PROFIT_PCT),
};

export default function Settings() {
  const { settings, isLoading, updateSettings, isUpdating, silentUpdateSettings } = useSettings();
  const { tenants } = useTenants();
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [isFetchingRate, setIsFetchingRate] = useState(false);

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(insertSettingsSchema),
    defaultValues: {
      targetMePercent: "23.00",
      salesTaxPercent: "6.35",
      defaultTenantId: null,
      laborMode: "percent",
      laborHourlyRate: "0.00",
      laborPercent: "7.00",
      laborBurdenPercent: "20.00",
      highestTechRate: "0.00",
      commissionPercent: "10.00",
      commissionBurdenPercent: "20.00",
      financingFeePercent: "6.00",
      grossMarginMinPercent: "52.00",
      targetOverheadPercent: "35.00",
      targetOperatingProfitPercent: "14.00",
      ...ZEPHYR_FORM_DEFAULTS,
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        targetMePercent: settings.targetMePercent,
        salesTaxPercent: settings.salesTaxPercent,
        defaultTenantId: settings.defaultTenantId ?? null,
        laborMode: settings.laborMode,
        laborHourlyRate: settings.laborHourlyRate,
        laborPercent: settings.laborPercent,
        laborBurdenPercent: settings.laborBurdenPercent,
        highestTechRate: settings.highestTechRate,
        commissionPercent: settings.commissionPercent,
        commissionBurdenPercent: settings.commissionBurdenPercent,
        financingFeePercent: settings.financingFeePercent,
        grossMarginMinPercent: settings.grossMarginMinPercent,
        targetOverheadPercent: settings.targetOverheadPercent,
        targetOperatingProfitPercent: settings.targetOperatingProfitPercent,
        // Always override locked fields with Zephyr constants
        ...ZEPHYR_FORM_DEFAULTS,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const watchedValues = form.watch();
  const liveOutputs = computeLaborRateOutputs(watchedValues);

  // When switching to hourly mode, auto-fill the rate field with the recommended labor rate
  const laborMode = form.watch("laborMode");
  useEffect(() => {
    if (laborMode === "hours" && liveOutputs.recommendedLaborRate > 0) {
      form.setValue("laborHourlyRate", String(liveOutputs.recommendedLaborRate), { shouldDirty: true });
    }
  // Only fire when laborMode changes direction — not on every liveOutputs recalc
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laborMode]);

  // Pick the best available tenant ID: form default → first tenant
  function getActiveTenantId(): number | null {
    const defaultId = form.getValues("defaultTenantId");
    if (defaultId != null && tenants.some((t) => t.id === defaultId)) return defaultId;
    return tenants[0]?.id ?? null;
  }

  async function handleFetchRate() {
    const tenantId = getActiveTenantId();
    if (!tenantId) return;
    setIsFetchingRate(true);
    try {
      const res = await apiRequest("GET", `/api/servicetitan/${tenantId}/highest-tech-rate`);
      const data = await res.json() as { rate: number; technicianName: string; technicianCount: number };
      if (typeof data.rate !== "number" || data.rate <= 0) {
        throw new Error("ServiceTitan returned an unexpected pay rate value. Please enter the rate manually.");
      }
      form.setValue("highestTechRate", String(data.rate), { shouldDirty: true, shouldValidate: true });
      toast({
        title: "Rate fetched",
        description: `$${data.rate}/hr — ${data.technicianName} (${data.technicianCount} tech${data.technicianCount !== 1 ? "s" : ""} scanned)`,
      });
    } catch (err: any) {
      toast({
        title: "Could not fetch rate",
        description: err.message ?? "An error occurred while contacting ServiceTitan.",
        variant: "destructive",
      });
    } finally {
      setIsFetchingRate(false);
    }
  }

  // Auto-fetch whenever the page loads and a tenant is available — silently pre-fills the field
  // and persists the new rate to the database so calculators always reflect the latest value
  useEffect(() => {
    if (!settings || !tenants.length) return;
    const tenantId = settings.defaultTenantId ?? tenants[0]?.id;
    if (!tenantId) return;
    apiRequest("GET", `/api/servicetitan/${tenantId}/highest-tech-rate`)
      .then((res) => res.json())
      .then((data: { rate: number }) => {
        if (typeof data.rate === "number" && data.rate > 0) {
          form.setValue("highestTechRate", String(data.rate), { shouldDirty: true, shouldValidate: true });
          // Silently persist so calculator pages always load the latest rate
          const currentValues = form.getValues();
          silentUpdateSettings({ ...currentValues, ...ZEPHYR_FORM_DEFAULTS, highestTechRate: String(data.rate) });
        }
      })
      .catch(() => {}); // Silent fail — user can still type manually
  // Re-run if the user changes their default tenant; don't re-run on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.defaultTenantId, tenants.length]);

  const onSubmit = (data: SettingsFormValues) => {
    // Ensure Zephyr constants are always submitted, regardless of any form state
    updateSettings({ ...data, ...ZEPHYR_FORM_DEFAULTS });
  };

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground mt-1">Configure your default rates and calculation logic.</p>
        </div>
        <Button 
          variant="ghost" 
          onClick={() => setLocation("/")}
          className="md:self-start gap-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={16} />
          Back to Calculator
        </Button>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            
            {/* General Settings */}
            <div className="p-6 border-b border-border">
              <h2 className="text-lg font-semibold mb-4 text-primary">General Configuration</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="targetMePercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Target M&E Percent</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} type="number" step="0.01" className="pr-8" />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                        </div>
                      </FormControl>
                      <FormDescription>Determines the final price markup.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="salesTaxPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sales Tax Rate</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} type="number" step="0.01" className="pr-8" />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="defaultTenantId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default Tenant</FormLabel>
                      <FormControl>
                        <Select
                          value={field.value != null ? field.value.toString() : "none"}
                          onValueChange={(v) => {
                            const id = v === "none" ? null : parseInt(v, 10);
                            field.onChange(id);
                            if (id == null) return;

                            // Sync tax rate from the tenant's linked location
                            const tenant = tenants.find((t) => t.id === id);
                            const loc = tenant?.locationId != null
                              ? locations.find((l) => l.id === tenant.locationId)
                              : undefined;
                            if (loc) {
                              form.setValue("salesTaxPercent", loc.salesTaxPercent.toString(), { shouldDirty: true });
                            }

                            // Immediately fetch the highest tech rate for the selected tenant.
                            // queryClient.fetchQuery reuses any cached result (from TenantTaxSelector
                            // on a calculator page) so it's instant when the data is already warm.
                            queryClient.fetchQuery<{ rate: number }>({
                              queryKey: ["/api/servicetitan", id, "highest-tech-rate"],
                              queryFn: () =>
                                apiRequest("GET", `/api/servicetitan/${id}/highest-tech-rate`).then((r) => r.json()),
                              staleTime: 60 * 60 * 1000,
                            }).then((data) => {
                              if (typeof data.rate === "number" && data.rate > 0) {
                                form.setValue("highestTechRate", String(data.rate), { shouldDirty: true, shouldValidate: true });
                              }
                            }).catch(() => {});
                          }}
                        >
                          <SelectTrigger data-testid="select-default-tenant">
                            <SelectValue placeholder="Auto-detect" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Auto-detect (email domain match)</SelectItem>
                            {tenants.map((t) => (
                              <SelectItem key={t.id} value={t.id.toString()} data-testid={`option-default-tenant-${t.id}`}>
                                {t.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormDescription>The tenant pre-selected on each calculator page.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="grossMarginMinPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Gross Margin Minimum</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} type="number" step="0.01" className="pr-8" data-testid="input-gross-margin-min" />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                        </div>
                      </FormControl>
                      <FormDescription>Target minimum for margin health indicator.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Labor Settings */}
            <div className="p-6 border-b border-border bg-muted/30">
              <h2 className="text-lg font-semibold mb-4 text-primary">Labor Calculations</h2>
              <div className="space-y-6">
                <FormField
                  control={form.control}
                  name="laborMode"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel>Calculation Mode</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          value={field.value}
                          className="flex flex-col sm:flex-row gap-4"
                        >
                          <FormItem className="flex items-center space-x-3 space-y-0 bg-background p-4 rounded-lg border border-border shadow-sm flex-1">
                            <FormControl>
                              <RadioGroupItem value="percent" />
                            </FormControl>
                            <FormLabel className="font-normal cursor-pointer flex-1">
                              Percentage of Job
                              <span className="block text-xs text-muted-foreground mt-1">Fixed percentage of total price</span>
                            </FormLabel>
                          </FormItem>
                          <FormItem className="flex items-center space-x-3 space-y-0 bg-background p-4 rounded-lg border border-border shadow-sm flex-1">
                            <FormControl>
                              <RadioGroupItem value="hours" />
                            </FormControl>
                            <FormLabel className="font-normal cursor-pointer flex-1">
                              Hourly Rate (per technician)
                              <span className="block text-xs text-muted-foreground mt-1">Based on hours × rate per technician × # of techs</span>
                            </FormLabel>
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <FormField
                    control={form.control}
                    name="laborHourlyRate"
                    render={({ field }) => (
                      <FormItem className={form.watch("laborMode") !== "hours" ? "hidden" : ""}>
                        <FormLabel>Hourly Rate per Technician ($)</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">$</span>
                            <Input 
                              type="number"
                              step="0.01"
                              min="0"
                              className="pl-8"
                              data-testid="input-labor-hourly-rate"
                              {...field}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="laborPercent"
                    render={({ field }) => (
                      <FormItem className={form.watch("laborMode") !== "percent" ? "hidden" : ""}>
                        <FormLabel>Labor Percent</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input 
                              type="number"
                              step="0.01"
                              min="0"
                              className="pr-8"
                              data-testid="input-labor-percent"
                              {...field}
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">%</span>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <div className="space-y-1">
                    <label className="text-sm font-medium leading-none">Payroll Burden</label>
                    <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-border bg-muted/50">
                      <span className="text-sm font-mono font-semibold">{ZEPHYR_STANDARDS.LABOR_BURDEN_PCT}%</span>
                      <span className="text-xs text-muted-foreground">— Zephyr standard (locked)</span>
                    </div>
                    <p className="text-[0.8rem] text-muted-foreground">Employer taxes &amp; benefits on top of wages.</p>
                  </div>

                  <FormField
                    control={form.control}
                    name="highestTechRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Highest Tech Pay Rate</FormLabel>
                        <FormControl>
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">$</span>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                className="pl-8"
                                data-testid="input-highest-tech-rate-setting"
                                {...field}
                              />
                            </div>
                            {tenants.length > 0 && (
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="shrink-0"
                                title="Refresh rate from ServiceTitan"
                                data-testid="button-fetch-tech-rate"
                                disabled={isFetchingRate}
                                onClick={handleFetchRate}
                              >
                                {isFetchingRate ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                              </Button>
                            )}
                          </div>
                        </FormControl>
                        <FormDescription>Highest-paid technician's hourly wage — drives the recommended labor rate below.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </div>

            {/* Labor Rate Standards */}
            <div className="p-6 border-b border-border">
              <h2 className="text-lg font-semibold mb-1 text-primary">Labor Rate Standards</h2>
              <p className="text-sm text-muted-foreground mb-5">
                Inputs below are used to build a fully-loaded technician labor rate from the ground up. The Repair calculators use the Recommended Labor Rate as their default.
              </p>

              {/* Zephyr Standard locked fields */}
              <div className="rounded-xl border border-border bg-muted/40 p-4 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <Lock size={14} className="text-muted-foreground" />
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Zephyr Standards</span>
                  <span className="ml-auto text-xs text-muted-foreground">Centrally-controlled operating assumptions — not editable</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {/* Annual Paid Hours */}
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                      Annual Paid Hours
                    </p>
                    <div className="flex items-center gap-1.5 bg-background border border-border rounded-md px-3 py-2 text-sm font-medium text-muted-foreground" data-testid="locked-annual-paid-hours">
                      <Lock size={11} className="text-muted-foreground/60 shrink-0" />
                      {ZEPHYR_STANDARDS.ANNUAL_PAID_HOURS.toLocaleString()} hrs
                    </div>
                    <p className="text-[10px] text-muted-foreground">40 hrs/wk × 52 wks</p>
                  </div>
                  {/* Billable Utilization */}
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Billable Utilization
                    </p>
                    <div className="flex items-center gap-1.5 bg-background border border-border rounded-md px-3 py-2 text-sm font-medium text-muted-foreground" data-testid="locked-billable-utilization">
                      <Lock size={11} className="text-muted-foreground/60 shrink-0" />
                      {ZEPHYR_STANDARDS.BILLABLE_UTILIZATION_PCT}%
                    </div>
                    <p className="text-[10px] text-muted-foreground">Billable portion of paid hours</p>
                  </div>
                  {/* Annual Truck / Field Cost */}
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Annual Truck / Field Cost
                    </p>
                    <div className="flex items-center gap-1.5 bg-background border border-border rounded-md px-3 py-2 text-sm font-medium text-muted-foreground" data-testid="locked-truck-cost">
                      <Lock size={11} className="text-muted-foreground/60 shrink-0" />
                      ${ZEPHYR_STANDARDS.ANNUAL_TRUCK_FIELD_COST.toLocaleString()}
                    </div>
                    <p className="text-[10px] text-muted-foreground">Fuel, insurance, maintenance</p>
                  </div>
                  {/* Rounding Increment */}
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Rounding Increment
                    </p>
                    <div className="flex items-center gap-1.5 bg-background border border-border rounded-md px-3 py-2 text-sm font-medium text-muted-foreground" data-testid="locked-rounding-increment">
                      <Lock size={11} className="text-muted-foreground/60 shrink-0" />
                      ${ZEPHYR_STANDARDS.ROUNDING_INCREMENT}
                    </div>
                    <p className="text-[10px] text-muted-foreground">Rate rounded up to nearest $5</p>
                  </div>
                </div>
              </div>

              {/* Leadership Targets — fixed Zephyr standard constants, locked for all roles */}
              <div className="rounded-xl border border-border bg-muted/40 p-4 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <Lock size={14} className="text-muted-foreground" />
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Leadership Targets
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    Zephyr standard constants — not editable
                  </span>
                </div>

                {/* Always locked — these are Zephyr standard constants */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Target Overhead</p>
                    <div className="flex items-center gap-1.5 bg-background border border-border rounded-md px-3 py-2 text-sm font-medium text-muted-foreground" data-testid="locked-target-overhead">
                      <Lock size={11} className="text-muted-foreground/60 shrink-0" />
                      {ZEPHYR_STANDARDS.TARGET_OVERHEAD_PCT}%
                    </div>
                    <p className="text-[10px] text-muted-foreground">% of revenue for company overhead</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Target Operating Profit</p>
                    <div className="flex items-center gap-1.5 bg-background border border-border rounded-md px-3 py-2 text-sm font-medium text-muted-foreground" data-testid="locked-target-op-profit">
                      <Lock size={11} className="text-muted-foreground/60 shrink-0" />
                      {ZEPHYR_STANDARDS.TARGET_OPERATING_PROFIT_PCT}%
                    </div>
                    <p className="text-[10px] text-muted-foreground">Target operating profit after costs and overhead</p>
                  </div>
                </div>
              </div>

              {/* Live Output Panel */}
              <div className="rounded-xl border border-border bg-muted/20 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Calculator size={15} className="text-foreground" />
                  <span className="text-xs font-bold text-foreground uppercase tracking-wider">Live Calculation Results</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">Annual Billable Hours</p>
                    <p className="text-lg font-bold text-foreground" data-testid="output-annual-billable-hours">
                      {liveOutputs.annualBillableHours > 0 ? liveOutputs.annualBillableHours.toFixed(0) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">Direct Cost / Billable Hr</p>
                    <p className="text-lg font-bold text-foreground" data-testid="output-direct-cost-per-hr">
                      {liveOutputs.directCostPerBillableHour > 0 ? formatCurrency(liveOutputs.directCostPerBillableHour) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-0.5">Recommended Labor Rate</p>
                    <p className="text-2xl font-bold text-primary" data-testid="output-recommended-labor-rate">
                      {liveOutputs.recommendedLaborRate > 0 ? formatCurrency(liveOutputs.recommendedLaborRate) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">Implied Wage Multiplier</p>
                    <p className="text-lg font-bold text-foreground" data-testid="output-wage-multiplier">
                      {liveOutputs.impliedWageMultiplier > 0 ? `${liveOutputs.impliedWageMultiplier.toFixed(2)}×` : "—"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Fees & Commissions */}
            <div className="p-6 border-b border-border bg-muted/30">
              <h2 className="text-lg font-semibold mb-4 text-primary">Fees & Commissions</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FormField
                  control={form.control}
                  name="commissionPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Commission Rate</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} type="number" step="0.01" className="pr-8" />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <div className="space-y-1">
                  <label className="text-sm font-medium leading-none">Commission Burden</label>
                  <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-border bg-muted/50">
                    <span className="text-sm font-mono font-semibold">{ZEPHYR_STANDARDS.LABOR_BURDEN_PCT}%</span>
                    <span className="text-xs text-muted-foreground">— Zephyr standard (locked)</span>
                  </div>
                </div>
                
                <FormField
                  control={form.control}
                  name="financingFeePercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Financing Fee</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} type="number" step="0.01" className="pr-8" />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Action Bar */}
            <div className="p-6 bg-muted/50 border-t border-border flex justify-end gap-4">
               <Button type="button" variant="outline" onClick={() => form.reset()}>
                 Discard Changes
               </Button>
               <Button type="submit" disabled={isUpdating} className="min-w-[140px]">
                 {isUpdating ? (
                   <>
                     <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                     Saving...
                   </>
                 ) : (
                   <>
                     <Save className="mr-2 h-4 w-4" />
                     Save Settings
                   </>
                 )}
               </Button>
            </div>
            
          </form>
        </Form>
      </div>

    </div>
  );
}
