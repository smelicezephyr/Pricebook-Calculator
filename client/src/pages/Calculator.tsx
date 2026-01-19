import { useState, useEffect } from "react";
import { useSettings } from "@/hooks/use-settings";
import { useCreateQuote } from "@/hooks/use-quotes";
import { InputMoney } from "@/components/InputMoney";
import { ResultsCard } from "@/components/ResultsCard";
import { Button } from "@/components/ui/button";
import { Save, RefreshCw, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Calculator() {
  const { settings, isLoading: settingsLoading } = useSettings();
  const createQuote = useCreateQuote();
  
  // Input State
  const [materials, setMaterials] = useState<string>("");
  const [equipment, setEquipment] = useState<string>("");
  const [laborHours, setLaborHours] = useState<string>("10");
  
  // Save Dialog State
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [quoteTitle, setQuoteTitle] = useState("");

  // Derived Values
  const matVal = parseFloat(materials) || 0;
  const equipVal = parseFloat(equipment) || 0;
  const hoursVal = parseFloat(laborHours) || 0;

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

    // 2. Calculate Price
    const targetMeRate = parseFloat(settings.targetMePercent) / 100;
    // Avoid division by zero
    const price = targetMeRate > 0 ? totalMe / targetMeRate : 0;

    // 3. Calculate Commission Cost
    const commissionRate = parseFloat(settings.commissionPercent) / 100;
    const commissionBurdenRate = parseFloat(settings.commissionBurdenPercent) / 100;
    const commissionCost = (price * commissionRate) * (1 + commissionBurdenRate);

    // 4. Calculate Financing Cost
    const financingRate = parseFloat(settings.financingFeePercent) / 100;
    const financingCost = price * financingRate;

    // 5. Estimated Labor (The Output)
    const estimatedLabor = price - totalMe - commissionCost - financingCost;

    // 6. Labor Cost (For Margin Calculation)
    let laborCost = 0;
    if (settings.laborMode === 'hours') {
      const hourlyRate = parseFloat(settings.laborHourlyRate);
      const laborBurdenRate = parseFloat(settings.laborBurdenPercent) / 100;
      laborCost = (hoursVal * hourlyRate) * (1 + laborBurdenRate);
    } else {
      const laborPercentRate = parseFloat(settings.laborPercent) / 100;
      laborCost = price * laborPercentRate;
    }

    // 7. Gross Margin
    const grossMarginAmount = price - (totalMe + commissionCost + financingCost + laborCost);
    const grossMarginPercent = price > 0 ? (grossMarginAmount / price) * 100 : 0;
    const mePercent = price > 0 ? (totalMe / price) * 100 : 0;

    setResults({
      price,
      estimatedLabor,
      breakdown: {
        materials: matVal,
        equipment: equipVal,
        tax,
        commission: commissionCost,
        financing: financingCost,
        laborCost,
      },
      metrics: {
        grossMarginPercent,
        grossMarginAmount,
        mePercent,
      }
    });

  }, [matVal, equipVal, hoursVal, settings]);

  const handleSave = () => {
    if (!settings) return;
    
    createQuote.mutate({
      title: quoteTitle || "Untitled Quote",
      materialsCost: matVal.toString(),
      equipmentCost: equipVal.toString(),
      laborHoursInput: hoursVal.toString(),
      calculatedPrice: results.price.toFixed(2),
      calculatedGrossMargin: results.metrics.grossMarginPercent.toFixed(2),
      calculatedEstimatedLabor: results.estimatedLabor.toFixed(2),
      calculatedMePercent: results.metrics.mePercent.toFixed(2),
    }, {
      onSuccess: () => {
        setIsSaveOpen(false);
        setQuoteTitle("");
      }
    });
  };

  const resetInputs = () => {
    setMaterials("");
    setEquipment("");
    setLaborHours("10");
  };

  if (settingsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Calculator</h1>
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
                Save Quote
              </Button>
            </DialogTrigger>
            <DialogContent>
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
                <div className="bg-muted p-4 rounded-lg space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Price:</span>
                    <span className="font-bold">${results.price.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Est. Labor:</span>
                    <span className="font-bold text-emerald-600">${results.estimatedLabor.toFixed(2)}</span>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsSaveOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={createQuote.isPending}>
                  {createQuote.isPending ? "Saving..." : "Save to History"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Input Column */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-card rounded-2xl p-6 shadow-sm border border-border">
            <h2 className="font-display font-semibold text-lg mb-6 flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">1</span>
              Job Costs
            </h2>
            
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex justify-between items-end">
                  <Label className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Target M&E %
                  </Label>
                  <span className="text-sm font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                    {settings.targetMePercent}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  The calculator uses this target to determine the total price.
                </p>
              </div>

              <InputMoney
                label="Materials Cost"
                placeholder="0.00"
                value={materials}
                onChange={(e) => setMaterials(e.target.value)}
              />
              <InputMoney
                label="Equipment Cost"
                placeholder="0.00"
                value={equipment}
                onChange={(e) => setEquipment(e.target.value)}
              />
              
              {settings.laborMode === 'hours' && (
                <div className="pt-4 border-t border-border">
                  <InputMoney
                    label="Labor Hours"
                    type="number"
                    placeholder="10"
                    value={laborHours}
                    onChange={(e) => setLaborHours(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Using rate of ${parseFloat(settings.laborHourlyRate).toFixed(2)}/hr
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Results Column */}
        <div className="lg:col-span-8">
          <div className="space-y-6">
            <ResultsCard 
              price={results.price}
              estimatedLabor={results.estimatedLabor}
              breakdown={results.breakdown}
              metrics={results.metrics}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
