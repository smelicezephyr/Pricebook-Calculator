import { useState, useEffect, useRef } from "react";
import { useSettings } from "@/hooks/use-settings";
import { useCalculatorState } from "@/contexts/CalculatorContext";
import { useCreateQuote } from "@/hooks/use-quotes";
import { useAuth } from "@/contexts/AuthContext";
import { InputMoney } from "@/components/InputMoney";
import { RevealPriceGate } from "@/components/RevealPriceGate";
import { TenantTaxSelector } from "@/components/TenantTaxSelector";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { RefreshCw, Loader2, DollarSign, TrendingUp, Save } from "lucide-react";
import { toPng } from "html-to-image";
import { useToast } from "@/hooks/use-toast";

export default function RepairCalculator() {
  const { settings, isLoading: settingsLoading } = useSettings();
  const { setRepairState } = useCalculatorState();
  const createQuote = useCreateQuote();
  const { toast } = useToast();
  const { isPriceGated } = useAuth();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [quoteTitle, setQuoteTitle] = useState("");

  const [partsCost, setPartsCost] = useState("");
  const [materialMarkup, setMaterialMarkup] = useState("200");
  const [laborRate, setLaborRate] = useState("175.00");
  const [laborHours, setLaborHours] = useState("");
  const [numTechs, setNumTechs] = useState("1");
  const [burdenPercent, setBurdenPercent] = useState("20.00");
  const [salesTaxPercent, setSalesTaxPercent] = useState("6.35");
  const [commissionPercent, setCommissionPercent] = useState("10.00");
  const [financingFeePercent, setFinancingFeePercent] = useState("4.00");
  const [highestTechRate, setHighestTechRate] = useState("");
  const [roundUp, setRoundUp] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [laborMode, setLaborMode] = useState<"dollars" | "percent">("dollars");

  const markupOptions = Array.from({ length: 30 }, (_, i) => 300 - i * 10);

  useEffect(() => {
    if (settings) {
      setSalesTaxPercent(settings.salesTaxPercent || "6.35");
      setCommissionPercent(settings.commissionPercent || "10.00");
      const defaultHighestTechRate = parseFloat(settings.highestTechRate || "0") || 0;
      if (defaultHighestTechRate > 0) {
        setHighestTechRate(defaultHighestTechRate.toFixed(2));
        setLaborRate((defaultHighestTechRate * 3.5).toFixed(2));
      } else {
        setLaborRate(settings.laborHourlyRate || "175.00");
      }
      setBurdenPercent(settings.laborBurdenPercent || "20.00");
      setFinancingFeePercent(settings.financingFeePercent || "4.00");
    }
  }, [settings]);

  useEffect(() => {
    setRepairState({
      partsCost,
      materialMarkup,
      laborRate,
      laborHours,
      numTechs,
      burdenPercent,
      salesTaxPercent,
      commissionPercent,
      financingFeePercent,
      highestTechRate,
      laborMode,
    });
  }, [partsCost, materialMarkup, laborRate, laborHours, numTechs, burdenPercent, salesTaxPercent, commissionPercent, financingFeePercent, highestTechRate, laborMode, setRepairState]);

  const partsTotal = parseFloat(partsCost) || 0;
  const markupRate = (parseFloat(materialMarkup) || 200) / 100;
  const laborRateVal = parseFloat(laborRate) || 0;
  const laborHoursVal = parseFloat(laborHours) || 0;
  const numTechsVal = Math.max(1, parseFloat(numTechs) || 1);
  const burdenRate = (parseFloat(burdenPercent) || 0) / 100;
  const taxRate = (parseFloat(salesTaxPercent) || 0) / 100;
  const commissionRate = (parseFloat(commissionPercent) || 0) / 100;
  const financingRate = (parseFloat(financingFeePercent) || 0) / 100;

  const salesTax = partsTotal * taxRate;
  const subtotal1 = partsTotal + salesTax;

  const markupAmount = subtotal1 * markupRate;
  const subtotal2 = subtotal1 + markupAmount;

  let directLaborCost: number;
  let laborBurden: number;
  let burdenedLaborCost: number;
  let subtotal3: number;
  let directCommission: number;
  let commissionBurden: number;
  let burdenedCommission: number;
  let subtotal4: number;
  let financingFee: number;
  let totalBeforeRounding: number;

  if (laborMode === "percent") {
    directLaborCost = 0;
    laborBurden = 0;
    burdenedLaborCost = 0;
    subtotal3 = subtotal2;

    const denominator = 1 - commissionRate * (1 + burdenRate) - financingRate;
    const totalPriceCalc = denominator > 0 ? subtotal3 / denominator : subtotal3;

    directCommission = totalPriceCalc * commissionRate;
    commissionBurden = directCommission * burdenRate;
    burdenedCommission = directCommission + commissionBurden;
    financingFee = totalPriceCalc * financingRate;
    subtotal4 = subtotal3 + burdenedCommission;
    totalBeforeRounding = subtotal4 + financingFee;
  } else {
    directLaborCost = laborRateVal * laborHoursVal * numTechsVal;
    laborBurden = directLaborCost * burdenRate;
    burdenedLaborCost = directLaborCost + laborBurden;
    subtotal3 = subtotal2 + burdenedLaborCost;

    const denominator = 1 - commissionRate * (1 + burdenRate) - financingRate;
    const totalPriceCalc = denominator > 0 ? subtotal3 / denominator : subtotal3;

    directCommission = totalPriceCalc * commissionRate;
    commissionBurden = directCommission * burdenRate;
    burdenedCommission = directCommission + commissionBurden;
    financingFee = totalPriceCalc * financingRate;
    subtotal4 = subtotal3 + burdenedCommission;
    totalBeforeRounding = subtotal4 + financingFee;
  }

  const totalPrice = roundUp ? Math.ceil(totalBeforeRounding) : totalBeforeRounding;

  const totalLaborHours = laborHoursVal * numTechsVal;
  const laborRateResult = laborMode === "dollars" && totalLaborHours > 0
    ? (burdenedLaborCost + burdenedCommission) / totalLaborHours
    : 0;

  const highestTechRateVal = parseFloat(highestTechRate) || 0;
  const techLaborCost = laborMode === "percent"
    ? 0
    : highestTechRateVal * laborHoursVal * numTechsVal;
  const burdenedTechLabor = techLaborCost * (1 + burdenRate);
  const cogs = subtotal1 + burdenedTechLabor + burdenedCommission;
  const grossMargin = totalPrice - cogs;
  const grossMarginPercent = totalPrice > 0 ? (grossMargin / totalPrice) * 100 : 0;

  const formatPercent = (val: number) => `${val.toFixed(2)}%`;

  const getMarginHealth = () => {
    if (grossMarginPercent >= 50) {
      return { status: 'strong', label: 'Margin Health: Strong', color: 'bg-emerald-500', textColor: 'text-emerald-600', glow: '0 0 8px 2px rgba(16, 185, 129, 0.6)' };
    } else if (grossMarginPercent >= 40) {
      return { status: 'caution', label: 'Margin Health: Caution', color: 'bg-amber-500', textColor: 'text-amber-600', glow: '0 0 8px 2px rgba(245, 158, 11, 0.6)' };
    } else {
      return { status: 'danger', label: 'Margin Health: Low', color: 'bg-red-500', textColor: 'text-red-600', glow: '0 0 8px 2px rgba(239, 68, 68, 0.6)' };
    }
  };
  const marginHealth = getMarginHealth();

  const handleReset = () => {
    setPartsCost("");
    setMaterialMarkup("200");
    setLaborHours("");
    setNumTechs("1");
    setLaborMode("dollars");
    setSalesTaxPercent(settings?.salesTaxPercent || "6.35");
    setCommissionPercent(settings?.commissionPercent || "10.00");
    const defaultHighestTechRate = parseFloat(settings?.highestTechRate || "0") || 0;
    if (defaultHighestTechRate > 0) {
      setHighestTechRate(defaultHighestTechRate.toFixed(2));
      setLaborRate((defaultHighestTechRate * 3.5).toFixed(2));
    } else {
      setHighestTechRate("");
      setLaborRate(settings?.laborHourlyRate || "175.00");
    }
    setBurdenPercent(settings?.laborBurdenPercent || "20.00");
    setFinancingFeePercent(settings?.financingFeePercent || "4.00");
    setRoundUp(false);
  };

  const downloadImage = async () => {
    if (!resultsRef.current) return;
    try {
      const dataUrl = await toPng(resultsRef.current, { cacheBust: true, backgroundColor: "#fff" });
      const link = document.createElement("a");
      link.download = `${quoteTitle || "repair-quote"}-${new Date().toISOString().split("T")[0]}.png`;
      link.href = dataUrl;
      link.click();
      toast({ title: "Image Saved", description: "The quote image has been downloaded successfully." });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to save the image." });
    }
  };

  const handleSave = () => {
    createQuote.mutate({
      title: quoteTitle || "Untitled Repair Quote",
      materialsCost: partsTotal.toString(),
      equipmentCost: "0",
      laborHoursInput: laborMode === "percent" ? "0" : laborHoursVal.toString(),
      calculatedPrice: totalPrice.toFixed(2),
      calculatedGrossMargin: grossMarginPercent.toFixed(2),
      calculatedEstimatedLabor: directLaborCost.toFixed(2),
      calculatedMePercent: materialMarkup,
      calculatedLaborRate: laborRateResult > 0 ? laborRateResult.toFixed(2) : null,
      subcontractorCost: "0",
      craneCost: "0",
      permitCost: "0",
    }, {
      onSuccess: async () => {
        await downloadImage();
        setIsSaveOpen(false);
        setQuoteTitle("");
      },
    });
  };

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

  const priceKey = totalPrice.toFixed(2);
  const locked = isPriceGated && revealedKey !== priceKey;

  const handleReveal = async (jobNumber: string, customerName: string) => {
    await createQuote.mutateAsync({
      title: jobNumber,
      customerName: customerName || null,
      materialsCost: partsTotal.toString(),
      equipmentCost: "0",
      laborHoursInput: laborMode === "percent" ? "0" : laborHoursVal.toString(),
      calculatedPrice: totalPrice.toFixed(2),
      calculatedGrossMargin: grossMarginPercent.toFixed(2),
      calculatedEstimatedLabor: directLaborCost.toFixed(2),
      calculatedMePercent: materialMarkup,
      calculatedLaborRate: laborRateResult > 0 ? laborRateResult.toFixed(2) : null,
      subcontractorCost: "0",
      craneCost: "0",
      permitCost: "0",
    });
    setRevealedKey(priceKey);
  };

  if (settingsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Repair Calculator</h1>
          <p className="text-muted-foreground mt-1">Calculate pricing for HVAC repair jobs.</p>
        </div>

        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={handleReset} className="gap-2" data-testid="button-reset">
            <RefreshCw size={16} />
            Reset
          </Button>

          <Dialog open={isSaveOpen} onOpenChange={setIsSaveOpen}>
            {!isPriceGated && (
              <DialogTrigger asChild>
                <Button className="gap-2 shadow-lg shadow-primary/20 hover:shadow-primary/30" data-testid="button-save-repair">
                  <Save size={16} />
                  Save Calc
                </Button>
              </DialogTrigger>
            )}
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Save Repair Quote</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Quote Title</Label>
                  <Input
                    placeholder="e.g. Johnson - AC Repair"
                    value={quoteTitle}
                    onChange={(e) => setQuoteTitle(e.target.value)}
                    data-testid="input-quote-title"
                  />
                </div>
                <div className="bg-muted p-4 rounded-lg space-y-3 text-sm">
                  <div className="space-y-1 pb-2 border-b border-border/50">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Job Summary</p>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Parts Total:</span>
                      <span className="font-medium">{formatCurrency(partsTotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Markup:</span>
                      <span className="font-medium">{materialMarkup}%</span>
                    </div>
                    {laborMode !== "percent" && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Labor:</span>
                        <span className="font-medium">{formatCurrency(directLaborCost)}</span>
                      </div>
                    )}
                  </div>
                  <div className="pt-2 flex justify-between items-baseline">
                    <span className="text-muted-foreground font-bold">Total Price:</span>
                    <span className="text-xl font-bold text-primary">{formatCurrency(totalPrice)}</span>
                  </div>
                  <div className="flex justify-between items-baseline border-t border-border/50 pt-2">
                    <span className="text-muted-foreground font-bold">Gross Margin:</span>
                    <span className="text-lg font-bold text-emerald-600">{grossMarginPercent.toFixed(2)}%</span>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsSaveOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={createQuote.isPending} data-testid="button-save-confirm">
                  {createQuote.isPending ? "Saving..." : "Save & Download"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <TenantTaxSelector
        selectedTenantId={selectedTenantId}
        onTenantChange={setSelectedTenantId}
        onTaxChange={setSalesTaxPercent}
        testIdSuffix="-repair"
        variant="bar"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-3 space-y-2">
          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">1</span>
              <h2 className="font-display font-semibold text-sm">Parts & Markup</h2>
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
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Material Mark Up
                </Label>
                <select
                  value={materialMarkup}
                  onChange={(e) => setMaterialMarkup(e.target.value)}
                  data-testid="select-markup"
                  className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-2.5 py-1.5 text-sm font-medium ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  {markupOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}%
                    </option>
                  ))}
                </select>
              </div>

              <InputMoney
                label="Sales Tax %"
                type="percent"
                placeholder="6.35"
                value={salesTaxPercent}
                onChange={(e) => setSalesTaxPercent(e.target.value)}
                data-testid="input-sales-tax"
              />
            </div>
          </div>

          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-blue-500/10 text-blue-600 flex items-center justify-center text-[10px] font-bold">2</span>
              <h2 className="font-display font-semibold text-sm">Labor</h2>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-end gap-2">
                <Label htmlFor="laborMode" className="text-sm font-medium cursor-pointer">
                  Production Pay
                </Label>
                <Switch
                  id="laborMode"
                  checked={laborMode === "percent"}
                  onCheckedChange={(checked) => setLaborMode(checked ? "percent" : "dollars")}
                  data-testid="switch-labor-mode"
                />
              </div>

              {laborMode === "percent" ? (
                <p className="text-xs text-muted-foreground">Labor is included in Commission % below</p>
              ) : (
                <>
                  <InputMoney
                    label="Labor Rate (per tech)"
                    placeholder="125.00"
                    value={laborRate}
                    onChange={(e) => setLaborRate(e.target.value)}
                    data-testid="input-labor-rate"
                  />

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

                  <InputMoney
                    label="Highest Tech Pay Rate"
                    placeholder="0.00"
                    value={highestTechRate}
                    onChange={(e) => setHighestTechRate(e.target.value)}
                    data-testid="input-highest-tech-rate"
                  />
                </>
              )}
            </div>
          </div>

          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-amber-500/10 text-amber-600 flex items-center justify-center text-[10px] font-bold">3</span>
              <h2 className="font-display font-semibold text-sm">Fees & Burden</h2>
            </div>

            <div className="space-y-2">
              <InputMoney
                label="Burden %"
                type="percent"
                placeholder="20.00"
                value={burdenPercent}
                onChange={(e) => setBurdenPercent(e.target.value)}
                data-testid="input-burden"
              />

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
              <p className="text-xs text-muted-foreground -mt-1 col-span-full">Financing fee and/or credit card processing fee</p>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Label htmlFor="roundUp" className="text-sm font-medium cursor-pointer">
                  Round Up
                </Label>
                <Switch
                  id="roundUp"
                  checked={roundUp}
                  onCheckedChange={setRoundUp}
                  data-testid="switch-round-up"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-9 space-y-4" ref={resultsRef}>
        <RevealPriceGate locked={locked} onReveal={handleReveal} isSaving={createQuote.isPending}>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="md:col-span-3 bg-primary text-primary-foreground rounded-xl p-5 shadow-xl shadow-primary/20 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                <DollarSign size={100} />
              </div>
              <div className="relative z-10">
                <div className="mb-3" data-testid="margin-health-bar">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-primary-foreground/90">{marginHealth.label}</span>
                  </div>
                  <div className="h-1.5 w-1/2 bg-primary-foreground/20 rounded-full overflow-visible">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${marginHealth.color}`}
                      style={{ width: '100%', boxShadow: marginHealth.glow }}
                    />
                  </div>
                </div>
                <h2 className="text-5xl font-display font-bold tracking-tight" data-testid="text-total-price">
                  {formatCurrency(totalPrice)}
                </h2>
                {roundUp && totalBeforeRounding !== totalPrice && (
                  <p className="text-sm text-primary-foreground/80 mt-2 font-medium">
                    Before rounding: {formatCurrency(totalBeforeRounding)}
                  </p>
                )}
              </div>
            </div>

            <div className="md:col-span-2 bg-card border border-border rounded-xl p-5 shadow-lg shadow-black/5 relative overflow-hidden group">
              <div className="relative z-10">
                <p className="text-muted-foreground font-medium text-sm mb-1">Gross Margin</p>
                <h2 className={`text-4xl font-display font-bold tracking-tight ${marginHealth.textColor}`} data-testid="text-margin-percent">
                  {grossMarginPercent.toFixed(2)}%
                </h2>
                <p className="text-sm text-muted-foreground mt-2">
                  {formatCurrency(grossMargin)} profit
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
              <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">COGS</p>
              <p className="text-lg font-bold text-foreground" data-testid="text-cogs">{formatCurrency(cogs)}</p>
            </div>
            <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
              <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">Direct Labor</p>
              <p className="text-lg font-bold text-foreground" data-testid="text-direct-labor">{formatCurrency(burdenedTechLabor + burdenedCommission)}</p>
              <p className="text-xs text-muted-foreground">{formatPercent(totalPrice > 0 ? ((burdenedTechLabor + burdenedCommission) / totalPrice) * 100 : 0)}</p>
            </div>
            <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
              <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">Parts + Tax</p>
              <p className="text-lg font-bold text-foreground" data-testid="text-parts-tax">{formatCurrency(subtotal1)}</p>
            </div>
            <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
              <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">Finance Fee</p>
              <p className="text-lg font-bold text-foreground" data-testid="text-finance-fee">{formatCurrency(financingFee)}</p>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border p-4 shadow-sm">
            <div className="mb-3">
              <h3 className="font-display font-bold text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" /> Cost Breakdown
              </h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">All costs that make up the total selling price</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">Parts & Materials</h4>
                <div className="space-y-1">
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100/50 dark:border-blue-900/30">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                      <span className="text-sm font-semibold text-blue-900 dark:text-blue-300">Parts + Tax + Markup</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground font-medium">
                        ({formatPercent(totalPrice > 0 ? (subtotal2 / totalPrice) * 100 : 0)})
                      </span>
                      <span className="font-mono text-sm font-medium text-blue-700 dark:text-blue-400">
                        {formatCurrency(subtotal2)}
                      </span>
                    </div>
                  </div>
                  <div className="ml-5 space-y-0.5 pt-1 border-l-2 border-blue-100/50 dark:border-blue-900/30 pl-3">
                    {[
                      { label: "Parts Total", value: partsTotal },
                      { label: `Sales Tax (${salesTaxPercent}%)`, value: salesTax },
                      { label: `Markup (${materialMarkup}%)`, value: markupAmount },
                    ].map((sub) => (
                      <div key={sub.label} className="flex justify-between items-center py-0.5">
                        <span className="text-xs text-muted-foreground">{sub.label}</span>
                        <span className="text-xs font-mono text-muted-foreground">{formatCurrency(sub.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {laborMode !== "percent" && (
                <div className="space-y-1.5">
                  <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">Labor</h4>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                        <span className="text-sm font-semibold text-emerald-900 dark:text-emerald-300">Burdened Labor</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground font-medium">
                          ({formatPercent(totalPrice > 0 ? (burdenedLaborCost / totalPrice) * 100 : 0)})
                        </span>
                        <span className="font-mono text-sm font-medium text-emerald-700 dark:text-emerald-400">
                          {formatCurrency(burdenedLaborCost)}
                        </span>
                      </div>
                    </div>
                    <div className="ml-5 space-y-0.5 pt-1 border-l-2 border-emerald-100/50 dark:border-emerald-900/30 pl-3">
                      {[
                        { label: numTechsVal > 1 ? `Labor (${numTechsVal} techs × ${laborHoursVal} hrs × ${formatCurrency(laborRateVal)}/hr)` : `Labor (${laborHoursVal} hrs × ${formatCurrency(laborRateVal)}/hr)`, value: directLaborCost },
                        { label: `Labor Burden (${burdenPercent}%)`, value: laborBurden },
                      ].map((sub) => (
                        <div key={sub.label} className="flex justify-between items-center py-0.5">
                          <span className="text-xs text-muted-foreground">{sub.label}</span>
                          <span className="text-xs font-mono text-muted-foreground">{formatCurrency(sub.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">
                  {laborMode === "percent" ? "Commission (incl. Labor)" : "Commission"}
                </h4>
                <div className="space-y-1">
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100/50 dark:border-amber-900/30">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                      <span className="text-sm font-semibold text-amber-900 dark:text-amber-300">Burdened Commission</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground font-medium">
                        ({formatPercent(totalPrice > 0 ? (burdenedCommission / totalPrice) * 100 : 0)})
                      </span>
                      <span className="font-mono text-sm font-medium text-amber-700 dark:text-amber-400">
                        {formatCurrency(burdenedCommission)}
                      </span>
                    </div>
                  </div>
                  <div className="ml-5 space-y-0.5 pt-1 border-l-2 border-amber-100/50 dark:border-amber-900/30 pl-3">
                    {[
                      { label: `Commission (${commissionPercent}%)`, value: directCommission },
                      { label: `Commission Burden (${burdenPercent}%)`, value: commissionBurden },
                    ].map((sub) => (
                      <div key={sub.label} className="flex justify-between items-center py-0.5">
                        <span className="text-xs text-muted-foreground">{sub.label}</span>
                        <span className="text-xs font-mono text-muted-foreground">{formatCurrency(sub.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">Other Costs</h4>
                <div className="flex items-center justify-between p-2.5 rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                    <span className="text-sm text-foreground">Finance Fee ({financingFeePercent}%)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground font-medium">
                      ({formatPercent(totalPrice > 0 ? (financingFee / totalPrice) * 100 : 0)})
                    </span>
                    <span className="font-mono text-sm font-medium text-muted-foreground">
                      {formatCurrency(financingFee)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </RevealPriceGate>
        </div>
      </div>
    </div>
  );
}
