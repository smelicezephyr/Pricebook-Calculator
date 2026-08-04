import { useState, useEffect, useRef } from "react";
import { useSettings } from "@/hooks/use-settings";
import { useAuth } from "@/contexts/AuthContext";
import { useCreateQuote } from "@/hooks/use-quotes";
import { InputMoney } from "@/components/InputMoney";
import { ResultsCard } from "@/components/ResultsCard";
import { RevealPriceGate } from "@/components/RevealPriceGate";
import { TenantTaxSelector } from "@/components/TenantTaxSelector";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RefreshCw, Target, Loader2, Save, Moon } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toPng } from "html-to-image";
import { useToast } from "@/hooks/use-toast";
import { useTenants } from "@/hooks/use-tenants";
import type { Settings } from "@shared/schema";
import { ZEPHYR_STANDARDS } from "@shared/schema";

function safeNum(raw: string | null | undefined, fallback: number): number {
  const n = parseFloat(raw ?? "");
  return Number.isNaN(n) ? fallback : n;
}

function computeRecommendedLaborRate(s: Settings): number {
  const highestTechRate = safeNum(s.highestTechRate, 0);
  if (highestTechRate <= 0) return 0;
  const annualPaidHours = ZEPHYR_STANDARDS.ANNUAL_PAID_HOURS;
  const billableUtil = ZEPHYR_STANDARDS.BILLABLE_UTILIZATION_PCT / 100;
  const annualTruckCost = ZEPHYR_STANDARDS.ANNUAL_TRUCK_FIELD_COST;
  const roundingIncrement = ZEPHYR_STANDARDS.ROUNDING_INCREMENT;
  const overheadPct = safeNum(s.targetOverheadPercent, 35) / 100;
  const opProfitPct = safeNum(s.targetOperatingProfitPercent, 14) / 100;
  const burdenPct = safeNum(s.laborBurdenPercent, 20) / 100;

  const annualBillableHours = annualPaidHours * billableUtil;
  const burdenedHourlyWage = highestTechRate * (1 + burdenPct);
  const laborCostPerBillableHour = burdenedHourlyWage / billableUtil;
  const truckCostPerBillableHour = annualBillableHours > 0 ? annualTruckCost / annualBillableHours : 0;
  const directCostPerBillableHour = laborCostPerBillableHour + truckCostPerBillableHour;
  const recoveryMargin = 1 - overheadPct - opProfitPct;
  if (recoveryMargin <= 0) return 0;
  const rawLaborRate = directCostPerBillableHour / recoveryMargin;
  return Math.ceil(rawLaborRate / roundingIncrement) * roundingIncrement;
}

