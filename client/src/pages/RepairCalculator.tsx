import { useState, useEffect } from "react";
import { useSettings } from "@/hooks/use-settings";
import { InputMoney } from "@/components/InputMoney";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RefreshCw, Loader2 } from "lucide-react";

export default function RepairCalculator() {
  const { settings, isLoading: settingsLoading } = useSettings();

  // Input state
  const [partsCost, setPartsCost] = useState("0");
  const [materialMarkup, setMaterialMarkup] = useState("200");
  const [laborRate, setLaborRate] = useState("175.00");
  const [laborHours, setLaborHours] = useState("1");
  const [burdenPercent, setBurdenPercent] = useState("20.00");
  const [salesTaxPercent, setSalesTaxPercent] = useState("6.35");
  const [commissionPercent, setCommissionPercent] = useState("10.00");
  const [financingFeePercent, setFinancingFeePercent] = useState("4.00");
  const [roundUp, setRoundUp] = useState(false);
  const [psiMode, setPsiMode] = useState(false);

  // Handle PSI mode toggle
  const handlePsiToggle = (enabled: boolean) => {
    setPsiMode(enabled);
    if (enabled) {
      setMaterialMarkup("40");
      setLaborRate("600");
      setSalesTaxPercent("7.4");
    } else {
      // Reset to defaults from settings or standard defaults
      setMaterialMarkup("200");
      setLaborRate(settings?.laborHourlyRate || "175.00");
      setSalesTaxPercent(settings?.salesTaxPercent || "6.35");
    }
  };

  // Generate markup options from 200% down to 10% in increments of 10
  const markupOptions = Array.from({ length: 20 }, (_, i) => 200 - i * 10);

  // Initialize from settings
  useEffect(() => {
    if (settings) {
      setSalesTaxPercent(settings.salesTaxPercent || "6.35");
      setCommissionPercent(settings.commissionPercent || "10.00");
      setLaborRate(settings.laborHourlyRate || "175.00");
      setBurdenPercent(settings.laborBurdenPercent || "20.00");
      setFinancingFeePercent(settings.financingFeePercent || "4.00");
    }
  }, [settings]);

  // Calculated values - rates
  const partsTotal = parseFloat(partsCost) || 0;
  const markupRate = (parseFloat(materialMarkup) || 200) / 100;
  const laborRateVal = parseFloat(laborRate) || 0;
  const laborHoursVal = parseFloat(laborHours) || 0;
  const burdenRate = (parseFloat(burdenPercent) || 0) / 100;
  const taxRate = (parseFloat(salesTaxPercent) || 0) / 100;
  const commissionRate = (parseFloat(commissionPercent) || 0) / 100;
  const financingRate = (parseFloat(financingFeePercent) || 0) / 100;

  // Step 1: Parts + Tax
  const salesTax = partsTotal * taxRate;
  const subtotal1 = partsTotal + salesTax;

  // Step 2: Apply markup (ADDED on top, not replacing)
  const markupAmount = subtotal1 * markupRate;
  const subtotal2 = subtotal1 + markupAmount;

  // Step 3: Add Labor (with burden)
  const directLaborCost = laborRateVal * laborHoursVal;
  const laborBurden = directLaborCost * burdenRate;
  const burdenedLaborCost = directLaborCost + laborBurden;
  const subtotal3 = subtotal2 + burdenedLaborCost;

  // Step 4: Add Commission (with same burden rate)
  const directCommission = subtotal3 * commissionRate;
  const commissionBurden = directCommission * burdenRate;
  const burdenedCommission = directCommission + commissionBurden;
  const subtotal4 = subtotal3 + burdenedCommission;

  // Step 5: Add Financing Fee
  const financingFee = subtotal4 * financingRate;
  const totalBeforeRounding = subtotal4 + financingFee;
  const totalPrice = roundUp ? Math.ceil(totalBeforeRounding) : totalBeforeRounding;

  // Margin calculation - COGS = raw parts cost + direct labor (what you actually pay out)
  const cogs = partsTotal + directLaborCost;
  const grossMargin = totalPrice - cogs;
  const grossMarginPercent = totalPrice > 0 ? (grossMargin / totalPrice) * 100 : 0;

  // Margin health calculation
  const getMarginHealth = () => {
    if (grossMarginPercent >= 50) {
      return { status: 'strong', label: 'Strong', color: 'bg-emerald-500', textColor: 'text-emerald-600' };
    } else if (grossMarginPercent >= 40) {
      return { status: 'caution', label: 'Caution', color: 'bg-amber-500', textColor: 'text-amber-600' };
    } else {
      return { status: 'danger', label: 'Low', color: 'bg-red-500', textColor: 'text-red-600' };
    }
  };
  const marginHealth = getMarginHealth();

  const handleReset = () => {
    setPartsCost("0");
    setMaterialMarkup("200");
    setLaborHours("1");
    setPsiMode(false);
    if (settings) {
      setSalesTaxPercent(settings.salesTaxPercent || "6.35");
      setCommissionPercent(settings.commissionPercent || "10.00");
      setLaborRate(settings.laborHourlyRate || "175.00");
      setBurdenPercent(settings.laborBurdenPercent || "20.00");
      setFinancingFeePercent(settings.financingFeePercent || "4.00");
    }
    setRoundUp(false);
  };

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

  if (settingsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Repair Calculator</h1>
          <p className="text-muted-foreground mt-1">Calculate pricing for HVAC repair jobs.</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="psiMode" className="text-sm font-medium cursor-pointer">
              PSI
            </Label>
            <Switch
              id="psiMode"
              checked={psiMode}
              onCheckedChange={handlePsiToggle}
              data-testid="switch-psi-mode"
            />
          </div>
          <Button variant="outline" onClick={handleReset} className="gap-2" data-testid="button-reset">
            <RefreshCw size={16} />
            Reset
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Input Column */}
        <div className="lg:col-span-3 space-y-2">
          {/* Parts Section */}
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

          {/* Labor Section */}
          <div className="bg-card rounded-lg p-3 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border">
              <span className="w-5 h-5 rounded bg-blue-500/10 text-blue-600 flex items-center justify-center text-[10px] font-bold">2</span>
              <h2 className="font-display font-semibold text-sm">Labor</h2>
            </div>

            <div className="space-y-2">
              <InputMoney
                label="Labor Rate"
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
            </div>
          </div>

          {/* Fees Section */}
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
                label="Financing Fee %"
                type="percent"
                placeholder="6.00"
                value={financingFeePercent}
                onChange={(e) => setFinancingFeePercent(e.target.value)}
                data-testid="input-financing-fee"
              />

              <div className="flex items-center justify-between pt-2">
                <Label htmlFor="roundUp" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer">
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

        {/* Results Column */}
        <div className="lg:col-span-9 space-y-4">
          {/* Primary Results */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Total Price Card */}
            <div className="bg-card rounded-lg p-4 shadow-sm border border-border">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-primary text-lg font-bold">$</span>
                </div>
                <span className="text-sm font-medium text-muted-foreground">Total Price</span>
              </div>
              <div className="text-4xl font-bold text-primary" data-testid="text-total-price">
                {formatCurrency(totalPrice)}
              </div>
              {roundUp && totalBeforeRounding !== totalPrice && (
                <div className="text-xs text-muted-foreground mt-1">
                  Before rounding: {formatCurrency(totalBeforeRounding)}
                </div>
              )}
            </div>

            {/* Gross Margin Card */}
            <div className="bg-card rounded-lg p-4 shadow-sm border border-border">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-full ${marginHealth.color}/10 flex items-center justify-center`}>
                  <span className={`${marginHealth.textColor} text-lg font-bold`}>%</span>
                </div>
                <span className="text-sm font-medium text-muted-foreground">Gross Margin</span>
                <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${marginHealth.color} text-white`}>
                  {marginHealth.label}
                </span>
              </div>
              <div className={`text-4xl font-bold ${marginHealth.textColor}`} data-testid="text-margin-percent">
                {grossMarginPercent.toFixed(1)}%
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {formatCurrency(grossMargin)} profit
              </div>
            </div>
          </div>

          {/* Price Breakdown */}
          <div className="bg-card rounded-lg p-4 shadow-sm border border-border">
            <h3 className="font-display font-semibold text-sm mb-4 pb-2 border-b border-border">Price Breakdown</h3>
            
            <div className="space-y-3">
              {/* Parts + Tax */}
              <div className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Parts Total</span>
                  <span className="font-medium">{formatCurrency(partsTotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Sales Tax ({salesTaxPercent}%)</span>
                  <span className="font-medium">{formatCurrency(salesTax)}</span>
                </div>
                <div className="flex justify-between text-sm font-medium border-t border-dashed border-border pt-1">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal1)}</span>
                </div>
              </div>

              {/* Markup */}
              <div className="space-y-1 pt-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{materialMarkup}% Markup</span>
                  <span className="font-medium">{formatCurrency(markupAmount)}</span>
                </div>
                <div className="flex justify-between text-sm font-medium border-t border-dashed border-border pt-1">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal2)}</span>
                </div>
              </div>

              {/* Labor */}
              <div className="space-y-1 pt-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Labor ({laborHoursVal} hrs × {formatCurrency(laborRateVal)}/hr)</span>
                  <span className="font-medium">{formatCurrency(directLaborCost)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Labor Burden ({burdenPercent}%)</span>
                  <span className="font-medium">{formatCurrency(laborBurden)}</span>
                </div>
                <div className="flex justify-between text-sm font-medium border-t border-dashed border-border pt-1">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal3)}</span>
                </div>
              </div>

              {/* Commission */}
              <div className="space-y-1 pt-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Commission ({commissionPercent}%)</span>
                  <span className="font-medium">{formatCurrency(directCommission)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Commission Burden ({burdenPercent}%)</span>
                  <span className="font-medium">{formatCurrency(commissionBurden)}</span>
                </div>
                <div className="flex justify-between text-sm font-medium border-t border-dashed border-border pt-1">
                  <span>Subtotal</span>
                  <span>{formatCurrency(subtotal4)}</span>
                </div>
              </div>

              {/* Financing */}
              <div className="space-y-1 pt-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Financing Fee ({financingFeePercent}%)</span>
                  <span className="font-medium">{formatCurrency(financingFee)}</span>
                </div>
              </div>

              {/* COGS & Burden Summary */}
              <div className="space-y-1 pt-2 bg-muted/30 rounded-lg p-3 -mx-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">COGS (Parts + Direct Labor)</span>
                  <span className="font-medium">{formatCurrency(cogs)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Burden</span>
                  <span className="font-medium">{formatCurrency(laborBurden + commissionBurden)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Gross Profit</span>
                  <span className={`font-medium ${marginHealth.textColor}`}>{formatCurrency(grossMargin)}</span>
                </div>
              </div>

              {/* Final Total */}
              <div className="flex justify-between items-center pt-4 border-t-2 border-border">
                <span className="text-lg font-bold">Total Price</span>
                <span className="text-2xl font-bold text-primary">{formatCurrency(totalPrice)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
