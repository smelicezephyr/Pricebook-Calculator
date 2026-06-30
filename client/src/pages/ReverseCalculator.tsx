import { useState, useEffect } from "react";
import { useSettings } from "@/hooks/use-settings";
import { useCalculatorState } from "@/contexts/CalculatorContext";
import { InputMoney } from "@/components/InputMoney";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RefreshCw, Loader2, Copy, DollarSign, TrendingUp } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList } from "recharts";
import { useToast } from "@/hooks/use-toast";

const REVERSE_MODE_KEY = "pricebookcalc_reverse_mode";

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

const formatPercent = (val: number) =>
  `${val.toFixed(2)}%`;

type ReverseMode = "system" | "repair";

export default function ReverseCalculator() {
  const { settings, isLoading: settingsLoading } = useSettings();
  const { state: calcState, repairState } = useCalculatorState();
  const { toast } = useToast();

  const [mode, setMode] = useState<ReverseMode>(() => {
    try {
      const saved = localStorage.getItem(REVERSE_MODE_KEY);
      if (saved === "system" || saved === "repair") return saved;
    } catch {}
    return "system";
  });

  useEffect(() => {
    try { localStorage.setItem(REVERSE_MODE_KEY, mode); } catch {}
  }, [mode]);

  const [sellingPrice, setSellingPrice] = useState("");
  const [materials, setMaterials] = useState("");
  const [equipment, setEquipment] = useState("");
  const [salesTaxPercent, setSalesTaxPercent] = useState("6.35");
  const [laborHours, setLaborHours] = useState("");
  const [laborPercent, setLaborPercent] = useState("");
  const [laborMode, setLaborMode] = useState<"hours" | "percent">("percent");
  const [numTechs, setNumTechs] = useState("1");
  const [subcontractor, setSubcontractor] = useState("");
  const [crane, setCrane] = useState("");
  const [permit, setPermit] = useState("");
  const [discount, setDiscount] = useState("");
  const [discountMode, setDiscountMode] = useState<"dollar" | "percent">("dollar");
  const [oemRebate, setOemRebate] = useState("");
  const [utilityRebate, setUtilityRebate] = useState("");
  const [commissionPercent, setCommissionPercent] = useState("");
  const [financingFeePercent, setFinancingFeePercent] = useState("");

  const [repairSellingPrice, setRepairSellingPrice] = useState("");
  const [repairPartsCost, setRepairPartsCost] = useState("");
  const [repairMaterialMarkup, setRepairMaterialMarkup] = useState("200");
  const [repairLaborHours, setRepairLaborHours] = useState("");
  const [repairBurdenPercent, setRepairBurdenPercent] = useState("20.00");
  const [repairSalesTaxPercent, setRepairSalesTaxPercent] = useState("6.35");
  const [repairCommissionPercent, setRepairCommissionPercent] = useState("10.00");
  const [repairFinancingFeePercent, setRepairFinancingFeePercent] = useState("4.00");
  const [repairHighestTechRate, setRepairHighestTechRate] = useState("");
  const [repairLaborMode, setRepairLaborMode] = useState<"dollars" | "percent">("dollars");

  const [hasInitialized, setHasInitialized] = useState(false);

  useEffect(() => {
    if (settings && !hasInitialized) {
      if (!laborPercent) {
        setLaborPercent(settings.laborPercent || "");
      }
      setLaborMode((settings.laborMode as "hours" | "percent") || "percent");
      setSalesTaxPercent(settings.salesTaxPercent || "6.35");
      setRepairSalesTaxPercent(settings.salesTaxPercent || "6.35");
      setCommissionPercent(parseFloat(settings.commissionPercent).toFixed(2));
      setFinancingFeePercent(parseFloat(settings.financingFeePercent).toFixed(2));
      setRepairCommissionPercent(settings.commissionPercent || "10.00");
      setRepairBurdenPercent(settings.laborBurdenPercent || "20.00");
      setRepairFinancingFeePercent(settings.financingFeePercent || "4.00");
      setHasInitialized(true);
    }
  }, [settings, hasInitialized, laborPercent]);

  const markupOptions = Array.from({ length: 30 }, (_, i) => 300 - i * 10);

  const priceVal = parseFloat(sellingPrice) || 0;
  const matVal = parseFloat(materials) || 0;
  const equipVal = parseFloat(equipment) || 0;
  const hoursVal = parseFloat(laborHours) || 0;
  const subVal = parseFloat(subcontractor) || 0;
  const craneVal = parseFloat(crane) || 0;
  const permitVal = parseFloat(permit) || 0;

  const [systemResults, setSystemResults] = useState({
    breakdown: { materials: 0, equipment: 0, tax: 0, commission: 0, financing: 0, laborCost: 0, subcontractor: 0, crane: 0, permit: 0, oemRebate: 0, utilityRebate: 0 },
    metrics: { grossMarginPercent: 0, grossMarginAmount: 0, mePercent: 0, estimatedLabor: 0 }
  });

  useEffect(() => {
    if (!settings) return;

    const salesTaxRate = parseFloat(salesTaxPercent) / 100;
    const tax = (matVal + equipVal) * salesTaxRate;
    const totalMe = matVal + equipVal + tax;
    const totalOtherCogs = subVal + craneVal + permitVal;

    const discountInput = parseFloat(discount) || 0;
    const discountVal = discountMode === 'percent' ? priceVal * discountInput / 100 : discountInput;
    const price = Math.max(0, priceVal - discountVal);

    const commissionRate = parseFloat(commissionPercent) / 100;
    const commissionBurdenRate = parseFloat(settings.commissionBurdenPercent) / 100;
    const commissionCost = (price * commissionRate) * (1 + commissionBurdenRate);

    const financingRate = parseFloat(financingFeePercent) / 100;
    const financingCost = price * financingRate;

    let laborCost = 0;
    const laborBurdenRate = parseFloat(settings.laborBurdenPercent) / 100;
    const numTechsVal = Math.max(1, parseFloat(numTechs) || 1);

    if (laborMode === 'hours') {
      const hourlyRate = parseFloat(settings.laborHourlyRate);
      laborCost = (hoursVal * numTechsVal * hourlyRate) * (1 + laborBurdenRate);
    } else {
      const laborPercentRate = (parseFloat(laborPercent) || 0) / 100;
      laborCost = (price * laborPercentRate) * (1 + laborBurdenRate);
    }

    const estimatedLabor = laborCost + commissionCost + tax + financingCost;
    const totalAllCogs = totalMe + commissionCost + financingCost + laborCost + totalOtherCogs;
    const oemRebateVal = parseFloat(oemRebate) || 0;
    const utilityRebateVal = parseFloat(utilityRebate) || 0;
    const totalRebates = oemRebateVal + utilityRebateVal;
    const effectiveRevenue = price + totalRebates;
    const grossMarginAmount = effectiveRevenue - totalAllCogs;
    const grossMarginPercent = effectiveRevenue > 0 ? (grossMarginAmount / effectiveRevenue) * 100 : 0;
    const mePercent = effectiveRevenue > 0 ? (totalMe / effectiveRevenue) * 100 : 0;

    setSystemResults({
      breakdown: { materials: matVal, equipment: equipVal, tax, commission: commissionCost, financing: financingCost, laborCost, subcontractor: subVal, crane: craneVal, permit: permitVal, oemRebate: oemRebateVal, utilityRebate: utilityRebateVal },
      metrics: { grossMarginPercent, grossMarginAmount, mePercent, estimatedLabor }
    });
  }, [priceVal, matVal, equipVal, hoursVal, numTechs, laborPercent, laborMode, salesTaxPercent, discount, discountMode, subVal, craneVal, permitVal, oemRebate, utilityRebate, settings, commissionPercent, financingFeePercent]);

  const repairPriceVal = parseFloat(repairSellingPrice) || 0;
  const repairPartsTotal = parseFloat(repairPartsCost) || 0;
  const repairMarkupRate = (parseFloat(repairMaterialMarkup) || 200) / 100;
  const repairHighestTechRateVal = parseFloat(repairHighestTechRate) || 0;
  const repairLaborHoursVal = parseFloat(repairLaborHours) || 0;
  const repairBurdenRate = (parseFloat(repairBurdenPercent) || 0) / 100;
  const repairTaxRate = (parseFloat(repairSalesTaxPercent) || 0) / 100;
  const repairCommissionRate = (parseFloat(repairCommissionPercent) || 0) / 100;
  const repairFinancingRate = (parseFloat(repairFinancingFeePercent) || 0) / 100;

  const repairSalesTax = repairPartsTotal * repairTaxRate;
  const repairSubtotal1 = repairPartsTotal + repairSalesTax;
  const repairMarkupAmount = repairSubtotal1 * repairMarkupRate;
  const repairMaterialsCost = repairSubtotal1 + repairMarkupAmount;

  let repairDirectLaborCost: number;
  let repairLaborBurden: number;
  let repairBurdenedLaborCost: number;
  let repairDirectCommission: number;
  let repairCommissionBurden: number;
  let repairBurdenedCommission: number;
  let repairFinancingFee: number;

  if (repairLaborMode === "percent") {
    repairDirectLaborCost = 0;
    repairLaborBurden = 0;
    repairBurdenedLaborCost = 0;
    repairDirectCommission = repairPriceVal * repairCommissionRate;
    repairCommissionBurden = repairDirectCommission * repairBurdenRate;
    repairBurdenedCommission = repairDirectCommission + repairCommissionBurden;
    repairFinancingFee = repairPriceVal * repairFinancingRate;
  } else {
    repairDirectLaborCost = repairHighestTechRateVal * repairLaborHoursVal;
    repairLaborBurden = repairDirectLaborCost * repairBurdenRate;
    repairBurdenedLaborCost = repairDirectLaborCost + repairLaborBurden;
    repairDirectCommission = repairPriceVal * repairCommissionRate;
    repairCommissionBurden = repairDirectCommission * repairBurdenRate;
    repairBurdenedCommission = repairDirectCommission + repairCommissionBurden;
    repairFinancingFee = repairPriceVal * repairFinancingRate;
  }

  const repairCogs = repairSubtotal1 + repairBurdenedLaborCost;
  const repairTotalCosts = repairCogs + repairFinancingFee;
  const repairGrossMargin = repairPriceVal - repairCogs;
  const repairGrossMarginPercent = repairPriceVal > 0 ? (repairGrossMargin / repairPriceVal) * 100 : 0;
  const repairMePercent = repairPriceVal > 0 ? (repairSubtotal1 / repairPriceVal) * 100 : 0;

  // Forward-calculated price: what the Repair Calculator would compute from these same inputs
  const repairFwdDenominator = 1 - repairCommissionRate * (1 + repairBurdenRate) - repairFinancingRate;
  const repairFwdSubtotal3 = repairMaterialsCost + repairBurdenedLaborCost;
  const repairCalculatedPrice = repairFwdDenominator > 0 ? repairFwdSubtotal3 / repairFwdDenominator : repairFwdSubtotal3;

  // Stacked bar segments for the comparison chart
  const calcCommission = repairCalculatedPrice * repairCommissionRate * (1 + repairBurdenRate);
  const calcFinancing = repairCalculatedPrice * repairFinancingRate;
  const calcMargin = repairCalculatedPrice - repairSubtotal1 - repairMarkupAmount - repairBurdenedLaborCost - calcCommission - calcFinancing;

  const enteredCommission = repairBurdenedCommission;
  const enteredFinancing = repairFinancingFee;
  const enteredMargin = repairPriceVal - repairSubtotal1 - repairMarkupAmount - repairBurdenedLaborCost - enteredCommission - enteredFinancing;

  const COMPARISON_SEGMENTS = [
    { key: "Parts + Tax", color: "#6b7280" },
    { key: "Markup",      color: "#3b82f6" },
    { key: "Labor",       color: "#10b981" },
    { key: "Commission",  color: "#f59e0b" },
    { key: "Financing",   color: "#8b5cf6" },
  ] as const;

  const priceComparisonData = [
    {
      name: "Calculated",
      total: repairCalculatedPrice,
      "Parts + Tax": repairSubtotal1,
      "Markup": repairMarkupAmount,
      "Labor": repairBurdenedLaborCost,
      "Commission": calcCommission,
      "Financing": calcFinancing,
      "Margin": calcMargin,
    },
    {
      name: "Selling",
      total: repairPriceVal,
      "Parts + Tax": repairSubtotal1,
      "Markup": repairMarkupAmount,
      "Labor": repairBurdenedLaborCost,
      "Commission": enteredCommission,
      "Financing": enteredFinancing,
      "Margin": enteredMargin,
    },
  ];

  const handleCopyFromSystem = () => {
    setMaterials(calcState.materials || "");
    setEquipment(calcState.equipment || "");
    setLaborHours(calcState.laborHours || "");
    setLaborPercent(calcState.laborPercent || "");
    setLaborMode(calcState.laborMode || "percent");
    setNumTechs(calcState.numTechs || "1");
    setSalesTaxPercent(calcState.salesTaxPercent || "6.35");
    setSubcontractor(calcState.subcontractor || "");
    setCrane(calcState.crane || "");
    setPermit(calcState.permit || "");
    setDiscount(calcState.discount || "");
    setDiscountMode(calcState.discountMode || "dollar");
    setOemRebate(calcState.oemRebate || "");
    setUtilityRebate(calcState.utilityRebate || "");
    toast({ title: "Copied from System Calculator", description: "Materials, equipment, labor, and other costs have been imported." });
  };

  const handleCopyFromRepair = () => {
    setRepairPartsCost(repairState.partsCost || "");
    setRepairMaterialMarkup(repairState.materialMarkup || "200");
    setRepairLaborHours(repairState.laborHours || "");
    setRepairBurdenPercent(repairState.burdenPercent || "20.00");
    setRepairSalesTaxPercent(repairState.salesTaxPercent || "6.35");
    setRepairCommissionPercent(repairState.commissionPercent || "10.00");
    setRepairFinancingFeePercent(repairState.financingFeePercent || "4.00");
    setRepairHighestTechRate(repairState.highestTechRate || "");
    setRepairLaborMode(repairState.laborMode || "dollars");
    toast({ title: "Copied from Repair Calculator", description: "Parts, markup, labor, and fee settings have been imported." });
  };

  const resetSystemInputs = () => {
    setSellingPrice("");
    setMaterials("");
    setEquipment("");
    setLaborHours("");
    setLaborPercent(settings?.laborPercent || "");
    setLaborMode((settings?.laborMode as "hours" | "percent") || "percent");
    setNumTechs("1");
    setSalesTaxPercent(settings?.salesTaxPercent || "6.35");
    setSubcontractor("");
    setCrane("");
    setPermit("");
    setDiscount("");
    setDiscountMode("dollar");
    setOemRebate("");
    setUtilityRebate("");
    setCommissionPercent(parseFloat(settings?.commissionPercent || "10").toFixed(2));
    setFinancingFeePercent(parseFloat(settings?.financingFeePercent || "4").toFixed(2));
  };

  const resetRepairInputs = () => {
    setRepairSellingPrice("");
    setRepairPartsCost("");
    setRepairMaterialMarkup("200");
    setRepairLaborHours("");
    setRepairLaborMode("dollars");
    setRepairSalesTaxPercent(settings?.salesTaxPercent || "6.35");
    setRepairCommissionPercent(settings?.commissionPercent || "10.00");
    setRepairBurdenPercent(settings?.laborBurdenPercent || "20.00");
    setRepairFinancingFeePercent(settings?.financingFeePercent || "4.00");
    setRepairHighestTechRate("");
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

  const getMarginHealth = (gmPercent: number) => {
    if (mode === "system") {
      const minMargin = grossMarginMinPercent;
      if (gmPercent >= minMargin) return { status: 'strong', label: 'Margin Health: Strong', color: 'bg-emerald-500', glow: '0 0 8px 2px rgba(16, 185, 129, 0.6)', textColor: 'text-emerald-600' };
      if (gmPercent >= minMargin - 2) return { status: 'caution', label: 'Margin Health: Caution', color: 'bg-amber-500', glow: '0 0 8px 2px rgba(245, 158, 11, 0.6)', textColor: 'text-amber-600' };
      return { status: 'danger', label: 'Margin Health: Low', color: 'bg-red-500', glow: '0 0 8px 2px rgba(239, 68, 68, 0.6)', textColor: 'text-red-600' };
    } else {
      if (gmPercent >= 50) return { status: 'strong', label: 'Margin Health: Strong', color: 'bg-emerald-500', textColor: 'text-emerald-600', glow: '0 0 8px 2px rgba(16, 185, 129, 0.6)' };
      if (gmPercent >= 40) return { status: 'caution', label: 'Margin Health: Caution', color: 'bg-amber-500', textColor: 'text-amber-600', glow: '0 0 8px 2px rgba(245, 158, 11, 0.6)' };
      return { status: 'danger', label: 'Margin Health: Low', color: 'bg-red-500', textColor: 'text-red-600', glow: '0 0 8px 2px rgba(239, 68, 68, 0.6)' };
    }
  };

  const currentGmPercent = mode === "system" ? systemResults.metrics.grossMarginPercent : repairGrossMarginPercent;
  const currentGmAmount = mode === "system" ? systemResults.metrics.grossMarginAmount : repairGrossMargin;
  const marginHealth = getMarginHealth(currentGmPercent);

  const currentPrice = mode === "system" ? (() => {
    const discountInput = parseFloat(discount) || 0;
    const discountDollarVal = discountMode === 'percent' ? priceVal * discountInput / 100 : discountInput;
    return Math.max(0, priceVal - discountDollarVal);
  })() : repairPriceVal;

  const systemEffectiveRevenue = currentPrice + (systemResults.breakdown.oemRebate || 0) + (systemResults.breakdown.utilityRebate || 0);

  const hasSystemCalcData = !!(calcState.materials || calcState.equipment || calcState.laborHours || calcState.laborPercent);
  const hasRepairCalcData = !!(repairState.partsCost || repairState.laborHours);

  const systemMAndECost = systemResults.breakdown.materials + systemResults.breakdown.equipment + systemResults.breakdown.tax;
  const systemDirectLabor = systemResults.breakdown.laborCost + systemResults.breakdown.commission;
  const systemOtherCogs = systemResults.breakdown.financing + systemResults.breakdown.subcontractor + systemResults.breakdown.crane + systemResults.breakdown.permit;

  const systemTotalRebates = systemResults.breakdown.oemRebate + systemResults.breakdown.utilityRebate;

  const systemChartData = [
    { name: 'Gross Margin', value: systemResults.metrics.grossMarginAmount, color: '#f59e0b', percent: systemEffectiveRevenue > 0 ? (systemResults.metrics.grossMarginAmount / systemEffectiveRevenue) * 100 : 0 },
    { name: 'M&E', value: systemMAndECost, color: '#3b82f6', percent: systemEffectiveRevenue > 0 ? (systemMAndECost / systemEffectiveRevenue) * 100 : 0 },
    { name: 'Direct Labor', value: systemDirectLabor, color: '#10b981', percent: systemEffectiveRevenue > 0 ? (systemDirectLabor / systemEffectiveRevenue) * 100 : 0 },
    { name: 'Other COGS', value: systemOtherCogs, color: '#8b5cf6', percent: systemEffectiveRevenue > 0 ? (systemOtherCogs / systemEffectiveRevenue) * 100 : 0 },
  ].filter(d => d.value > 0);

  const repairChartData = [
    { name: 'Gross Margin', value: repairGrossMargin, color: '#f59e0b', percent: repairPriceVal > 0 ? (repairGrossMargin / repairPriceVal) * 100 : 0 },
    { name: 'Parts + Tax + Markup', value: repairMaterialsCost, color: '#3b82f6', percent: repairPriceVal > 0 ? (repairMaterialsCost / repairPriceVal) * 100 : 0 },
    { name: 'Labor', value: repairBurdenedLaborCost, color: '#10b981', percent: repairPriceVal > 0 ? (repairBurdenedLaborCost / repairPriceVal) * 100 : 0 },
    { name: 'Commission', value: repairBurdenedCommission, color: '#ef4444', percent: repairPriceVal > 0 ? (repairBurdenedCommission / repairPriceVal) * 100 : 0 },
    { name: 'Finance Fee', value: repairFinancingFee, color: '#8b5cf6', percent: repairPriceVal > 0 ? (repairFinancingFee / repairPriceVal) * 100 : 0 },
  ].filter(d => d.value > 0);

  const chartData = mode === "system" ? systemChartData : repairChartData;

  const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, payload }: any) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    if (payload.percent < 5) return null;
    return (
      <g>
        <text x={x} y={y} fill="white" stroke="#000000" strokeWidth={0.5} textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight="bold" style={{ paintOrder: 'stroke fill' }}>
          {payload.percent.toFixed(1)}%
        </text>
      </g>
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground" data-testid="text-reverse-calc-title">Reverse Calculator</h1>
          <p className="text-muted-foreground mt-1">Enter a selling price to see the resulting gross margin.</p>
        </div>

        <div className="flex gap-2 flex-wrap">
          {mode === "system" && (
            <Button variant="outline" onClick={handleCopyFromSystem} className="gap-2" data-testid="button-copy-from-system">
              <Copy size={16} />
              Copy from System Calculator
            </Button>
          )}
          {mode === "repair" && (
            <Button variant="outline" onClick={handleCopyFromRepair} className="gap-2" data-testid="button-copy-from-repair">
              <Copy size={16} />
              Copy from Repair Calculator
            </Button>
          )}
          <Button variant="outline" onClick={mode === "system" ? resetSystemInputs : resetRepairInputs} className="gap-2" data-testid="button-reset-reverse">
            <RefreshCw size={16} />
            Reset
          </Button>
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit" data-testid="toggle-reverse-mode">
        <button
          type="button"
          onClick={() => setMode("system")}
          data-testid="button-reverse-system"
          className={`py-2 px-4 rounded-md text-sm font-medium transition-all ${
            mode === "system" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Reverse System
        </button>
        <button
          type="button"
          onClick={() => setMode("repair")}
          data-testid="button-reverse-repair"
          className={`py-2 px-4 rounded-md text-sm font-medium transition-all ${
            mode === "repair" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Reverse Repair
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-3 space-y-1.5">
          {mode === "system" ? (
            <>
              <div className="bg-card rounded-lg p-2.5 shadow-sm border border-border">
                <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-border">
                  <span className="w-5 h-5 rounded bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">1</span>
                  <h2 className="font-display font-semibold text-sm">Selling Price</h2>
                </div>
                <InputMoney label="Final Selling Price" placeholder="0.00" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} data-testid="input-selling-price" />
              </div>

              <div className="bg-card rounded-lg p-2.5 shadow-sm border border-border">
                <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-border">
                  <span className="w-5 h-5 rounded bg-blue-500/10 text-blue-600 flex items-center justify-center text-[10px] font-bold">2</span>
                  <h2 className="font-display font-semibold text-sm">Job Costs</h2>
                </div>
                <div className="space-y-1.5">
                  <InputMoney label="Materials Cost" placeholder="0.00" value={materials} onChange={(e) => setMaterials(e.target.value)} data-testid="input-reverse-materials" />
                  <InputMoney label="Equipment Cost" placeholder="0.00" value={equipment} onChange={(e) => setEquipment(e.target.value)} data-testid="input-reverse-equipment" />
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sales Tax %</Label>
                    <div className="relative group">
                      <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none group-focus-within:text-primary transition-colors">
                        <span className="text-xs font-mono">%</span>
                      </div>
                      <Input type="number" step="0.01" min="0" value={salesTaxPercent} onChange={(e) => setSalesTaxPercent(e.target.value)} data-testid="input-reverse-sales-tax" className="pl-8 h-9 text-sm font-medium bg-background border-border shadow-sm transition-all focus:ring-primary/20" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-card rounded-lg p-2.5 shadow-sm border border-border">
                <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-border">
                  <span className="w-5 h-5 rounded bg-emerald-500/10 text-emerald-600 flex items-center justify-center text-[10px] font-bold">3</span>
                  <h2 className="font-display font-semibold text-sm">Labor</h2>
                  <div className="ml-auto flex items-center gap-2">
                    <Label htmlFor="rev-labor-mode" className="text-xs font-medium cursor-pointer text-muted-foreground">Hourly</Label>
                    <Switch
                      id="rev-labor-mode"
                      checked={laborMode === 'hours'}
                      onCheckedChange={(checked) => setLaborMode(checked ? 'hours' : 'percent')}
                      data-testid="switch-reverse-labor-mode"
                    />
                  </div>
                </div>
                {laborMode === 'hours' ? (
                  <div className="space-y-1.5">
                    <InputMoney label="Labor Hours" type="number" placeholder="10" value={laborHours} onChange={(e) => setLaborHours(e.target.value)} data-testid="input-reverse-labor-hours" />
                    <InputMoney label="# of Technicians" type="number" placeholder="1" value={numTechs} onChange={(e) => setNumTechs(e.target.value)} data-testid="input-reverse-num-techs" />
                    <p className="text-xs text-muted-foreground">${parseFloat(settings.laborHourlyRate).toFixed(2)}/hr per technician</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Labor %</Label>
                    <div className="relative group">
                      <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none group-focus-within:text-primary transition-colors">
                        <span className="text-xs font-mono">%</span>
                      </div>
                      <Input type="number" step="0.01" value={laborPercent} onChange={(e) => setLaborPercent(e.target.value)} data-testid="input-reverse-labor-percent" className="pl-8 h-9 text-sm font-medium bg-background border-border shadow-sm transition-all focus:ring-primary/20" />
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-card rounded-lg p-2.5 shadow-sm border border-border">
                <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-border">
                  <span className="w-5 h-5 rounded bg-amber-500/10 text-amber-600 flex items-center justify-center text-[10px] font-bold">4</span>
                  <h2 className="font-display font-semibold text-sm">Other COGS</h2>
                </div>
                <div className="space-y-1.5">
                  <InputMoney label="Subcontractor" placeholder="0.00" value={subcontractor} onChange={(e) => setSubcontractor(e.target.value)} data-testid="input-reverse-subcontractor" />
                  <InputMoney label="Crane" placeholder="0.00" value={crane} onChange={(e) => setCrane(e.target.value)} data-testid="input-reverse-crane" />
                  <InputMoney label="Permit" placeholder="0.00" value={permit} onChange={(e) => setPermit(e.target.value)} data-testid="input-reverse-permit" />
                </div>
              </div>

              <div className="bg-card rounded-lg p-2.5 shadow-sm border border-border">
                <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-border">
                  <span className="w-5 h-5 rounded bg-red-500/10 text-red-600 flex items-center justify-center text-[10px] font-bold">5</span>
                  <h2 className="font-display font-semibold text-sm">Discounts</h2>
                </div>
                <div className="space-y-1.5">
                  <div className="flex gap-1 p-1 bg-muted rounded-lg">
                    <button type="button" onClick={() => setDiscountMode("dollar")} data-testid="button-reverse-discount-dollar" className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-all ${discountMode === "dollar" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>$ Dollar</button>
                    <button type="button" onClick={() => setDiscountMode("percent")} data-testid="button-reverse-discount-percent" className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-all ${discountMode === "percent" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>% of Total</button>
                  </div>
                  {discountMode === "dollar" ? (
                    <InputMoney label="Discount Amount" placeholder="0.00" value={discount} onChange={(e) => setDiscount(e.target.value)} data-testid="input-reverse-discount-dollar" />
                  ) : (
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Discount %</Label>
                      <div className="relative group">
                        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none group-focus-within:text-primary transition-colors"><span className="text-xs font-mono">%</span></div>
                        <Input type="number" step="0.1" placeholder="0" value={discount} onChange={(e) => setDiscount(e.target.value)} data-testid="input-reverse-discount-percent" className="pl-8 h-9 text-sm font-medium bg-background border-border shadow-sm transition-all focus:ring-primary/20" />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-card rounded-lg p-2.5 shadow-sm border border-border">
                <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-border">
                  <span className="w-5 h-5 rounded bg-violet-500/10 text-violet-600 flex items-center justify-center text-[10px] font-bold">6</span>
                  <h2 className="font-display font-semibold text-sm">Fees</h2>
                </div>
                <div className="space-y-1.5">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Commission %</Label>
                    <div className="relative group">
                      <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"><span className="text-xs font-mono">%</span></div>
                      <Input type="number" step="0.01" min="0" value={commissionPercent} onChange={(e) => setCommissionPercent(e.target.value)} data-testid="input-reverse-commission-percent" className="pl-8 h-9 text-sm font-medium bg-background border-border shadow-sm" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Financing Fee %</Label>
                    <div className="relative group">
                      <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"><span className="text-xs font-mono">%</span></div>
                      <Input type="number" step="0.01" min="0" value={financingFeePercent} onChange={(e) => setFinancingFeePercent(e.target.value)} data-testid="input-reverse-financing-fee-percent" className="pl-8 h-9 text-sm font-medium bg-background border-border shadow-sm" />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Burden % stays in Settings</p>
                </div>
              </div>

              <div className="bg-card rounded-lg p-2.5 shadow-sm border border-border">
                <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-border">
                  <span className="w-5 h-5 rounded bg-green-500/10 text-green-600 flex items-center justify-center text-[10px] font-bold">7</span>
                  <h2 className="font-display font-semibold text-sm">Rebates</h2>
                </div>
                <div className="space-y-1.5">
                  <InputMoney label="OEM Rebate" placeholder="0.00" value={oemRebate} onChange={(e) => setOemRebate(e.target.value)} data-testid="input-reverse-oem-rebate" />
                  <InputMoney label="Utility Rebate" placeholder="0.00" value={utilityRebate} onChange={(e) => setUtilityRebate(e.target.value)} data-testid="input-reverse-utility-rebate" />
                  <p className="text-xs text-muted-foreground -mt-0.5">Added back to revenue for margin calculation</p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                  <span className="w-5 h-5 rounded bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">1</span>
                  <h2 className="font-display font-semibold text-sm">Selling Price</h2>
                </div>
                <InputMoney label="Final Selling Price" placeholder="0.00" value={repairSellingPrice} onChange={(e) => setRepairSellingPrice(e.target.value)} data-testid="input-repair-selling-price" />
              </div>

              <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                  <span className="w-5 h-5 rounded bg-blue-500/10 text-blue-600 flex items-center justify-center text-[10px] font-bold">2</span>
                  <h2 className="font-display font-semibold text-sm">Parts & Markup</h2>
                </div>
                <div className="space-y-2">
                  <InputMoney label="Parts Total" placeholder="0.00" value={repairPartsCost} onChange={(e) => setRepairPartsCost(e.target.value)} data-testid="input-reverse-parts-cost" />
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Material Mark Up</Label>
                    <select value={repairMaterialMarkup} onChange={(e) => setRepairMaterialMarkup(e.target.value)} data-testid="select-reverse-markup" className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-2.5 py-1.5 text-sm font-medium ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                      {markupOptions.map((opt) => (<option key={opt} value={opt}>{opt}%</option>))}
                    </select>
                  </div>
                  <InputMoney label="Sales Tax %" type="percent" placeholder="6.35" value={repairSalesTaxPercent} onChange={(e) => setRepairSalesTaxPercent(e.target.value)} data-testid="input-reverse-sales-tax" />
                </div>
              </div>

              <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                  <span className="w-5 h-5 rounded bg-emerald-500/10 text-emerald-600 flex items-center justify-center text-[10px] font-bold">3</span>
                  <h2 className="font-display font-semibold text-sm">Labor</h2>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-end gap-2">
                    <Label htmlFor="reverseRepairLaborMode" className="text-sm font-medium cursor-pointer">Production Pay</Label>
                    <Switch id="reverseRepairLaborMode" checked={repairLaborMode === "percent"} onCheckedChange={(checked) => setRepairLaborMode(checked ? "percent" : "dollars")} data-testid="switch-reverse-labor-mode" />
                  </div>
                  {repairLaborMode === "percent" ? (
                    <p className="text-xs text-muted-foreground">Labor is included in Commission % below</p>
                  ) : (
                    <>
                      <InputMoney label="Actual/Highest Tech Pay Rate" placeholder="0.00" value={repairHighestTechRate} onChange={(e) => setRepairHighestTechRate(e.target.value)} data-testid="input-reverse-highest-tech-rate" />
                      <InputMoney label="Labor Hours" type="number" placeholder="1" value={repairLaborHours} onChange={(e) => setRepairLaborHours(e.target.value)} data-testid="input-reverse-repair-labor-hours" />
                    </>
                  )}
                </div>
              </div>

              <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
                  <span className="w-5 h-5 rounded bg-amber-500/10 text-amber-600 flex items-center justify-center text-[10px] font-bold">4</span>
                  <h2 className="font-display font-semibold text-sm">Fees & Burden</h2>
                </div>
                <div className="space-y-2">
                  <InputMoney label="Burden %" type="percent" placeholder="20.00" value={repairBurdenPercent} onChange={(e) => setRepairBurdenPercent(e.target.value)} data-testid="input-reverse-burden" />
                  <InputMoney label="Commission %" type="percent" placeholder="10.00" value={repairCommissionPercent} onChange={(e) => setRepairCommissionPercent(e.target.value)} data-testid="input-reverse-commission" />
                  <InputMoney label="Finance Fee %" type="percent" placeholder="6.00" value={repairFinancingFeePercent} onChange={(e) => setRepairFinancingFeePercent(e.target.value)} data-testid="input-reverse-financing-fee" />
                  <p className="text-xs text-muted-foreground -mt-1">Financing fee and/or credit card processing fee</p>
                </div>
              </div>
            </>
          )}
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
                      <div className={`h-full rounded-full transition-all duration-300 ${marginHealth.color}`} style={{ width: '100%', boxShadow: marginHealth.glow }} />
                    </div>
                  </div>
                  <p className="text-muted-foreground font-medium text-sm mb-1">Gross Margin</p>
                  <h2 className={`text-5xl font-display font-bold tracking-tight ${marginHealth.textColor}`} data-testid="text-reverse-gm-percent">
                    {formatPercent(currentGmPercent)}
                  </h2>
                  <p className="text-lg font-semibold text-muted-foreground mt-1" data-testid="text-reverse-gm-amount">
                    {formatCurrency(currentGmAmount)}
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
                    {formatCurrency(currentPrice)}
                  </h2>
                  {mode === "system" && (
                    <div className="mt-3 space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">M&E $</span>
                        <span className="font-medium" data-testid="text-reverse-me-dollar">{formatCurrency(systemMAndECost)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Direct Labor</span>
                        <span className="font-medium text-emerald-600" data-testid="text-reverse-direct-labor">{formatCurrency(systemDirectLabor)}</span>
                      </div>
                    </div>
                  )}
                  {mode === "repair" && (
                    <div className="mt-3 space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">M&E %</span>
                        <span className="font-medium" data-testid="text-reverse-me-percent-repair">{formatPercent(repairMePercent)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Costs</span>
                        <span className="font-medium text-emerald-600" data-testid="text-reverse-total-costs">{formatCurrency(repairTotalCosts)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {mode === "system" ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">Gross Margin</p>
                    <p className="text-lg font-bold text-foreground">{formatPercent(systemResults.metrics.grossMarginPercent)}</p>
                    <p className="text-xs text-muted-foreground">{formatCurrency(systemResults.metrics.grossMarginAmount)}</p>
                  </div>
                  <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">M&E Percent</p>
                    <p className="text-lg font-bold text-foreground">{formatPercent(systemResults.metrics.mePercent)}</p>
                  </div>
                  <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">Direct Labor</p>
                    <p className="text-lg font-bold text-foreground">{formatCurrency(systemDirectLabor)}</p>
                  </div>
                  <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">Other COGS</p>
                    <p className="text-lg font-bold text-foreground">{formatCurrency(systemOtherCogs)}</p>
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
                              <span className="text-[10px] text-muted-foreground font-medium">({formatPercent(systemEffectiveRevenue > 0 ? (systemMAndECost / systemEffectiveRevenue) * 100 : 0)})</span>
                              <span className="font-mono text-sm font-medium text-blue-700 dark:text-blue-400">{formatCurrency(systemMAndECost)}</span>
                            </div>
                          </div>
                          <div className="ml-5 space-y-0.5 pt-1 border-l-2 border-blue-100/50 dark:border-blue-900/30 pl-3">
                            {[
                              { label: "Materials", value: systemResults.breakdown.materials },
                              { label: "Equipment", value: systemResults.breakdown.equipment },
                              { label: `Sales Tax (${salesTaxPercent || "6.35"}%)`, value: systemResults.breakdown.tax },
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
                          <div className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                              <span className="text-sm font-semibold text-emerald-900 dark:text-emerald-300">Burdened Labor</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground font-medium">({formatPercent(systemEffectiveRevenue > 0 ? (systemResults.breakdown.laborCost / systemEffectiveRevenue) * 100 : 0)})</span>
                              <span className="font-mono text-sm font-medium text-emerald-700 dark:text-emerald-400">{formatCurrency(systemResults.breakdown.laborCost)}</span>
                            </div>
                          </div>
                          {laborMode === 'hours' && hoursVal > 0 && (() => {
                            const numTechsVal = Math.max(1, parseFloat(numTechs) || 1);
                            const totalHours = hoursVal * numTechsVal;
                            const hourlyRate = parseFloat(settings.laborHourlyRate);
                            const burdenRate = parseFloat(settings.laborBurdenPercent) / 100;
                            const directLabor = totalHours * hourlyRate;
                            const burden = directLabor * burdenRate;
                            const rows = [
                              ...(numTechsVal > 1 ? [{ label: `${numTechsVal} techs × ${hoursVal} hrs = ${totalHours} total hrs` }] : [{ label: `${hoursVal} hrs` }]),
                              { label: `${formatCurrency(hourlyRate)}/hr × ${totalHours} hrs`, value: directLabor },
                              { label: `Labor Burden (${settings.laborBurdenPercent}%)`, value: burden },
                            ];
                            return (
                              <div className="ml-5 space-y-0.5 pt-1 border-l-2 border-emerald-100/50 dark:border-emerald-900/30 pl-3">
                                {rows.map((row) => (
                                  <div key={row.label} className="flex justify-between items-center py-0.5">
                                    <span className="text-xs text-muted-foreground">{row.label}</span>
                                    {row.value !== undefined && <span className="text-xs font-mono text-muted-foreground">{formatCurrency(row.value)}</span>}
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                          <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/50">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                              <span className="text-sm text-foreground">Burdened Commission</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground font-medium">({formatPercent(systemEffectiveRevenue > 0 ? (systemResults.breakdown.commission / systemEffectiveRevenue) * 100 : 0)})</span>
                              <span className="font-mono text-sm font-medium text-muted-foreground">{formatCurrency(systemResults.breakdown.commission)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">Other COGS</h4>
                        <div className="space-y-1">
                          {[
                            { label: "Financing Fees", value: systemResults.breakdown.financing, color: "bg-violet-500" },
                            { label: "Subcontractor", value: systemResults.breakdown.subcontractor, color: "bg-orange-400" },
                            { label: "Crane", value: systemResults.breakdown.crane, color: "bg-pink-400" },
                            { label: "Permit", value: systemResults.breakdown.permit, color: "bg-cyan-400" },
                          ].map((item) => (
                            <div key={item.label} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/50">
                              <div className="flex items-center gap-2">
                                <div className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                                <span className="text-sm text-foreground">{item.label}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-muted-foreground font-medium">({formatPercent(systemEffectiveRevenue > 0 ? ((item.value || 0) / systemEffectiveRevenue) * 100 : 0)})</span>
                                <span className="font-mono text-sm font-medium text-muted-foreground">{formatCurrency(item.value || 0)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {systemTotalRebates > 0 && (
                        <div className="space-y-1.5">
                          <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">Rebates (Added Back to Revenue)</h4>
                          <div className="space-y-1">
                            {[
                              { label: "OEM Rebate", value: systemResults.breakdown.oemRebate, color: "bg-green-500" },
                              { label: "Utility Rebate", value: systemResults.breakdown.utilityRebate, color: "bg-teal-500" },
                            ].filter(item => item.value > 0).map((item) => (
                              <div key={item.label} className="flex items-center justify-between p-2.5 rounded-lg bg-green-50/50 dark:bg-green-950/20 border border-green-100/50 dark:border-green-900/30">
                                <div className="flex items-center gap-2">
                                  <div className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                                  <span className="text-sm font-semibold text-green-900 dark:text-green-300">{item.label}</span>
                                </div>
                                <span className="font-mono text-sm font-medium text-green-700 dark:text-green-400" data-testid={`text-reverse-${item.label.toLowerCase().replace(' ', '-')}`}>+{formatCurrency(item.value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-card rounded-xl border border-border p-4 shadow-sm flex flex-col items-center justify-start">
                    <h3 className="font-display font-bold text-base mb-2 text-center w-full">Distribution</h3>
                    <div className="w-full h-[180px] flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                          <Pie data={chartData} cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={3} dataKey="value" label={renderCustomLabel} labelLine={false}>
                            {chartData.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.color} stroke="none" />))}
                          </Pie>
                          <Tooltip formatter={(value: number, name: string, props: any) => [`${formatCurrency(value)} (${props.payload.percent.toFixed(2)}%)`, name]} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', zIndex: 1000 }} wrapperStyle={{ zIndex: 1000 }} />
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
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">COGS</p>
                    <p className="text-lg font-bold text-foreground">{formatCurrency(repairCogs)}</p>
                  </div>
                  <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">Direct Labor</p>
                    <p className="text-lg font-bold text-foreground">{formatCurrency(repairDirectLaborCost + repairDirectCommission)}</p>
                    <p className="text-xs text-muted-foreground">{formatPercent(repairPriceVal > 0 ? ((repairDirectLaborCost + repairDirectCommission) / repairPriceVal) * 100 : 0)}</p>
                  </div>
                  <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">Parts + Tax</p>
                    <p className="text-lg font-bold text-foreground">{formatCurrency(repairSubtotal1)}</p>
                  </div>
                  <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">Finance Fee</p>
                    <p className="text-lg font-bold text-foreground">{formatCurrency(repairFinancingFee)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2 bg-card rounded-xl border border-border p-4 shadow-sm">
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
                              <span className="text-[10px] text-muted-foreground font-medium">({formatPercent(repairPriceVal > 0 ? (repairMaterialsCost / repairPriceVal) * 100 : 0)})</span>
                              <span className="font-mono text-sm font-medium text-blue-700 dark:text-blue-400">{formatCurrency(repairMaterialsCost)}</span>
                            </div>
                          </div>
                          <div className="ml-5 space-y-0.5 pt-1 border-l-2 border-blue-100/50 dark:border-blue-900/30 pl-3">
                            {[
                              { label: "Parts Total", value: repairPartsTotal },
                              { label: `Sales Tax (${repairSalesTaxPercent}%)`, value: repairSalesTax },
                              { label: `Markup (${repairMaterialMarkup}%)`, value: repairMarkupAmount },
                            ].map((sub) => (
                              <div key={sub.label} className="flex justify-between items-center py-0.5">
                                <span className="text-xs text-muted-foreground">{sub.label}</span>
                                <span className="text-xs font-mono text-muted-foreground">{formatCurrency(sub.value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {repairLaborMode !== "percent" && (
                        <div className="space-y-1.5">
                          <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">Labor</h4>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30">
                              <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                                <span className="text-sm font-semibold text-emerald-900 dark:text-emerald-300">Burdened Labor</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-muted-foreground font-medium">({formatPercent(repairPriceVal > 0 ? (repairBurdenedLaborCost / repairPriceVal) * 100 : 0)})</span>
                                <span className="font-mono text-sm font-medium text-emerald-700 dark:text-emerald-400">{formatCurrency(repairBurdenedLaborCost)}</span>
                              </div>
                            </div>
                            <div className="ml-5 space-y-0.5 pt-1 border-l-2 border-emerald-100/50 dark:border-emerald-900/30 pl-3">
                              {[
                                { label: `Labor (${repairLaborHoursVal} hrs x ${formatCurrency(repairHighestTechRateVal)}/hr)`, value: repairDirectLaborCost },
                                { label: `Labor Burden (${repairBurdenPercent}%)`, value: repairLaborBurden },
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
                          {repairLaborMode === "percent" ? "Commission (incl. Labor)" : "Commission"}
                        </h4>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100/50 dark:border-amber-900/30">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                              <span className="text-sm font-semibold text-amber-900 dark:text-amber-300">Burdened Commission</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground font-medium">({formatPercent(repairPriceVal > 0 ? (repairBurdenedCommission / repairPriceVal) * 100 : 0)})</span>
                              <span className="font-mono text-sm font-medium text-amber-700 dark:text-amber-400">{formatCurrency(repairBurdenedCommission)}</span>
                            </div>
                          </div>
                          <div className="ml-5 space-y-0.5 pt-1 border-l-2 border-amber-100/50 dark:border-amber-900/30 pl-3">
                            {[
                              { label: `Commission (${repairCommissionPercent}%)`, value: repairDirectCommission },
                              { label: `Commission Burden (${repairBurdenPercent}%)`, value: repairCommissionBurden },
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
                        <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">Other Fees</h4>
                        <div className="flex items-center justify-between p-2.5 rounded-lg bg-violet-50/50 dark:bg-violet-950/20 border border-violet-100/50 dark:border-violet-900/30">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                            <span className="text-sm font-semibold text-violet-900 dark:text-violet-300">Finance Fee ({repairFinancingFeePercent}%)</span>
                          </div>
                          <span className="font-mono text-sm font-medium text-violet-700 dark:text-violet-400">{formatCurrency(repairFinancingFee)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-card rounded-xl border border-border p-4 shadow-sm flex flex-col">
                    <h3 className="font-display font-bold text-base mb-1">Price Comparison</h3>
                    <p className="text-[10px] text-muted-foreground mb-3">Formula price vs your selling price</p>
                    {repairPriceVal > 0 && repairCalculatedPrice > 0 ? (
                      <>
                        {/* Stacked bar chart — no floating tooltip */}
                        <div className="w-full h-[200px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={priceComparisonData} margin={{ top: 22, right: 6, bottom: 4, left: 6 }} barCategoryGap="35%" barGap={4}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                              <XAxis dataKey="name" tick={{ fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} />
                              <YAxis tickFormatter={(v) => `$${Math.round(v)}`} tick={{ fontSize: 9 }} width={50} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                              {COMPARISON_SEGMENTS.map(seg => (
                                <Bar key={seg.key} dataKey={seg.key} stackId="price" fill={seg.color} />
                              ))}
                              <Bar dataKey="Margin" stackId="price" radius={[4, 4, 0, 0]}>
                                {priceComparisonData.map((entry, i) => (
                                  <Cell key={`m-${i}`} fill={entry["Margin"] >= 0 ? "#22c55e" : "#ef4444"} />
                                ))}
                                <LabelList dataKey="total" position="top" formatter={(v: number) => formatCurrency(v)} style={{ fontSize: '10px', fontWeight: 700, fill: 'hsl(var(--foreground))' }} />
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>

                        {/* Static comparison table — replaces tooltip */}
                        <div className="mt-3 border border-border rounded-lg overflow-hidden text-[10px]">
                          <div className="grid grid-cols-3 bg-muted/60 px-2 py-1 font-bold text-muted-foreground uppercase tracking-wide">
                            <span>Segment</span>
                            <span className="text-right">Calculated</span>
                            <span className="text-right">Selling</span>
                          </div>
                          {[
                            { label: "Parts + Tax", calc: repairSubtotal1, sold: repairSubtotal1, color: "#6b7280" },
                            { label: "Markup", calc: repairMarkupAmount, sold: repairMarkupAmount, color: "#3b82f6" },
                            ...(repairBurdenedLaborCost > 0 ? [{ label: "Labor", calc: repairBurdenedLaborCost, sold: repairBurdenedLaborCost, color: "#10b981" }] : []),
                            { label: "Commission", calc: calcCommission, sold: enteredCommission, color: "#f59e0b" },
                            { label: "Financing", calc: calcFinancing, sold: enteredFinancing, color: "#8b5cf6" },
                            { label: "Margin", calc: calcMargin, sold: enteredMargin, color: enteredMargin >= 0 ? "#22c55e" : "#ef4444" },
                          ].map(row => (
                            <div key={row.label} className="grid grid-cols-3 px-2 py-1 border-t border-border/50 hover:bg-muted/30 transition-colors">
                              <span className="flex items-center gap-1.5 font-medium text-foreground">
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: row.color }} />
                                {row.label}
                              </span>
                              <span className="text-right font-mono text-muted-foreground">{formatCurrency(row.calc)}</span>
                              <span className={`text-right font-mono ${row.label === "Margin" ? (row.sold >= 0 ? "text-green-600 font-bold" : "text-red-500 font-bold") : "text-muted-foreground"}`}>
                                {formatCurrency(row.sold)}
                              </span>
                            </div>
                          ))}
                          <div className="grid grid-cols-3 px-2 py-1.5 border-t-2 border-border bg-muted/30 font-bold">
                            <span className="text-foreground uppercase tracking-wide text-[9px]">Total</span>
                            <span className="text-right font-mono text-foreground">{formatCurrency(repairCalculatedPrice)}</span>
                            <span className={`text-right font-mono ${repairPriceVal >= repairCalculatedPrice ? "text-green-600" : "text-red-500"}`}>
                              {formatCurrency(repairPriceVal)}
                            </span>
                          </div>
                        </div>

                        {/* Delta callout */}
                        <div className={`mt-2 text-center text-[10px] font-bold px-2 py-1 rounded ${repairPriceVal >= repairCalculatedPrice ? "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400" : "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400"}`}>
                          {repairPriceVal >= repairCalculatedPrice
                            ? `+${formatCurrency(repairPriceVal - repairCalculatedPrice)} above formula price`
                            : `${formatCurrency(repairPriceVal - repairCalculatedPrice)} below formula price`}
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm py-8">
                        Enter a selling price and parts cost to see comparison
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
