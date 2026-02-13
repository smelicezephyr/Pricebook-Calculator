import { useState, useEffect, useRef } from "react";
import { useSettings } from "@/hooks/use-settings";
import { useCreateQuote } from "@/hooks/use-quotes";
import { useCalculatorState } from "@/contexts/CalculatorContext";
import { InputMoney } from "@/components/InputMoney";
import { ResultsCard } from "@/components/ResultsCard";
import { Button } from "@/components/ui/button";
import { Save, RefreshCw, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toPng } from "html-to-image";
import { useToast } from "@/hooks/use-toast";

export default function Calculator() {
  const { settings, isLoading: settingsLoading } = useSettings();
  const createQuote = useCreateQuote();
  const { toast } = useToast();
  const resultsRef = useRef<HTMLDivElement>(null);
  const { state: calcState, setState: setCalcState, resetState } = useCalculatorState();
  const [hasInitialized, setHasInitialized] = useState(false);

  // Destructure calculator state for easier access
  const { materials, equipment, laborHours, laborPercent, targetMe, discount, discountMode, subcontractor, crane, permit, roundUp, oemRebate, utilityRebate } = calcState;

  const setMaterials = (v: string) => setCalcState({ materials: v });
  const setEquipment = (v: string) => setCalcState({ equipment: v });
  const setLaborHours = (v: string) => setCalcState({ laborHours: v });
  const setLaborPercent = (v: string) => setCalcState({ laborPercent: v });
  const setTargetMe = (v: string) => setCalcState({ targetMe: v });
  const setDiscount = (v: string) => setCalcState({ discount: v });
  const setDiscountMode = (v: "dollar" | "percent") => setCalcState({ discountMode: v });
  const setSubcontractor = (v: string) => setCalcState({ subcontractor: v });
  const setCrane = (v: string) => setCalcState({ crane: v });
  const setPermit = (v: string) => setCalcState({ permit: v });
  const setRoundUp = (v: boolean) => setCalcState({ roundUp: v });
  const setOemRebate = (v: string) => setCalcState({ oemRebate: v });
  const setUtilityRebate = (v: string) => setCalcState({ utilityRebate: v });

  // Initialize defaults from settings only once on first load (not on every settings change)
  useEffect(() => {
    if (settings && !hasInitialized) {
      // Only set defaults if the fields are empty (first load)
      if (!calcState.targetMe || calcState.targetMe === "23.0") {
        setCalcState({ targetMe: parseFloat(settings.targetMePercent).toFixed(1) });
      }
      if (!calcState.laborPercent) {
        setCalcState({ laborPercent: settings.laborPercent || "" });
      }
      setHasInitialized(true);
    }
  }, [settings, hasInitialized, calcState.targetMe, calcState.laborPercent, setCalcState]);

  // Save Dialog State
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [quoteTitle, setQuoteTitle] = useState("");

  // Derived Values
  const matVal = parseFloat(materials) || 0;
  const equipVal = parseFloat(equipment) || 0;
  const hoursVal = parseFloat(laborHours) || 0;
  const subVal = parseFloat(subcontractor) || 0;
  const craneVal = parseFloat(crane) || 0;
  const permitVal = parseFloat(permit) || 0;

  // Calculation State
  const [results, setResults] = useState({
    price: 0,
    estimatedLabor: 0,
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
    }
  });

  // Effect to run calculations whenever inputs or settings change
  useEffect(() => {
    if (!settings) return;

    // 1. Calculate Tax & M&E
    const salesTaxRate = parseFloat(settings.salesTaxPercent) / 100;
    const tax = (matVal + equipVal) * salesTaxRate;
    const totalMe = matVal + equipVal + tax;

    // 2. Calculate Base Price
    const targetMeRate = (parseFloat(targetMe) || 0) / 100;
    const basePrice = targetMeRate > 0 ? totalMe / targetMeRate : 0;

    // 3. Other COGS are added to final price like discount removal
    const totalOtherCogs = subVal + craneVal + permitVal;
    const discountInput = parseFloat(discount) || 0;
    
    // Calculate discount based on mode: dollar or percent of total price
    // For percent mode, we need to solve: finalPrice = basePrice + otherCogs - (finalPrice * discountPercent/100)
    // Rearranging: finalPrice * (1 + discountPercent/100) = basePrice + otherCogs
    // finalPrice = (basePrice + otherCogs) / (1 + discountPercent/100)
    // discountVal = (basePrice + otherCogs) - finalPrice
    const priceBeforeDiscount = basePrice + totalOtherCogs;
    const discountVal = discountMode === 'percent' 
      ? priceBeforeDiscount * discountInput / 100
      : discountInput;
    
    // Price = basePrice + otherCogs - discount
    const price = Math.max(0, basePrice + totalOtherCogs - discountVal);

    // 4. Calculate Commission Cost
    const commissionRate = parseFloat(settings.commissionPercent) / 100;
    const commissionBurdenRate = parseFloat(settings.commissionBurdenPercent) / 100;
    const commissionCost = (price * commissionRate) * (1 + commissionBurdenRate);

    // 5. Calculate Financing Cost
    const financingRate = parseFloat(settings.financingFeePercent) / 100;
    const financingCost = price * financingRate;

    // 6. Labor Cost (For Margin Calculation)
    let laborCost = 0;
    const laborMode = settings.laborMode || 'percent';
    const laborBurdenRate = parseFloat(settings.laborBurdenPercent) / 100;

    if (laborMode === 'hours') {
      const hourlyRate = parseFloat(settings.laborHourlyRate);
      laborCost = (hoursVal * hourlyRate) * (1 + laborBurdenRate);
    } else {
      const laborPercentRate = (parseFloat(laborPercent) || 0) / 100;
      // Apply burden to the percentage-based labor as well
      laborCost = (price * laborPercentRate) * (1 + laborBurdenRate);
    }

    // 7. Estimated Labor (The Output)
    const estimatedLabor = laborCost + commissionCost + tax + financingCost;

    // 8. Gross Margin - use displayPrice (rounded or not) for final metrics
    const displayPrice = roundUp ? Math.ceil(price) : price;
    const totalAllCogs = totalMe + commissionCost + financingCost + laborCost + totalOtherCogs;
    const oemRebateVal = parseFloat(oemRebate) || 0;
    const utilityRebateVal = parseFloat(utilityRebate) || 0;
    const effectiveRevenue = displayPrice + oemRebateVal + utilityRebateVal;
    const grossMarginAmount = effectiveRevenue - totalAllCogs;
    const grossMarginPercent = effectiveRevenue > 0 ? (grossMarginAmount / effectiveRevenue) * 100 : 0;
    const mePercent = displayPrice > 0 ? (totalMe / displayPrice) * 100 : 0;

    setResults({
      price: displayPrice,
      estimatedLabor,
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
      metrics: {
        grossMarginPercent,
        grossMarginAmount,
        mePercent,
      }
    });

  }, [matVal, equipVal, hoursVal, laborPercent, discount, discountMode, targetMe, subVal, craneVal, permitVal, settings, roundUp, oemRebate, utilityRebate]);

  const downloadImage = async () => {
    if (resultsRef.current === null) return;

    try {
      const dataUrl = await toPng(resultsRef.current, { cacheBust: true, backgroundColor: "#fff" });
      const link = document.createElement('a');
      link.download = `${quoteTitle || 'quote'}-${new Date().toISOString().split('T')[0]}.png`;
      link.href = dataUrl;
      link.click();
      toast({
        title: "Image Saved",
        description: "The quote image has been downloaded successfully.",
      });
    } catch (err) {
      console.error('Error saving image:', err);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to save the image.",
      });
    }
  };

  const handleSave = async () => {
    if (!settings) return;

    createQuote.mutate({
      title: quoteTitle || "Untitled Quote",
      materialsCost: matVal.toString(),
      equipmentCost: equipVal.toString(),
      laborHoursInput: settings.laborMode === 'hours' ? hoursVal.toString() : laborPercent,
      calculatedPrice: results.price.toFixed(2),
      calculatedGrossMargin: results.metrics.grossMarginPercent.toFixed(2),
      calculatedEstimatedLabor: results.estimatedLabor.toFixed(2),
      calculatedMePercent: targetMe,
      subcontractorCost: subVal.toString(),
      craneCost: craneVal.toString(),
      permitCost: permitVal.toString(),
    }, {
      onSuccess: async () => {
        await downloadImage();
        setIsSaveOpen(false);
        setQuoteTitle("");
      }
    });
  };

  const resetInputs = () => {
    if (settings) {
      resetState({
        targetMe: parseFloat(settings.targetMePercent).toFixed(1),
        laborPercent: settings.laborPercent || "",
      });
    }
  };

  if (settingsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!settings) return null;

  // Generate target M&E options: 15% to 25% with 0.5% intervals
  const targetMeOptions = [];
  for (let i = 15; i <= 25; i += 0.5) {
    targetMeOptions.push(i.toFixed(1));
  }

  const formatCurrency = (val: number) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

  // Calculate actual discount dollar amount based on mode
  const calculateDiscountDollar = () => {
    const discountInput = parseFloat(discount) || 0;
    if (discountMode === 'percent') {
      // Calculate the price before discount to get the percent discount amount
      const salesTaxRate = parseFloat(settings.salesTaxPercent) / 100;
      const totalMe = matVal + equipVal + (matVal + equipVal) * salesTaxRate;
      const targetMeRate = (parseFloat(targetMe) || 0) / 100;
      const basePrice = targetMeRate > 0 ? totalMe / targetMeRate : 0;
      const totalOtherCogs = subVal + craneVal + permitVal;
      const priceBeforeDiscount = basePrice + totalOtherCogs;
      return priceBeforeDiscount * discountInput / 100;
    }
    return discountInput;
  };
  const discountDollarValue = calculateDiscountDollar();
  
  // Calculate price before discount for helper text
  const getPriceBeforeDiscount = () => {
    const salesTaxRate = parseFloat(settings.salesTaxPercent) / 100;
    const totalMe = matVal + equipVal + (matVal + equipVal) * salesTaxRate;
    const targetMeRate = (parseFloat(targetMe) || 0) / 100;
    const basePrice = targetMeRate > 0 ? totalMe / targetMeRate : 0;
    const totalOtherCogs = subVal + craneVal + permitVal;
    return basePrice + totalOtherCogs;
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Complete System Calculator</h1>
          <p className="text-muted-foreground mt-1">Estimate pricing and labor for HVAC installations.</p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={resetInputs} className="gap-2">
            <RefreshCw size={16} />
            Reset
          </Button>

          <Dialog open={isSaveOpen} onOpenChange={setIsSaveOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 shadow-lg shadow-primary/20 hover:shadow-primary/30">
                <Save size={16} />
                Save Calc
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Save Quote</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Quote Title</Label>
                  <Input
                    placeholder="e.g. Smith Residence - 3 Ton Unit"
                    value={quoteTitle}
                    onChange={(e) => setQuoteTitle(e.target.value)}
                  />
                </div>
                <div className="bg-muted p-4 rounded-lg space-y-3 text-sm">
                  <div className="space-y-1 pb-2 border-b border-border/50">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">M&E Breakdown</p>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Materials:</span>
                      <span className="font-medium">{formatCurrency(matVal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Equipment:</span>
                      <span className="font-medium">{formatCurrency(equipVal)}</span>
                    </div>
                  </div>
                  
                  {discountDollarValue > 0 && (
                    <div className="flex justify-between text-destructive">
                      <span className="font-medium">Discount{discountMode === 'percent' ? ` (${discount}%)` : ''}:</span>
                      <span className="font-bold">-{formatCurrency(discountDollarValue)}</span>
                    </div>
                  )}

                  <div className="pt-2 flex justify-between items-baseline">
                    <span className="text-muted-foreground font-bold">Total Price:</span>
                    <span className="text-xl font-bold text-primary">${results.price.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-baseline border-t border-border/50 pt-2">
                    <span className="text-muted-foreground font-bold">Est. Labor Field:</span>
                    <span className="text-lg font-bold text-emerald-600">${results.estimatedLabor.toFixed(2)}</span>
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Input Column */}
        <div className="lg:col-span-3 space-y-2">
          {/* Job Costs Section */}
          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">1</span>
              <h2 className="font-display font-semibold text-sm">Job Costs</h2>
            </div>

            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Target M&E %
                </Label>
                <select
                  value={targetMe}
                  onChange={(e) => setTargetMe(e.target.value)}
                  data-testid="select-target-me"
                  className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-2.5 py-1.5 text-sm font-medium ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {targetMeOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}%
                    </option>
                  ))}
                </select>
              </div>

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
            </div>
          </div>

          {/* Labor Section */}
          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-blue-500/10 text-blue-600 flex items-center justify-center text-[10px] font-bold">2</span>
              <h2 className="font-display font-semibold text-sm">Labor</h2>
            </div>

            {(settings.laborMode || 'percent') === 'hours' ? (
              <div className="space-y-2">
                <InputMoney
                  label="Labor Hours"
                  type="number"
                  placeholder="10"
                  value={laborHours}
                  onChange={(e) => setLaborHours(e.target.value)}
                  data-testid="input-labor-hours"
                />
                <p className="text-xs text-muted-foreground">
                  Using rate of ${parseFloat(settings.laborHourlyRate).toFixed(2)}/hr
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Labor %
                </Label>
                <div className="relative group">
                  <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none group-focus-within:text-primary transition-colors">
                    <span className="text-xs font-mono">%</span>
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    value={laborPercent}
                    onChange={(e) => setLaborPercent(e.target.value)}
                    data-testid="input-labor-percent"
                    className="pl-8 h-9 text-sm font-medium bg-background border-border shadow-sm transition-all focus:ring-primary/20"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Other COGS Section */}
          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-amber-500/10 text-amber-600 flex items-center justify-center text-[10px] font-bold">3</span>
              <h2 className="font-display font-semibold text-sm">Other COGS</h2>
            </div>

            <div className="space-y-2">
              <InputMoney
                label="Subcontractor"
                placeholder="0.00"
                value={subcontractor}
                onChange={(e) => setSubcontractor(e.target.value)}
                data-testid="input-subcontractor"
              />
              <InputMoney
                label="Crane"
                placeholder="0.00"
                value={crane}
                onChange={(e) => setCrane(e.target.value)}
                data-testid="input-crane"
              />
              <InputMoney
                label="Permit"
                placeholder="0.00"
                value={permit}
                onChange={(e) => setPermit(e.target.value)}
                data-testid="input-permit"
              />
            </div>
          </div>

          {/* Discounts Section */}
          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-red-500/10 text-red-600 flex items-center justify-center text-[10px] font-bold">4</span>
              <h2 className="font-display font-semibold text-sm">Discounts</h2>
            </div>

            <div className="space-y-2">
              <div className="flex gap-1 p-1 bg-muted rounded-lg">
                <button
                  type="button"
                  onClick={() => setDiscountMode("dollar")}
                  data-testid="button-discount-dollar"
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                    discountMode === "dollar"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  $ Dollar
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountMode("percent")}
                  data-testid="button-discount-percent"
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                    discountMode === "percent"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  % of Total
                </button>
              </div>

              {discountMode === "dollar" ? (
                <InputMoney
                  label="Discount Amount"
                  placeholder="0.00"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  data-testid="input-discount-dollar"
                />
              ) : (
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Discount %
                  </Label>
                  <div className="relative group">
                    <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none group-focus-within:text-primary transition-colors">
                      <span className="text-xs font-mono">%</span>
                    </div>
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="0"
                      value={discount}
                      onChange={(e) => setDiscount(e.target.value)}
                      data-testid="input-discount-percent"
                      className="pl-8 h-9 text-sm font-medium bg-background border-border shadow-sm transition-all focus:ring-primary/20"
                    />
                  </div>
                  {parseFloat(discount) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      = {formatCurrency(discountDollarValue)} off {formatCurrency(getPriceBeforeDiscount())} total
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Rebates Section */}
        <div className="lg:col-span-6">
          <div className="bg-card rounded-lg border p-3">
            <div className="space-y-3">
              <h2 className="font-display font-semibold text-sm">Rebates</h2>
              <InputMoney
                label="OEM Rebate"
                placeholder="0.00"
                value={oemRebate}
                onChange={(e) => setOemRebate(e.target.value)}
                data-testid="input-oem-rebate"
              />
              <InputMoney
                label="Utility Rebate"
                placeholder="0.00"
                value={utilityRebate}
                onChange={(e) => setUtilityRebate(e.target.value)}
                data-testid="input-utility-rebate"
              />
            </div>
          </div>
        </div>

        {/* Results Column */}
        <div className="lg:col-span-9" ref={resultsRef}>
          <div className="space-y-3 bg-background p-2 rounded-lg">
            <ResultsCard
              price={results.price}
              estimatedLabor={results.estimatedLabor}
              breakdown={results.breakdown}
              metrics={results.metrics}
              salesTaxRate={settings.salesTaxPercent}
              discount={discountDollarValue}
              roundUp={roundUp}
              onRoundUpChange={setRoundUp}
              grossMarginMinPercent={parseFloat(settings.grossMarginMinPercent || "45")}
              oemRebate={parseFloat(oemRebate) || 0}
              utilityRebate={parseFloat(utilityRebate) || 0}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
