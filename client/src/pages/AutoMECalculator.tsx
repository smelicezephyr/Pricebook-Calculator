import { useState, useEffect } from "react";
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
import { RefreshCw, Target } from "lucide-react";

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);

const formatPercent = (val: number) => `${val.toFixed(2)}%`;

export default function AutoMECalculator() {
  const { settings, isLoading: settingsLoading } = useSettings();
  const { isPriceGated } = useAuth();
  const createQuote = useCreateQuote();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  const [materials, setMaterials] = useState("");
  const [equipment, setEquipment] = useState("");
  const [salesTaxPercent, setSalesTaxPercent] = useState("6.35");
  const [selectedTenantId, setSelectedTenantId] = useState<number | null>(null);
  const [laborMode, setLaborMode] = useState<"hours" | "percent">("percent");
  const [laborHours, setLaborHours] = useState("");
  const [numTechs, setNumTechs] = useState("1");
  const [laborPercent, setLaborPercent] = useState("");
  const [subcontractor, setSubcontractor] = useState("");
  const [crane, setCrane] = useState("");
  const [permit, setPermit] = useState("");
  const [oemRebate, setOemRebate] = useState("");
  const [utilityRebate, setUtilityRebate] = useState("");
  const [targetGm, setTargetGm] = useState("");
  const [commissionPercent, setCommissionPercent] = useState("");
  const [financingFeePercent, setFinancingFeePercent] = useState("");
  const [roundUp, setRoundUp] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);

  useEffect(() => {
    if (settings && !hasInitialized) {
      setSalesTaxPercent(settings.salesTaxPercent || "6.35");
      setLaborMode((settings.laborMode as "hours" | "percent") || "percent");
      setLaborPercent(settings.laborPercent || "");
      setTargetGm(parseFloat(settings.grossMarginMinPercent || "52").toFixed(1));
      setCommissionPercent(parseFloat(settings.commissionPercent).toFixed(2));
      setFinancingFeePercent(parseFloat(settings.financingFeePercent).toFixed(2));
      setHasInitialized(true);
    }
  }, [settings, hasInitialized]);

  const resetInputs = () => {
    setMaterials("");
    setEquipment("");
    setSubcontractor("");
    setCrane("");
    setPermit("");
    setOemRebate("");
    setUtilityRebate("");
    setLaborHours("");
    setNumTechs("1");
    setLaborPercent(settings?.laborPercent || "");
    setSalesTaxPercent(settings?.salesTaxPercent || "6.35");
    setLaborMode((settings?.laborMode as "hours" | "percent") || "percent");
    setTargetGm(parseFloat(settings?.grossMarginMinPercent || "52").toFixed(1));
    setCommissionPercent(parseFloat(settings?.commissionPercent || "10").toFixed(2));
    setFinancingFeePercent(parseFloat(settings?.financingFeePercent || "4").toFixed(2));
    setRoundUp(false);
  };

  const matVal = parseFloat(materials) || 0;
  const equipVal = parseFloat(equipment) || 0;
  const hoursVal = parseFloat(laborHours) || 0;
  const numTechsVal = Math.max(1, parseFloat(numTechs) || 1);
  const subVal = parseFloat(subcontractor) || 0;
  const craneVal = parseFloat(crane) || 0;
  const permitVal = parseFloat(permit) || 0;
  const oemRebateVal = parseFloat(oemRebate) || 0;
  const utilityRebateVal = parseFloat(utilityRebate) || 0;
  const targetGmVal = parseFloat(targetGm) || 0;

  const [results, setResults] = useState({
    price: 0,
    estimatedLabor: 0,
    directLaborCost: 0,
    laborRate: 0,
    computedMePercent: 0,
    breakdown: {
      materials: 0,
      equipment: 0,
      tax: 0,
      commission: 0,
      financing: 0,
      laborCost: 0,
      subcontractor: 0,
      crane: 0,
      permit: 0,
    },
    metrics: {
      grossMarginPercent: 0,
      grossMarginAmount: 0,
      mePercent: 0,
    },
  });

  useEffect(() => {
    if (!settings) return;

    const salesTaxRate = parseFloat(salesTaxPercent) / 100;
    const tax = (matVal + equipVal) * salesTaxRate;
    const totalMe = matVal + equipVal + tax;

    const commissionRate = parseFloat(commissionPercent) / 100;
    const commissionBurdenRate = parseFloat(settings.commissionBurdenPercent) / 100;
    const c = commissionRate * (1 + commissionBurdenRate);

    const f = parseFloat(financingFeePercent) / 100;
    const laborBurdenRate = parseFloat(settings.laborBurdenPercent) / 100;

    const otherCogs = subVal + craneVal + permitVal;
    const rebates = oemRebateVal + utilityRebateVal;
    const g = targetGmVal / 100;

    let price = 0;
    let laborCost = 0;
    let directLaborCost = 0;

    // Other COGS (subcontractor/crane/permit) are pass-through costs added
    // after the margin solve — they do not factor into the target GM% math.
    if (laborMode === "hours") {
      const hourlyRate = parseFloat(settings.laborHourlyRate) || 0;
      directLaborCost = hoursVal * numTechsVal * hourlyRate;
      laborCost = directLaborCost * (1 + laborBurdenRate);
      // price × (1 - g - c - f) = M + L - R×(1-g)
      const denom = 1 - g - c - f;
      if (denom > 0) {
        price = (totalMe + laborCost - rebates * (1 - g)) / denom;
      }
    } else {
      const lp = ((parseFloat(laborPercent) || 0) / 100) * (1 + laborBurdenRate);
      // price × (1 - g - c - f - lp) = M - R×(1-g)
      const denom = 1 - g - c - f - lp;
      if (denom > 0) {
        price = (totalMe - rebates * (1 - g)) / denom;
      }
      laborCost = price * lp;
      directLaborCost = price * ((parseFloat(laborPercent) || 0) / 100);
    }

    const commissionCost = price * c;
    const financingCost = price * f;

    price += otherCogs;

    if (roundUp) price = Math.ceil(price);

    const estimatedLabor = laborCost + commissionCost + tax + financingCost;
    const totalHours = hoursVal * numTechsVal;
    const laborRate = laborMode === "hours" && totalHours > 0
      ? (laborCost + commissionCost) / totalHours
      : 0;

    const effectiveRevenue = price + rebates;
    const totalAllCogs = totalMe + laborCost + commissionCost + financingCost + otherCogs;
    const grossMarginAmount = effectiveRevenue - totalAllCogs;
    const grossMarginPercent = effectiveRevenue > 0 ? (grossMarginAmount / effectiveRevenue) * 100 : 0;
    const mePercent = price > 0 ? (totalMe / price) * 100 : 0;

    setResults({
      price,
      estimatedLabor,
      directLaborCost,
      laborRate,
      computedMePercent: mePercent,
      breakdown: {
        materials: matVal,
        equipment: equipVal,
        tax,
        commission: commissionCost,
        financing: financingCost,
        laborCost,
        subcontractor: subVal,
        crane: craneVal,
        permit: permitVal,
      },
      metrics: { grossMarginPercent, grossMarginAmount, mePercent },
    });
  }, [
    matVal, equipVal, salesTaxPercent, laborMode, hoursVal, numTechsVal,
    laborPercent, subVal, craneVal, permitVal, oemRebateVal, utilityRebateVal,
    targetGmVal, settings, roundUp, commissionPercent, financingFeePercent,
  ]);

  if (settingsLoading || !settings) return null;

  const priceKey = results.price.toFixed(2);
  const locked = isPriceGated && revealedKey !== priceKey;

  const handleReveal = async (jobNumber: string, customerName: string) => {
    await createQuote.mutateAsync({
      title: jobNumber,
      customerName: customerName || null,
      materialsCost: matVal.toString(),
      equipmentCost: equipVal.toString(),
      laborHoursInput: laborMode === "hours" ? hoursVal.toString() : "0",
      calculatedPrice: results.price.toFixed(2),
      calculatedGrossMargin: results.metrics.grossMarginPercent.toFixed(2),
      calculatedEstimatedLabor: results.directLaborCost.toFixed(2),
      calculatedMePercent: results.computedMePercent.toFixed(2),
      calculatedLaborRate: results.laborRate > 0 ? results.laborRate.toFixed(2) : null,
      subcontractorCost: subVal.toString(),
      craneCost: craneVal.toString(),
      permitCost: permitVal.toString(),
    });
    setRevealedKey(priceKey);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">System GM Calculator</h1>
          <p className="text-muted-foreground mt-1">
            Enter your costs — the calculator finds the M&E% needed to hit your target gross margin.
          </p>
        </div>
        <Button variant="outline" onClick={resetInputs} className="gap-2 self-start md:self-auto">
          <RefreshCw size={16} />
          Reset
        </Button>
      </div>

      {/* Target GM% banner */}
      <div className="flex items-center gap-4 bg-primary/5 border border-primary/20 rounded-xl px-5 py-4">
        <Target size={28} className="text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-primary uppercase tracking-wider">Target GM</p>
          <p className="text-sm text-muted-foreground">From your Settings — all prices are solved to hit this margin exactly.</p>
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
        testIdSuffix="-auto-me"
        variant="bar"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Input Column */}
        <div className="lg:col-span-3 space-y-2">

          {/* Job Costs */}
          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">1</span>
              <h2 className="font-display font-semibold text-sm">Job Costs</h2>
            </div>
            <div className="space-y-2">
              <InputMoney
                label="Materials Cost"
                placeholder="0.00"
                value={materials}
                onChange={(e) => setMaterials(e.target.value)}
                data-testid="input-materials"
              />
              <InputMoney
                label="Equipment Cost"
                placeholder="0.00"
                value={equipment}
                onChange={(e) => setEquipment(e.target.value)}
                data-testid="input-equipment"
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
                <Label htmlFor="auto-labor-mode" className="text-xs font-medium cursor-pointer text-muted-foreground">Hourly</Label>
                <Switch
                  id="auto-labor-mode"
                  checked={laborMode === "hours"}
                  onCheckedChange={(checked) => setLaborMode(checked ? "hours" : "percent")}
                  data-testid="switch-labor-mode"
                />
              </div>
            </div>
            {laborMode === "hours" ? (
              <div className="space-y-2">
                <InputMoney
                  label="Labor Hours"
                  type="number"
                  placeholder="10"
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
                  ${parseFloat(settings.laborHourlyRate).toFixed(2)}/hr per technician
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Labor %</Label>
                <div className="relative group">
                  <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                    <span className="text-xs font-mono">%</span>
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    value={laborPercent}
                    onChange={(e) => setLaborPercent(e.target.value)}
                    data-testid="input-labor-percent"
                    className="pl-8 h-9 text-sm font-medium bg-background border-border shadow-sm"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Other COGS */}
          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-amber-500/10 text-amber-600 flex items-center justify-center text-[10px] font-bold">3</span>
              <h2 className="font-display font-semibold text-sm">Other COGS</h2>
            </div>
            <div className="space-y-2">
              <InputMoney label="Subcontractor" placeholder="0.00" value={subcontractor}
                onChange={(e) => setSubcontractor(e.target.value)} data-testid="input-subcontractor" />
              <InputMoney label="Crane" placeholder="0.00" value={crane}
                onChange={(e) => setCrane(e.target.value)} data-testid="input-crane" />
              <InputMoney label="Permit" placeholder="0.00" value={permit}
                onChange={(e) => setPermit(e.target.value)} data-testid="input-permit" />
            </div>
          </div>

          {/* Fees */}
          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-violet-500/10 text-violet-600 flex items-center justify-center text-[10px] font-bold">4</span>
              <h2 className="font-display font-semibold text-sm">Fees</h2>
            </div>
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Commission %</Label>
                <div className="relative group">
                  <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"><span className="text-xs font-mono">%</span></div>
                  <Input type="number" step="0.01" min="0" value={commissionPercent} onChange={(e) => setCommissionPercent(e.target.value)} data-testid="input-commission-percent" className="pl-8 h-9 text-sm font-medium bg-background border-border shadow-sm" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Financing Fee %</Label>
                <div className="relative group">
                  <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"><span className="text-xs font-mono">%</span></div>
                  <Input type="number" step="0.01" min="0" value={financingFeePercent} onChange={(e) => setFinancingFeePercent(e.target.value)} data-testid="input-financing-fee-percent" className="pl-8 h-9 text-sm font-medium bg-background border-border shadow-sm" />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">Burden % stays in Settings</p>
            </div>
          </div>

          {/* Rebates */}
          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-teal-500/10 text-teal-600 flex items-center justify-center text-[10px] font-bold">5</span>
              <h2 className="font-display font-semibold text-sm">Rebates</h2>
            </div>
            <div className="space-y-2">
              <InputMoney label="OEM Rebate" placeholder="0.00" value={oemRebate}
                onChange={(e) => setOemRebate(e.target.value)} data-testid="input-oem-rebate" />
              <InputMoney label="Utility Rebate" placeholder="0.00" value={utilityRebate}
                onChange={(e) => setUtilityRebate(e.target.value)} data-testid="input-utility-rebate" />
            </div>
          </div>
        </div>

        {/* Results Column */}
        <div className="lg:col-span-9 space-y-3">
          <RevealPriceGate locked={locked} onReveal={handleReveal} isSaving={createQuote.isPending}>
            {/* Computed M&E% callout */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="col-span-2 bg-primary/5 border border-primary/20 rounded-xl p-4 flex flex-col justify-center">
                <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1">Computed M&E %</p>
                <p className="text-3xl font-bold text-primary" data-testid="text-computed-me-percent">
                  {results.price > 0 ? formatPercent(results.computedMePercent) : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Required to hit {targetGm || "—"}% GM</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-center">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Selling Price</p>
                <p className="text-2xl font-bold text-foreground" data-testid="text-selling-price">
                  {results.price > 0 ? formatCurrency(results.price) : "—"}
                </p>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 flex flex-col justify-center">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">M&E Cost</p>
                <p className="text-2xl font-bold text-foreground">
                  {formatCurrency(
                    (parseFloat(materials) || 0) +
                    (parseFloat(equipment) || 0) +
                    ((parseFloat(materials) || 0) + (parseFloat(equipment) || 0)) * (parseFloat(salesTaxPercent) / 100)
                  )}
                </p>
              </div>
            </div>

            {/* Full breakdown */}
            <ResultsCard
              price={results.price}
              estimatedLabor={results.estimatedLabor}
              breakdown={results.breakdown}
              metrics={results.metrics}
              salesTaxRate={salesTaxPercent}
              roundUp={roundUp}
              onRoundUpChange={setRoundUp}
              grossMarginMinPercent={targetGmVal}
              oemRebate={oemRebateVal}
              utilityRebate={utilityRebateVal}
              laborBreakdown={
                laborMode === "hours" && hoursVal > 0
                  ? {
                      hours: hoursVal,
                      numTechs: numTechsVal,
                      hourlyRate: parseFloat(settings.laborHourlyRate),
                      burdenPercent: parseFloat(settings.laborBurdenPercent),
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
