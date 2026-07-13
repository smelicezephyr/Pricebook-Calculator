import { useSettings } from "@/hooks/use-settings";
import { useTenants } from "@/hooks/use-tenants";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertSettingsSchema } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, ArrowLeft, Calculator } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "wouter";
import type { z } from "zod";

type SettingsFormValues = z.infer<typeof insertSettingsSchema>;

function computeLaborRateOutputs(values: SettingsFormValues) {
  const highestTechRate = parseFloat(values.highestTechRate || "0") || 0;
  const annualPaidHours = parseFloat(values.annualPaidHours || "2080") || 2080;
  const billableUtil = (parseFloat(values.billableUtilizationPercent || "65") || 65) / 100;
  const annualTruckCost = parseFloat(values.annualTruckFieldCost || "0") || 0;
  const overheadPct = (parseFloat(values.targetOverheadPercent || "35") || 35) / 100;
  const opProfitPct = (parseFloat(values.targetOperatingProfitPercent || "10") || 10) / 100;
  const roundingIncrement = parseFloat(values.laborRateRoundingIncrement || "5") || 5;
  const burdenPct = (parseFloat(values.laborBurdenPercent || "20") || 20) / 100;

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

  return {
    annualBillableHours,
    directCostPerBillableHour,
    recommendedLaborRate,
    impliedWageMultiplier,
  };
}

export default function Settings() {
  const { settings, isLoading, updateSettings, isUpdating } = useSettings();
  const { tenants } = useTenants();
  const [, setLocation] = useLocation();

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
      annualPaidHours: "2080",
      billableUtilizationPercent: "65.00",
      annualTruckFieldCost: "0.00",
      targetOverheadPercent: "35.00",
      targetOperatingProfitPercent: "10.00",
      laborRateRoundingIncrement: "5",
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
        annualPaidHours: settings.annualPaidHours,
        billableUtilizationPercent: settings.billableUtilizationPercent,
        annualTruckFieldCost: settings.annualTruckFieldCost,
        targetOverheadPercent: settings.targetOverheadPercent,
        targetOperatingProfitPercent: settings.targetOperatingProfitPercent,
        laborRateRoundingIncrement: settings.laborRateRoundingIncrement,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const watchedValues = form.watch();
  const liveOutputs = computeLaborRateOutputs(watchedValues);

  const onSubmit = (data: SettingsFormValues) => {
    updateSettings(data);
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
                          onValueChange={(v) => field.onChange(v === "none" ? null : parseInt(v, 10))}
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
                  
                  <FormField
                    control={form.control}
                    name="laborBurdenPercent"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Payroll Burden</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input {...field} type="number" step="0.01" className="pr-8" />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                          </div>
                        </FormControl>
                        <FormDescription>Employer taxes & benefits on top of wages.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="highestTechRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Highest Tech Pay Rate</FormLabel>
                        <FormControl>
                          <div className="relative">
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
                        </FormControl>
                        <FormDescription>Highest-paid technician's hourly wage — drives the labor rate formula below.</FormDescription>
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
                These inputs build a fully-loaded labor rate from the ground up. The Repair calculators use the Recommended Labor Rate as their default.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <FormField
                  control={form.control}
                  name="annualPaidHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Annual Paid Hours</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" step="1" min="0" data-testid="input-annual-paid-hours" />
                      </FormControl>
                      <FormDescription>Total hours the tech is paid per year (e.g. 2080 = 40 hrs × 52 wks).</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="billableUtilizationPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Billable Utilization</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} type="number" step="0.1" min="0" max="100" className="pr-8" data-testid="input-billable-utilization" />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                        </div>
                      </FormControl>
                      <FormDescription>Portion of paid hours that are actually billable to customers.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="annualTruckFieldCost"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Annual Truck / Field Cost</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">$</span>
                          <Input {...field} type="number" step="0.01" min="0" className="pl-8" data-testid="input-annual-truck-cost" />
                        </div>
                      </FormControl>
                      <FormDescription>Total annual cost to field the truck (fuel, insurance, maintenance, etc.).</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="targetOverheadPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Target Overhead</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} type="number" step="0.1" min="0" max="100" className="pr-8" data-testid="input-target-overhead" />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                        </div>
                      </FormControl>
                      <FormDescription>% of revenue allocated to cover company overhead.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="targetOperatingProfitPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Target Operating Profit</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} type="number" step="0.1" min="0" max="100" className="pr-8" data-testid="input-target-op-profit" />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                        </div>
                      </FormControl>
                      <FormDescription>% of revenue kept as operating profit.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="laborRateRoundingIncrement"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Rounding Increment ($)</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">$</span>
                          <Input {...field} type="number" step="1" min="1" className="pl-8" data-testid="input-rounding-increment" />
                        </div>
                      </FormControl>
                      <FormDescription>The recommended rate is rounded up to the nearest multiple of this value.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Live Output Panel */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Calculator size={16} className="text-primary" />
                  <span className="text-xs font-bold text-primary uppercase tracking-wider">Live Calculation Results</span>
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
                
                <FormField
                  control={form.control}
                  name="commissionBurdenPercent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Commission Burden</FormLabel>
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