export default function RepairGMCalculator() {
  const { settings, isLoading: settingsLoading } = useSettings();
  const { toast } = useToast();
  const { isPriceGated, isReporting } = useAuth();
  const createQuote = useCreateQuote();
  const { tenants: tenantList } = useTenants();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [quoteTitle, setQuoteTitle] = useState("");
  const [afterHours, setAfterHours] = useState(false);

  const [partsCost, setPartsCost] = useState("");
  const [salesTaxPercent, setSalesTaxPercent] = useState("6.35");
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [laborMode, setLaborMode] = useState<"dollars" | "percent">("dollars");
  const [laborRate, setLaborRate] = useState("175.00");
  const [highestTechRate, setHighestTechRate] = useState("");
  const [laborHours, setLaborHours] = useState("");
  const [numTechs, setNumTechs] = useState("1");
  const [commissionPercent, setCommissionPercent] = useState("10.00");
  const [financingFeePercent, setFinancingFeePercent] = useState("4.00");
  const [targetGm, setTargetGm] = useState("");
  const [materialMarkup, setMaterialMarkup] = useState("200");
  const [roundUp, setRoundUp] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);

  useEffect(() => {
    if (settings && !hasInitialized) {
      setSalesTaxPercent(settings.salesTaxPercent || "6.35");
      const defaultHighestTechRate = parseFloat(settings.highestTechRate || "0") || 0;
      if (defaultHighestTechRate > 0) {
        setHighestTechRate(defaultHighestTechRate.toFixed(2));
        setLaborRate(computeRecommendedLaborRate(settings).toFixed(2));
      } else {
        setLaborRate(settings.laborHourlyRate || "175.00");
      }
      setCommissionPercent(settings.commissionPercent || "10.00");
      setFinancingFeePercent(settings.financingFeePercent || "4.00");
      setTargetGm((parseFloat(settings.grossMarginMinPercent || "52") + 10).toFixed(1));
      setHasInitialized(true);
    }
  }, [settings, hasInitialized]);

  // When TenantTaxSelector silently updates settings with a new tech rate,
  // re-apply the rates even though the page is already initialized.
  useEffect(() => {
    if (!hasInitialized || !settings) return;
    const newTechRate = parseFloat(settings.highestTechRate || "0") || 0;
    if (newTechRate > 0) {
      setHighestTechRate(newTechRate.toFixed(2));
      setLaborRate(computeRecommendedLaborRate(settings).toFixed(2));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.highestTechRate, settings?.laborHourlyRate]);

  // Auto-switch markup: 200% for parts ≤ $500, 150% for parts > $500
  useEffect(() => {
    const parts = parseFloat(partsCost) || 0;
    const current = parseFloat(materialMarkup) || 200;
    // Only auto-switch between the two standard values; leave custom values alone
    if (current === 200 || current === 150) {
      setMaterialMarkup(parts > 500 ? "150" : "200");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partsCost]);

  const resetInputs = () => {
    setPartsCost("");
    setMaterialMarkup("200");
    setLaborHours("");
    setNumTechs("1");
    setLaborMode("dollars");
    setSalesTaxPercent(settings?.salesTaxPercent || "6.35");
    const defaultHighestTechRate = parseFloat(settings?.highestTechRate || "0") || 0;
    if (defaultHighestTechRate > 0) {
      setHighestTechRate(defaultHighestTechRate.toFixed(2));
      setLaborRate(settings ? computeRecommendedLaborRate(settings).toFixed(2) : "175.00");
    } else {
      setHighestTechRate("");
      setLaborRate(settings?.laborHourlyRate || "175.00");
    }
    setCommissionPercent(settings?.commissionPercent || "10.00");
    setFinancingFeePercent(settings?.financingFeePercent || "4.00");
    setTargetGm((parseFloat(settings?.grossMarginMinPercent || "52") + 10).toFixed(1));
    setRoundUp(false);
  };

  const selectedTenant = tenantList.find(t => t.id === selectedTenantId);
  const afterHoursPricingMultiplier = (selectedTenant as any)?.afterHoursMultiplier ?? 1.5;

  const partsVal = parseFloat(partsCost) || 0;
  const laborRateVal = parseFloat(laborRate) || 0;
  const highestTechRateVal = parseFloat(highestTechRate) || 0;
  const hoursVal = parseFloat(laborHours) || 0;
  const numTechsVal = Math.max(1, parseFloat(numTechs) || 1);
  const burdenRate = ZEPHYR_STANDARDS.LABOR_BURDEN_PCT / 100;
  const taxRate = (parseFloat(salesTaxPercent) || 0) / 100;
  const commissionRate = (parseFloat(commissionPercent) || 0) / 100;
  const financingRate = (parseFloat(financingFeePercent) || 0) / 100;
  const targetGmVal = parseFloat(targetGm) || 0;
  const g = targetGmVal / 100;

  const [results, setResults] = useState({
    price: 0,
    estimatedLabor: 0,
    directLaborCost: 0,
    laborRate: 0,
    breakdown: {
      materials: 0,
      equipment: 0,
      tax: 0,
      commission: 0,
      financing: 0,
      laborCost: 0,
    },
    metrics: {
      grossMarginPercent: 0,
      grossMarginAmount: 0,
      mePercent: 0,
    },
  });

  useEffect(() => {
    const tax = partsVal * taxRate;
    const totalPartsAtCost = partsVal + tax;  // actual cost basis — used for GM% calculation
    const markupRateVal = (parseFloat(materialMarkup) || 200) / 100;
    const markedUpParts = totalPartsAtCost * (1 + markupRateVal);  // markup revenue — used for base price

    const c = commissionRate * (1 + burdenRate);
    const f = financingRate;
    // Same denominator as the Repair Calculator — target GM% is a display reference only,
    // not a solve input. Price = (markedUpParts + billingRateLabor) / (1 - commission - financing).
    const denom = 1 - c - f;

    // Billing rate → drives the selling price formula (what we charge per hour)
    // Tech rate   → drives the actual GM% display (what we truly spend per hour)
    const actualTechRate = highestTechRateVal > 0 ? highestTechRateVal : laborRateVal;

    let price = 0;
    let directLaborCost = 0;
    let laborCost = 0;

    if (laborMode === "dollars") {
      const baseBillingDirect = hoursVal * numTechsVal * laborRateVal;
      const baseBillingLabor = baseBillingDirect * (1 + burdenRate);

      if (denom > 0) {
        const regularPrice = (markedUpParts + baseBillingLabor) / denom;

        if (afterHours) {
          const ahBillingDirect = baseBillingDirect * 1.5;
          const ahBillingLabor = ahBillingDirect * (1 + burdenRate);
          const ahSolvedPrice = (markedUpParts + ahBillingLabor) / denom;
          const multipliedPrice = regularPrice * afterHoursPricingMultiplier;
          price = Math.max(multipliedPrice, ahSolvedPrice);
          directLaborCost = ahBillingDirect;
          laborCost = ahBillingLabor;
        } else {
          price = regularPrice;
          directLaborCost = baseBillingDirect;
          laborCost = baseBillingLabor;
        }
      }
    } else {
      // Percent / production-pay mode: no hourly labor
      if (denom > 0) {
        const regularPrice = markedUpParts / denom;
        price = afterHours ? regularPrice * afterHoursPricingMultiplier : regularPrice;
      }
      directLaborCost = 0;
      laborCost = 0;
    }

    if (roundUp) price = Math.ceil(price);

    const commissionCost = price * c;
    const financingCost = price * f;
    const estimatedLabor = laborCost + commissionCost + tax + financingCost;
    const totalHours = hoursVal * numTechsVal;
    const laborRateResult = laborMode === "dollars" && totalHours > 0
      ? laborRateVal * (afterHours ? 1.5 : 1)
      : 0;

    // GM% — always uses actual tech rate as true labor cost
    const actualTechLaborForGM = laborMode === "dollars"
      ? hoursVal * numTechsVal * actualTechRate * (afterHours ? 1.5 : 1) * (1 + burdenRate)
      : 0;
    const totalAllCogs = totalPartsAtCost + actualTechLaborForGM + commissionCost + financingCost;
    const grossMarginAmount = price - totalAllCogs;
    const grossMarginPercent = price > 0 ? (grossMarginAmount / price) * 100 : 0;
    const mePercent = price > 0 ? (totalPartsAtCost / price) * 100 : 0;

    setResults({
      price,
      estimatedLabor,
      directLaborCost,
      laborRate: laborRateResult,
      breakdown: {
        materials: partsVal,
        equipment: 0,
        tax,
        commission: commissionCost,
        financing: financingCost,
        laborCost,
      },
      metrics: { grossMarginPercent, grossMarginAmount, mePercent },
    });
  }, [
    partsVal, taxRate, materialMarkup, laborMode, hoursVal, numTechsVal,
    laborRateVal, highestTechRateVal, burdenRate, commissionRate, financingRate,
    roundUp, afterHours, afterHoursPricingMultiplier,
  ]);

  const downloadImage = async () => {
    if (!resultsRef.current) return;
    try {
      const dataUrl = await toPng(resultsRef.current, { cacheBust: true, backgroundColor: "#fff" });
      const link = document.createElement("a");
      link.download = `repair-gm-quote-${new Date().toISOString().split("T")[0]}.png`;
      link.href = dataUrl;
      link.click();
      toast({ title: "Image Saved", description: "The quote image has been downloaded successfully." });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to save the image." });
    }
  };

  const handleSave = () => {
    createQuote.mutate({
      title: quoteTitle || "Untitled Repair GM Quote",
      tenantId: selectedTenantId,
      materialsCost: partsVal.toString(),
      equipmentCost: "0",
      laborHoursInput: laborMode === "dollars" ? hoursVal.toString() : "0",
      calculatedPrice: results.price.toFixed(2),
      calculatedGrossMargin: results.metrics.grossMarginPercent.toFixed(2),
      calculatedEstimatedLabor: results.estimatedLabor.toFixed(2),
      calculatedMePercent: results.metrics.mePercent.toFixed(2),
      calculatedLaborRate: results.laborRate > 0 ? results.laborRate.toFixed(2) : null,
      subcontractorCost: "0",
      craneCost: "0",
      permitCost: "0",
      afterHours,
    } as any, {
      onSuccess: async () => {
        await downloadImage();
        setIsSaveOpen(false);
        setQuoteTitle("");
      },
    });
  };

  if (settingsLoading || !settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const priceKey = results.price.toFixed(2);
  const locked = isPriceGated && revealedKey !== priceKey;

  const handleReveal = async (jobNumber: string, customerName: string) => {
    await createQuote.mutateAsync({
      title: jobNumber,
      customerName: customerName || null,
      tenantId: selectedTenantId,
      materialsCost: partsVal.toString(),
      equipmentCost: "0",
      laborHoursInput: laborMode === "dollars" ? hoursVal.toString() : "0",
      calculatedPrice: results.price.toFixed(2),
      calculatedGrossMargin: results.metrics.grossMarginPercent.toFixed(2),
      calculatedEstimatedLabor: results.estimatedLabor.toFixed(2),
      calculatedMePercent: results.metrics.mePercent.toFixed(2),
      calculatedLaborRate: results.laborRate > 0 ? results.laborRate.toFixed(2) : null,
      subcontractorCost: "0",
      craneCost: "0",
      permitCost: "0",
      afterHours,
    } as any);
    setRevealedKey(priceKey);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Repair GM Calculator</h1>
          <p className="text-muted-foreground mt-1">
            Enter your repair costs — the calculator solves for the price needed to hit your target gross margin.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button
            variant={afterHours ? "default" : "outline"}
            onClick={() => setAfterHours(v => !v)}
            className={`gap-2 font-bold transition-all ${afterHours ? "bg-red-600 hover:bg-red-700 text-white border-red-600 shadow-lg shadow-red-600/30" : "border-red-600 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"}`}
            data-testid="button-after-hours"
          >
            <Moon size={16} />
            After Hours
          </Button>
          <Button variant="outline" onClick={resetInputs} className="gap-2" data-testid="button-reset">
            <RefreshCw size={16} />
            Reset
          </Button>
          <Dialog open={isSaveOpen} onOpenChange={setIsSaveOpen}>
            {!isPriceGated && (
              <DialogTrigger asChild>
                <Button className="gap-2 shadow-lg shadow-primary/20 hover:shadow-primary/30" data-testid="button-save-repair-gm">
                  <Save size={16} />
                  Save Quote
                </Button>
              </DialogTrigger>
            )}
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Save Quote</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Quote Title</Label>
                  <Input
                    placeholder="e.g. Smith Residence - Repair"
                    value={quoteTitle}
                    onChange={(e) => setQuoteTitle(e.target.value)}
                    data-testid="input-quote-title"
                  />
                </div>
                <div className="bg-muted p-4 rounded-lg space-y-3 text-sm">
                  <div className="pt-2 flex justify-between items-baseline">
                    <span className="text-muted-foreground font-bold">Total Price:</span>
                    <span className="text-xl font-bold text-primary">${results.price.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-baseline border-t border-border/50 pt-2">
                    <span className="text-muted-foreground font-bold">Gross Margin:</span>
                    <span className="text-lg font-bold text-emerald-600">{results.metrics.grossMarginPercent.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsSaveOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={createQuote.isPending}>
                  {createQuote.isPending ? "Saving..." : "Save & Download"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Target GM% banner */}
      <div className="flex items-center gap-4 bg-primary/5 border border-primary/20 rounded-xl px-5 py-4">
        <Target size={28} className="text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-primary uppercase tracking-wider">Target GM</p>
          <p className="text-sm text-muted-foreground">Your margin goal — price is built from parts markup + billing rate. Adjust markup or hours to hit this target.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative group">
            <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none text-xs font-mono">%</div>
            <Input
              type="number"
              step="0.5"
              min={isReporting ? "1" : (settings?.grossMarginMinPercent ?? "1")}
              max="99"
              value={targetGm}
              onChange={(e) => {
                const val = e.target.value;
                const minGm = isReporting ? 1 : (parseFloat(settings?.grossMarginMinPercent ?? "1") || 1);
                const num = parseFloat(val);
                if (!isNaN(num) && num < minGm) {
                  setTargetGm(minGm.toFixed(1));
                } else {
                  setTargetGm(val);
                }
              }}
              data-testid="input-target-gm"
              className="pl-8 h-10 w-28 text-sm font-bold text-primary border-primary/30 bg-background"
            />
          </div>
        </div>
      </div>

      <TenantTaxSelector
        selectedTenantId={selectedTenantId}
        onTenantChange={setSelectedTenantId}
        onTaxChange={setSalesTaxPercent}
        testIdSuffix="-repair-gm"
        variant="bar"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Input Column */}
        <div className="lg:col-span-3 space-y-2">
          {/* Parts */}
          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">1</span>
              <h2 className="font-display font-semibold text-sm">Parts</h2>
            </div>
            <div className="space-y-2">
              <InputMoney
                label="Parts Total"
                placeholder="0.00"
                value={partsCost}
                onChange={(e) => setPartsCost(e.target.value)}
                data-testid="input-parts-cost"
              />
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sales Tax %</Label>
                <div className="relative group">
                  <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                    <span className="text-xs font-mono">%</span>
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={salesTaxPercent}
                    onChange={(e) => setSalesTaxPercent(e.target.value)}
                    data-testid="input-sales-tax"
                    className="pl-8 h-9 text-sm font-medium bg-background border-border shadow-sm"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Labor */}
          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-blue-500/10 text-blue-600 flex items-center justify-center text-[10px] font-bold">2</span>
              <h2 className="font-display font-semibold text-sm">Labor</h2>
              <div className="ml-auto flex items-center gap-2">
                <Label htmlFor="repair-gm-labor-mode" className="text-xs font-medium cursor-pointer text-muted-foreground">Production Pay</Label>
                <Switch
                  id="repair-gm-labor-mode"
                  checked={laborMode === "percent"}
                  onCheckedChange={(checked) => setLaborMode(checked ? "percent" : "dollars")}
                  data-testid="switch-labor-mode"
                />
              </div>
            </div>
            {laborMode === "percent" ? (
              <p className="text-xs text-muted-foreground">Labor is included in Commission % below</p>
            ) : (
              <div className="space-y-2">
                <InputMoney
                  label="Labor Hours"
                  type="number"
                  placeholder="1"
                  value={laborHours}
                  onChange={(e) => setLaborHours(e.target.value)}
                  data-testid="input-labor-hours"
                />
                <InputMoney
                  label="# of Technicians"
                  type="number"
                  placeholder="1"
                  value={numTechs}
                  onChange={(e) => setNumTechs(e.target.value)}
                  data-testid="input-num-techs"
                />
                <p className="text-xs text-muted-foreground">
                  ${parseFloat(laborRate).toFixed(2)}/hr per technician
                </p>
              </div>
            )}
          </div>

          {/* Fees & Burden */}
          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-amber-500/10 text-amber-600 flex items-center justify-center text-[10px] font-bold">3</span>
              <h2 className="font-display font-semibold text-sm">Fees & Burden</h2>
            </div>
            <div className="space-y-2">
              <InputMoney
                label="Commission %"
                type="percent"
                placeholder="10.00"
                value={commissionPercent}
                onChange={(e) => setCommissionPercent(e.target.value)}
                data-testid="input-commission"
              />
              <InputMoney
                label="Finance Fee %"
                type="percent"
                placeholder="6.00"
                value={financingFeePercent}
                onChange={(e) => setFinancingFeePercent(e.target.value)}
                data-testid="input-financing-fee"
              />
            </div>
          </div>
        </div>

        {/* Results Column */}
        <div className="lg:col-span-9 space-y-3" ref={resultsRef}>
          {afterHours && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 text-white font-bold text-sm shadow-lg shadow-red-600/30">
              <Moon size={16} />
              After Hours Pricing Active
            </div>
          )}
          <RevealPriceGate locked={locked} onReveal={handleReveal} isSaving={createQuote.isPending}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="col-span-2 bg-primary/5 border border-primary/20 rounded-xl p-4 flex flex-col justify-center">
                <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1">Selling Price</p>
                <p className="text-3xl font-bold text-primary" data-testid="text-selling-price">
                  {results.price > 0 ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(results.price) : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Markup + billing rate · goal: {targetGm || "—"}% GM</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-center">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Achieved GM %</p>
                <p className="text-2xl font-bold text-foreground" data-testid="text-achieved-gm">
                  {results.price > 0 ? `${results.metrics.grossMarginPercent.toFixed(2)}%` : "—"}
                </p>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-center">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Parts + Tax</p>
                <p className="text-2xl font-bold text-foreground">
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(partsVal + partsVal * taxRate)}
                </p>
              </div>
            </div>

            <ResultsCard
              price={results.price}
              estimatedLabor={results.estimatedLabor}
              breakdown={results.breakdown}
              metrics={results.metrics}
              partsOnly
              salesTaxRate={salesTaxPercent}
              roundUp={roundUp}
              onRoundUpChange={setRoundUp}
              grossMarginMinPercent={targetGmVal}
              laborBreakdown={
                laborMode === "dollars" && hoursVal > 0
                  ? {
                      hours: hoursVal,
                      numTechs: numTechsVal,
                      hourlyRate: laborRateVal * (afterHours ? 1.5 : 1),
                      burdenPercent: ZEPHYR_STANDARDS.LABOR_BURDEN_PCT,
                    }
                  : undefined
              }
            />
          </RevealPriceGate>
        </div>
      </div>
    </div>
  );
}
