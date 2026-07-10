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
import { RefreshCw, Target, Loader2 } from "lucide-react";
import { toPng } from "html-to-image";
import { useToast } from "@/hooks/use-toast";

export default function RepairGMCalculator() {
  const { settings, isLoading: settingsLoading } = useSettings();
  const { toast } = useToast();
  const { isPriceGated } = useAuth();
  const createQuote = useCreateQuote();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const [partsCost, setPartsCost] = useState("");
  const [salesTaxPercent, setSalesTaxPercent] = useState("6.35");
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [laborMode, setLaborMode] = useState<"dollars" | "percent">("dollars");
  const [laborRate, setLaborRate] = useState("175.00");
  const [highestTechRate, setHighestTechRate] = useState("");
  const [laborHours, setLaborHours] = useState("");
  const [numTechs, setNumTechs] = useState("1");
  const [burdenPercent, setBurdenPercent] = useState("20.00");
  const [commissionPercent, setCommissionPercent] = useState("10.00");
  const [financingFeePercent, setFinancingFeePercent] = useState("4.00");
  const [targetGm, setTargetGm] = useState("");
  const [roundUp, setRoundUp] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);

  useEffect(() => {
    if (settings && !hasInitialized) {
      setSalesTaxPercent(settings.salesTaxPercent || "6.35");
      const defaultHighestTechRate = parseFloat(settings.highestTechRate || "0") || 0;
      if (defaultHighestTechRate > 0) {
        setHighestTechRate(defaultHighestTechRate.toFixed(2));
        setLaborRate((defaultHighestTechRate * 3.5).toFixed(2));
      } else {
        setLaborRate(settings.laborHourlyRate || "175.00");
      }
      setBurdenPercent(settings.laborBurdenPercent || "20.00");
      setCommissionPercent(settings.commissionPercent || "10.00");
      setFinancingFeePercent(settings.financingFeePercent || "4.00");
      setTargetGm((parseFloat(settings.grossMarginMinPercent || "52") + 10).toFixed(1));
      setHasInitialized(true);
    }
  }, [settings, hasInitialized]);

  const resetInputs = () => {
    setPartsCost("");
    setLaborHours("");
    setNumTechs("1");
    setLaborMode("dollars");
    setSalesTaxPercent(settings?.salesTaxPercent || "6.35");
    const defaultHighestTechRate = parseFloat(settings?.highestTechRate || "0") || 0;
    if (defaultHighestTechRate > 0) {
      setHighestTechRate(defaultHighestTechRate.toFixed(2));
      setLaborRate((defaultHighestTechRate * 3.5).toFixed(2));
    } else {
      setHighestTechRate("");
      setLaborRate(settings?.laborHourlyRate || "175.00");
    }
    setBurdenPercent(settings?.laborBurdenPercent || "20.00");
    setCommissionPercent(settings?.commissionPercent || "10.00");
    setFinancingFeePercent(settings?.financingFeePercent || "4.00");
    setTargetGm((parseFloat(settings?.grossMarginMinPercent || "52") + 10).toFixed(1));
    setRoundUp(false);
  };

  const partsVal = parseFloat(partsCost) || 0;
  const laborRateVal = parseFloat(laborRate) || 0;
  const highestTechRateVal = parseFloat(highestTechRate) || 0;
  const effectiveLaborRate = highestTechRateVal > 0 ? highestTechRateVal : laborRateVal;
  const hoursVal = parseFloat(laborHours) || 0;
  const numTechsVal = Math.max(1, parseFloat(numTechs) || 1);
  const burdenRate = (parseFloat(burdenPercent) || 0) / 100;
  const taxRate = (parseFloat(salesTaxPercent) || 0) / 100;
  const commissionRate = (parseFloat(commissionPercent) || 0) / 100;
  const financingRate = (parseFloat(financingFeePercent) || 0) / 100;
  const targetGmVal = parseFloat(targetGm) || 0;
  const g = targetGmVal / 100;

  const [results, setResults] = useState({
    price: 0,
    estimatedLabor: 0,
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
    const totalParts = partsVal + tax;
    const c = commissionRate * (1 + burdenRate);
    const f = financingRate;

    let price = 0;
    let laborCost = 0;

    if (laborMode === "dollars") {
      laborCost = hoursVal * numTechsVal * effectiveLaborRate * (1 + burdenRate);
      const denom = 1 - g - c - f;
      if (denom > 0) {
        price = (totalParts + laborCost) / denom;
      }
    } else {
      laborCost = 0;
      const denom = 1 - g - c - f;
      if (denom > 0) {
        price = totalParts / denom;
      }
    }

    if (roundUp) price = Math.ceil(price);

    const commissionCost = price * c;
    const financingCost = price * f;
    const estimatedLabor = laborCost + commissionCost + tax + financingCost;
    const totalHours = hoursVal * numTechsVal;
    const laborRate = laborMode === "dollars" && totalHours > 0
      ? (laborCost + commissionCost) / totalHours
      : 0;

    const totalAllCogs = totalParts + laborCost + commissionCost + financingCost;
    const grossMarginAmount = price - totalAllCogs;
    const grossMarginPercent = price > 0 ? (grossMarginAmount / price) * 100 : 0;
    const mePercent = price > 0 ? (totalParts / price) * 100 : 0;

    setResults({
      price,
      estimatedLabor,
      laborRate,
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
    partsVal, taxRate, laborMode, hoursVal, numTechsVal, effectiveLaborRate,
    burdenRate, commissionRate, financingRate, g, roundUp,
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
    });
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
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={resetInputs} className="gap-2" data-testid="button-reset">
            <RefreshCw size={16} />
            Reset
          </Button>
          <Button variant="outline" onClick={downloadImage} className="gap-2" data-testid="button-download-png">
            Export PNG
          </Button>
        </div>
      </div>

      {/* Target GM% banner */}
      <div className="flex items-center gap-4 bg-primary/5 border border-primary/20 rounded-xl px-5 py-4">
        <Target size={28} className="text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-primary uppercase tracking-wider">Target GM</p>
          <p className="text-sm text-muted-foreground">From your Settings — the selling price is solved to hit this margin exactly.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative group">
            <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none text-xs font-mono">%</div>
            <Input
              type="number"
              step="0.1"
              min="1"
              max="99"
              value={targetGm}
              onChange={(e) => setTargetGm(e.target.value)}
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
                <p className="text-[10px] text-muted-foreground">
                  Leave blank to use the Labor Rate above for the GM calculation
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
            </div>
          </div>
        </div>

        {/* Results Column */}
        <div className="lg:col-span-9 space-y-3" ref={resultsRef}>
          <RevealPriceGate locked={locked} onReveal={handleReveal} isSaving={createQuote.isPending}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="col-span-2 bg-primary/5 border border-primary/20 rounded-xl p-4 flex flex-col justify-center">
                <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1">Selling Price</p>
                <p className="text-3xl font-bold text-primary" data-testid="text-selling-price">
                  {results.price > 0 ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(results.price) : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Solved to hit {targetGm || "—"}% GM</p>
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
              salesTaxRate={salesTaxPercent}
              roundUp={roundUp}
              onRoundUpChange={setRoundUp}
              grossMarginMinPercent={targetGmVal}
              laborBreakdown={
                laborMode === "dollars" && hoursVal > 0
                  ? {
                      hours: hoursVal,
                      numTechs: numTechsVal,
                      hourlyRate: effectiveLaborRate,
                      burdenPercent: parseFloat(burdenPercent) || 0,
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
