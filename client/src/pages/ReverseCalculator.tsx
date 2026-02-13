import { useState, useEffect } from "react";
import { useSettings } from "@/hooks/use-settings";
import { useCalculatorState } from "@/contexts/CalculatorContext";
import { InputMoney } from "@/components/InputMoney";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RefreshCw, Loader2, Copy, DollarSign, TrendingUp } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { useToast } from "@/hooks/use-toast";

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

const formatPercent = (val: number) =>
  `${val.toFixed(2)}%`;

export default function ReverseCalculator() {
  const { settings, isLoading: settingsLoading } = useSettings();
  const { state: calcState } = useCalculatorState();
  const { toast } = useToast();

  const [sellingPrice, setSellingPrice] = useState("");
  const [materials, setMaterials] = useState("");
  const [equipment, setEquipment] = useState("");
  const [laborHours, setLaborHours] = useState("");
  const [laborPercent, setLaborPercent] = useState("");
  const [subcontractor, setSubcontractor] = useState("");
  const [crane, setCrane] = useState("");
  const [permit, setPermit] = useState("");
  const [discount, setDiscount] = useState("");
  const [discountMode, setDiscountMode] = useState<"dollar" | "percent">("dollar");

  const [hasInitialized, setHasInitialized] = useState(false);

  useEffect(() => {
    if (settings && !hasInitialized) {
      if (!laborPercent) {
        setLaborPercent(settings.laborPercent || "");
      }
      setHasInitialized(true);
    }
  }, [settings, hasInitialized, laborPercent]);

  const priceVal = parseFloat(sellingPrice) || 0;
  const matVal = parseFloat(materials) || 0;
  const equipVal = parseFloat(equipment) || 0;
  const hoursVal = parseFloat(laborHours) || 0;
  const subVal = parseFloat(subcontractor) || 0;
  const craneVal = parseFloat(crane) || 0;
  const permitVal = parseFloat(permit) || 0;

  const [results, setResults] = useState({
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
      estimatedLabor: 0,
    }
  });

  useEffect(() => {
    if (!settings) return;

    const salesTaxRate = parseFloat(settings.salesTaxPercent) / 100;
    const tax = (matVal + equipVal) * salesTaxRate;
    const totalMe = matVal + equipVal + tax;

    const totalOtherCogs = subVal + craneVal + permitVal;

    const discountInput = parseFloat(discount) || 0;
    const discountVal = discountMode === 'percent'
      ? priceVal * discountInput / 100
      : discountInput;

    const price = Math.max(0, priceVal - discountVal);
    const displayPrice = price;

    const commissionRate = parseFloat(settings.commissionPercent) / 100;
    const commissionBurdenRate = parseFloat(settings.commissionBurdenPercent) / 100;
    const commissionCost = (price * commissionRate) * (1 + commissionBurdenRate);

    const financingRate = parseFloat(settings.financingFeePercent) / 100;
    const financingCost = price * financingRate;

    let laborCost = 0;
    const laborMode = settings.laborMode || 'percent';
    const laborBurdenRate = parseFloat(settings.laborBurdenPercent) / 100;

    if (laborMode === 'hours') {
      const hourlyRate = parseFloat(settings.laborHourlyRate);
      laborCost = (hoursVal * hourlyRate) * (1 + laborBurdenRate);
    } else {
      const laborPercentRate = (parseFloat(laborPercent) || 0) / 100;
      laborCost = (price * laborPercentRate) * (1 + laborBurdenRate);
    }

    const estimatedLabor = laborCost + commissionCost + tax + financingCost;

    const totalAllCogs = totalMe + commissionCost + financingCost + laborCost + totalOtherCogs;
    const grossMarginAmount = displayPrice - totalAllCogs;
    const grossMarginPercent = displayPrice > 0 ? (grossMarginAmount / displayPrice) * 100 : 0;
    const mePercent = displayPrice > 0 ? (totalMe / displayPrice) * 100 : 0;

    setResults({
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
        estimatedLabor,
      }
    });
  }, [priceVal, matVal, equipVal, hoursVal, laborPercent, discount, discountMode, subVal, craneVal, permitVal, settings]);

  const handleCopyFromSystem = () => {
    setMaterials(calcState.materials || "");
    setEquipment(calcState.equipment || "");
    setLaborHours(calcState.laborHours || "");
    setLaborPercent(calcState.laborPercent || "");
    setSubcontractor(calcState.subcontractor || "");
    setCrane(calcState.crane || "");
    setPermit(calcState.permit || "");
    setDiscount(calcState.discount || "");
    setDiscountMode(calcState.discountMode || "dollar");
    toast({
      title: "Copied from System Calculator",
      description: "Materials, equipment, labor, and other costs have been imported.",
    });
  };

  const resetInputs = () => {
    setSellingPrice("");
    setMaterials("");
    setEquipment("");
    setLaborHours("");
    setLaborPercent(settings?.laborPercent || "");
    setSubcontractor("");
    setCrane("");
    setPermit("");
    setDiscount("");
    setDiscountMode("dollar");
  };

  if (settingsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!settings) return null;

  const grossMarginMinPercent = parseFloat(settings.grossMarginMinPercent || "52");

  const getMarginHealth = () => {
    const currentMargin = results.metrics.grossMarginPercent;
    const minMargin = grossMarginMinPercent;

    if (currentMargin >= minMargin) {
      return { status: 'strong', label: 'Margin Health: Strong', color: 'bg-emerald-500', glow: '0 0 8px 2px rgba(16, 185, 129, 0.6)', textColor: 'text-emerald-600' };
    } else if (currentMargin >= minMargin - 2) {
      return { status: 'caution', label: 'Margin Health: Caution', color: 'bg-amber-500', glow: '0 0 8px 2px rgba(245, 158, 11, 0.6)', textColor: 'text-amber-600' };
    } else {
      return { status: 'danger', label: 'Margin Health: Low', color: 'bg-red-500', glow: '0 0 8px 2px rgba(239, 68, 68, 0.6)', textColor: 'text-red-600' };
    }
  };

  const marginHealth = getMarginHealth();

  const discountInput = parseFloat(discount) || 0;
  const discountDollarVal = discountMode === 'percent'
    ? priceVal * discountInput / 100
    : discountInput;
  const effectivePrice = Math.max(0, priceVal - discountDollarVal);
  const displayPrice = effectivePrice;
  const mAndECost = (results.breakdown.materials || 0) + (results.breakdown.equipment || 0) + (results.breakdown.tax || 0);
  const directLaborCost = (results.breakdown.laborCost || 0) + (results.breakdown.commission || 0);
  const totalOtherCogs = (results.breakdown.financing || 0) + (results.breakdown.subcontractor || 0) + (results.breakdown.crane || 0) + (results.breakdown.permit || 0);
  const grossMargin = results.metrics.grossMarginAmount;

  const chartData = [
    { name: 'Gross Margin', value: grossMargin, color: '#f59e0b', percent: displayPrice > 0 ? (grossMargin / displayPrice) * 100 : 0 },
    { name: 'M&E', value: mAndECost, color: '#3b82f6', percent: displayPrice > 0 ? (mAndECost / displayPrice) * 100 : 0 },
    { name: 'Direct Labor', value: directLaborCost, color: '#10b981', percent: displayPrice > 0 ? (directLaborCost / displayPrice) * 100 : 0 },
    { name: 'Other COGS', value: totalOtherCogs, color: '#8b5cf6', percent: displayPrice > 0 ? (totalOtherCogs / displayPrice) * 100 : 0 },
  ].filter(d => d.value > 0);

  const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, payload }: any) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    if (payload.percent < 5) return null;

    const labelText = `${payload.percent.toFixed(2)}%`;

    return (
      <g>
        <text
          x={x}
          y={y}
          fill="white"
          stroke="#000000"
          strokeWidth={0.5}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={11}
          fontWeight="bold"
          style={{ paintOrder: 'stroke fill' }}
        >
          {labelText}
        </text>
      </g>
    );
  };

  const hasSystemCalcData = !!(calcState.materials || calcState.equipment || calcState.laborHours || calcState.laborPercent);

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground" data-testid="text-reverse-calc-title">Reverse Calculator</h1>
          <p className="text-muted-foreground mt-1">Enter a selling price to see the resulting gross margin.</p>
        </div>

        <div className="flex gap-2 flex-wrap">
          {hasSystemCalcData && (
            <Button variant="outline" onClick={handleCopyFromSystem} className="gap-2" data-testid="button-copy-from-system">
              <Copy size={16} />
              Copy from System Calculator
            </Button>
          )}
          <Button variant="outline" onClick={resetInputs} className="gap-2" data-testid="button-reset-reverse">
            <RefreshCw size={16} />
            Reset
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-3 space-y-2">
          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">1</span>
              <h2 className="font-display font-semibold text-sm">Selling Price</h2>
            </div>

            <div className="space-y-2">
              <InputMoney
                label="Final Selling Price"
                placeholder="0.00"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                data-testid="input-selling-price"
              />
            </div>
          </div>

          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-blue-500/10 text-blue-600 flex items-center justify-center text-[10px] font-bold">2</span>
              <h2 className="font-display font-semibold text-sm">Job Costs</h2>
            </div>

            <div className="space-y-2">
              <InputMoney
                label="Materials Cost"
                placeholder="0.00"
                value={materials}
                onChange={(e) => setMaterials(e.target.value)}
                data-testid="input-reverse-materials"
              />
              <InputMoney
                label="Equipment Cost"
                placeholder="0.00"
                value={equipment}
                onChange={(e) => setEquipment(e.target.value)}
                data-testid="input-reverse-equipment"
              />
            </div>
          </div>

          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-emerald-500/10 text-emerald-600 flex items-center justify-center text-[10px] font-bold">3</span>
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
                  data-testid="input-reverse-labor-hours"
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
                    data-testid="input-reverse-labor-percent"
                    className="pl-8 h-9 text-sm font-medium bg-background border-border shadow-sm transition-all focus:ring-primary/20"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-amber-500/10 text-amber-600 flex items-center justify-center text-[10px] font-bold">4</span>
              <h2 className="font-display font-semibold text-sm">Other COGS</h2>
            </div>

            <div className="space-y-2">
              <InputMoney
                label="Subcontractor"
                placeholder="0.00"
                value={subcontractor}
                onChange={(e) => setSubcontractor(e.target.value)}
                data-testid="input-reverse-subcontractor"
              />
              <InputMoney
                label="Crane"
                placeholder="0.00"
                value={crane}
                onChange={(e) => setCrane(e.target.value)}
                data-testid="input-reverse-crane"
              />
              <InputMoney
                label="Permit"
                placeholder="0.00"
                value={permit}
                onChange={(e) => setPermit(e.target.value)}
                data-testid="input-reverse-permit"
              />
            </div>
          </div>

          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-red-500/10 text-red-600 flex items-center justify-center text-[10px] font-bold">5</span>
              <h2 className="font-display font-semibold text-sm">Discounts</h2>
            </div>

            <div className="space-y-2">
              <div className="flex gap-1 p-1 bg-muted rounded-lg">
                <button
                  type="button"
                  onClick={() => setDiscountMode("dollar")}
                  data-testid="button-reverse-discount-dollar"
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
                  data-testid="button-reverse-discount-percent"
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
                  data-testid="input-reverse-discount-dollar"
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
                      data-testid="input-reverse-discount-percent"
                      className="pl-8 h-9 text-sm font-medium bg-background border-border shadow-sm transition-all focus:ring-primary/20"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-9">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="md:col-span-3 bg-card border border-border rounded-xl p-5 shadow-lg relative overflow-hidden group">
                <div className="relative z-10">
                  <div className="mb-3" data-testid="reverse-margin-health-bar">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`text-sm font-medium ${marginHealth.textColor}`}>{marginHealth.label}</span>
                    </div>
                    <div className="h-1.5 w-1/2 bg-muted rounded-full overflow-visible">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${marginHealth.color}`}
                        style={{ width: '100%', boxShadow: marginHealth.glow }}
                      />
                    </div>
                  </div>
                  <p className="text-muted-foreground font-medium text-sm mb-1">Gross Margin</p>
                  <h2 className={`text-5xl font-display font-bold tracking-tight ${marginHealth.textColor}`} data-testid="text-reverse-gm-percent">
                    {formatPercent(results.metrics.grossMarginPercent)}
                  </h2>
                  <p className="text-lg font-semibold text-muted-foreground mt-1" data-testid="text-reverse-gm-amount">
                    {formatCurrency(results.metrics.grossMarginAmount)}
                  </p>
                </div>
              </div>

              <div className="md:col-span-2 bg-card border border-border rounded-xl p-5 shadow-lg relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                  <DollarSign size={80} />
                </div>
                <div className="relative z-10">
                  <p className="text-muted-foreground font-medium text-sm mb-1">Selling Price</p>
                  <h2 className="text-4xl font-display font-bold tracking-tight text-primary" data-testid="text-reverse-selling-price">
                    {formatCurrency(displayPrice)}
                  </h2>
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">M&E %</span>
                      <span className="font-medium" data-testid="text-reverse-me-percent">{formatPercent(results.metrics.mePercent)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Est. Labor Field</span>
                      <span className="font-medium text-emerald-600" data-testid="text-reverse-est-labor">{formatCurrency(results.metrics.estimatedLabor)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">Gross Margin</p>
                <p className="text-lg font-bold text-foreground" data-testid="text-reverse-metric-gm">{formatPercent(results.metrics.grossMarginPercent)}</p>
                <p className="text-xs text-muted-foreground">{formatCurrency(results.metrics.grossMarginAmount)}</p>
              </div>
              <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">M&E Percent</p>
                <p className="text-lg font-bold text-foreground">{formatPercent(results.metrics.mePercent)}</p>
              </div>
              <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">Direct Labor</p>
                <p className="text-lg font-bold text-foreground">{formatCurrency(directLaborCost)}</p>
              </div>
              <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">Other COGS</p>
                <p className="text-lg font-bold text-foreground">{formatCurrency(totalOtherCogs)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 bg-card rounded-xl border border-border p-4 shadow-sm">
                <div className="mb-3">
                  <h3 className="font-display font-bold text-base flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-primary" /> Cost Breakdown
                  </h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Note: Labor and Commission include burdens</p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">M&E (Includes Tax)</h4>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between p-2.5 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100/50 dark:border-blue-900/30">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                          <span className="text-sm font-semibold text-blue-900 dark:text-blue-300">Total M&E</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground font-medium">
                            ({formatPercent(displayPrice > 0 ? (mAndECost / displayPrice) * 100 : 0)})
                          </span>
                          <span className="font-mono text-sm font-medium text-blue-700 dark:text-blue-400">
                            {formatCurrency(mAndECost)}
                          </span>
                        </div>
                      </div>

                      <div className="ml-5 space-y-0.5 pt-1 border-l-2 border-blue-100/50 dark:border-blue-900/30 pl-3">
                        {[
                          { label: "Materials", value: results.breakdown.materials },
                          { label: "Equipment", value: results.breakdown.equipment },
                          { label: `Sales Tax (${settings.salesTaxPercent || "6.35"}%)`, value: results.breakdown.tax },
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
                    <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">Direct Labor</h4>
                    <div className="space-y-1">
                      {[
                        { label: "Burdened Labor", value: results.breakdown.laborCost, color: "bg-emerald-500", highlight: true },
                        { label: "Burdened Commission", value: results.breakdown.commission, color: "bg-amber-500" },
                      ].map((item) => (
                        <div key={item.label} className={`flex items-center justify-between p-2.5 rounded-lg ${item.highlight ? 'bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30' : 'hover:bg-muted/50'}`}>
                          <div className="flex items-center gap-2">
                            <div className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                            <span className={`text-sm ${item.highlight ? 'font-semibold text-emerald-900 dark:text-emerald-300' : 'text-foreground'}`}>
                              {item.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground font-medium">
                              ({formatPercent(displayPrice > 0 ? (item.value / displayPrice) * 100 : 0)})
                            </span>
                            <span className={`font-mono text-sm font-medium ${item.highlight ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                              {formatCurrency(item.value)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">Other COGS</h4>
                    <div className="space-y-1">
                      {[
                        { label: "Financing Fees", value: results.breakdown.financing, color: "bg-violet-500" },
                        { label: "Subcontractor", value: results.breakdown.subcontractor, color: "bg-orange-400" },
                        { label: "Crane", value: results.breakdown.crane, color: "bg-pink-400" },
                        { label: "Permit", value: results.breakdown.permit, color: "bg-cyan-400" },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/50">
                          <div className="flex items-center gap-2">
                            <div className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                            <span className="text-sm text-foreground">{item.label}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground font-medium">
                              ({formatPercent(displayPrice > 0 ? ((item.value || 0) / displayPrice) * 100 : 0)})
                            </span>
                            <span className="font-mono text-sm font-medium text-muted-foreground">
                              {formatCurrency(item.value || 0)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-card rounded-xl border border-border p-4 shadow-sm flex flex-col items-center justify-start">
                <h3 className="font-display font-bold text-base mb-2 text-center w-full">Distribution</h3>
                <div className="w-full h-[180px] flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                      <Pie
                        data={chartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={35}
                        outerRadius={60}
                        paddingAngle={3}
                        dataKey="value"
                        label={renderCustomLabel}
                        labelLine={false}
                      >
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, name: string, props: any) => [
                          `${formatCurrency(value)} (${props.payload.percent.toFixed(2)}%)`,
                          name
                        ]}
                        contentStyle={{
                          borderRadius: '8px',
                          border: 'none',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                          zIndex: 1000
                        }}
                        wrapperStyle={{ zIndex: 1000 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap justify-center gap-2 text-[10px] mt-2">
                  {chartData.map(d => (
                    <div key={d.name} className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                      <span className="text-muted-foreground font-medium">{d.name}: {d.percent.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
