import { useSettings } from "@/hooks/use-settings";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertSettingsSchema } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Save, ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "wouter";
import type { z } from "zod";

type SettingsFormValues = z.infer<typeof insertSettingsSchema>;

export default function Settings() {
  const { settings, isLoading, updateSettings, isUpdating } = useSettings();
  const [, setLocation] = useLocation();

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(insertSettingsSchema),
    defaultValues: {
      targetMePercent: "23.00",
      salesTaxPercent: "6.35",
      laborMode: "percent",
      laborHourlyRate: "0.00",
      laborPercent: "7.00",
      laborBurdenPercent: "20.00",
      commissionPercent: "10.00",
      commissionBurdenPercent: "20.00",
      financingFeePercent: "6.00",
      grossMarginMinPercent: "52.00",
    },
  });

  // Reset form when settings load
  useEffect(() => {
    if (settings) {
      form.reset({
        targetMePercent: settings.targetMePercent,
        salesTaxPercent: settings.salesTaxPercent,
        laborMode: settings.laborMode,
        laborHourlyRate: settings.laborHourlyRate,
        laborPercent: settings.laborPercent,
        laborBurdenPercent: settings.laborBurdenPercent,
        commissionPercent: settings.commissionPercent,
        commissionBurdenPercent: settings.commissionBurdenPercent,
        financingFeePercent: settings.financingFeePercent,
        grossMarginMinPercent: settings.grossMarginMinPercent,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const onSubmit = (data: SettingsFormValues) => {
    updateSettings(data);
  };

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
                              Hourly Rate
                              <span className="block text-xs text-muted-foreground mt-1">Based on input hours × hourly rate</span>
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
                        <FormLabel>Hourly Rate ($)</FormLabel>
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
                        <FormLabel>Labor Burden</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input {...field} type="number" step="0.01" className="pr-8" />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                          </div>
                        </FormControl>
                        <FormDescription>Added overhead on top of labor cost.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </div>

            {/* Fees & Commissions */}
            <div className="p-6">
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
