import { useState, useEffect } from "react";
import { useSettings } from "@/hooks/use-settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, DollarSign, Clock, Percent, Wrench, TrendingUp } from "lucide-react";

export default function RepairCalculator() {
  const { settings, isLoading: settingsLoading } = useSettings();

  // Input state
  const [materialsCost, setMaterialsCost] = useState("0");
  const [materialMarkup, setMaterialMarkup] = useState("200");
  const [laborRate, setLaborRate] = useState("125.00");
  const [laborHours, setLaborHours] = useState("1");
  const [laborBurdenPercent, setLaborBurdenPercent] = useState("20.00");
  const [salesTaxPercent, setSalesTaxPercent] = useState("6.35");
  const [commissionPercent, setCommissionPercent] = useState("10.00");
  const [commissionBurdenPercent, setCommissionBurdenPercent] = useState("20.00");
  const [roundUp, setRoundUp] = useState(false);

  // Generate markup options from 200% down to 10% in increments of 10
  const markupOptions = Array.from({ length: 20 }, (_, i) => 200 - i * 10);

  // Initialize from settings
  useEffect(() => {
    if (settings) {
      setSalesTaxPercent(settings.salesTaxPercent || "6.35");
      setCommissionPercent(settings.commissionPercent || "10.00");
      setLaborRate(settings.laborHourlyRate || "125.00");
      setLaborBurdenPercent(settings.laborBurdenPercent || "20.00");
      setCommissionBurdenPercent(settings.commissionBurdenPercent || "20.00");
    }
  }, [settings]);

  // Calculated values
  const materialsVal = parseFloat(materialsCost) || 0;
  const markupRate = (parseFloat(materialMarkup) || 200) / 100;
  const markedUpMaterials = materialsVal * markupRate;
  const laborRateVal = parseFloat(laborRate) || 0;
  const laborHoursVal = parseFloat(laborHours) || 0;
  const laborBurdenRate = (parseFloat(laborBurdenPercent) || 0) / 100;
  const taxRate = (parseFloat(salesTaxPercent) || 0) / 100;
  const commissionRate = (parseFloat(commissionPercent) || 0) / 100;
  const commissionBurdenRate = (parseFloat(commissionBurdenPercent) || 0) / 100;

  // Calculations - tax is applied to marked-up materials
  const tax = markedUpMaterials * taxRate;
  const directLaborCost = laborRateVal * laborHoursVal;
  const laborBurden = directLaborCost * laborBurdenRate;
  const burdenedLaborCost = directLaborCost + laborBurden;
  const subtotal = markedUpMaterials + tax + burdenedLaborCost;
  const directCommission = subtotal * commissionRate;
  const commissionBurden = directCommission * commissionBurdenRate;
  const burdenedCommission = directCommission + commissionBurden;
  const totalPrice = roundUp ? Math.ceil(subtotal + burdenedCommission) : subtotal + burdenedCommission;

  // Margin calculation - COGS uses raw materials cost + burdened labor (true costs)
  const cogs = materialsVal + burdenedLaborCost;  // Raw materials + burdened labor cost
  const grossMargin = totalPrice - cogs;  // Profit from markup + commission
  const grossMarginPercent = totalPrice > 0 ? (grossMargin / totalPrice) * 100 : 0;

  const handleReset = () => {
    setMaterialsCost("0");
    setMaterialMarkup("200");
    setLaborHours("1");
    if (settings) {
      setSalesTaxPercent(settings.salesTaxPercent || "6.35");
      setCommissionPercent(settings.commissionPercent || "10.00");
      setLaborRate(settings.laborHourlyRate || "125.00");
      setLaborBurdenPercent(settings.laborBurdenPercent || "20.00");
      setCommissionBurdenPercent(settings.commissionBurdenPercent || "20.00");
    }
    setRoundUp(false);
  };

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-3">
            <Wrench className="w-8 h-8 text-primary" />
            Repair Calculator
          </h1>
          <p className="text-muted-foreground mt-1">
            Calculate pricing for HVAC repair jobs
          </p>
        </div>
        <Button variant="outline" onClick={handleReset} data-testid="button-reset">
          <RefreshCw className="w-4 h-4 mr-2" />
          Reset
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Inputs Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Job Inputs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Materials Cost */}
            <div className="space-y-2">
              <Label htmlFor="materialsCost" className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-muted-foreground" />
                Materials Cost
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="materialsCost"
                  type="number"
                  step="0.01"
                  min="0"
                  value={materialsCost}
                  onChange={(e) => setMaterialsCost(e.target.value)}
                  className="pl-7"
                  data-testid="input-materials-cost"
                />
              </div>
            </div>

            {/* Material Markup */}
            <div className="space-y-2">
              <Label htmlFor="materialMarkup" className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-muted-foreground" />
                Material Mark Up
              </Label>
              <Select value={materialMarkup} onValueChange={setMaterialMarkup}>
                <SelectTrigger id="materialMarkup" data-testid="select-material-markup">
                  <SelectValue placeholder="Select markup" />
                </SelectTrigger>
                <SelectContent>
                  {markupOptions.map((option) => (
                    <SelectItem key={option} value={option.toString()}>
                      {option}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Labor Rate */}
            <div className="space-y-2">
              <Label htmlFor="laborRate" className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-muted-foreground" />
                Labor Rate (per hour)
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="laborRate"
                  type="number"
                  step="0.01"
                  min="0"
                  value={laborRate}
                  onChange={(e) => setLaborRate(e.target.value)}
                  className="pl-7"
                  data-testid="input-labor-rate"
                />
              </div>
            </div>

            {/* Labor Hours */}
            <div className="space-y-2">
              <Label htmlFor="laborHours" className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                Labor Hours
              </Label>
              <Input
                id="laborHours"
                type="number"
                step="0.25"
                min="0"
                value={laborHours}
                onChange={(e) => setLaborHours(e.target.value)}
                data-testid="input-labor-hours"
              />
            </div>

            {/* Labor Burden */}
            <div className="space-y-2">
              <Label htmlFor="laborBurden" className="flex items-center gap-2">
                <Percent className="w-4 h-4 text-muted-foreground" />
                Labor Burden %
              </Label>
              <div className="relative">
                <Input
                  id="laborBurden"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={laborBurdenPercent}
                  onChange={(e) => setLaborBurdenPercent(e.target.value)}
                  className="pr-7"
                  data-testid="input-labor-burden"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
            </div>

            {/* Sales Tax */}
            <div className="space-y-2">
              <Label htmlFor="salesTax" className="flex items-center gap-2">
                <Percent className="w-4 h-4 text-muted-foreground" />
                Sales Tax %
              </Label>
              <div className="relative">
                <Input
                  id="salesTax"
                  type="number"
                  step="0.01"
                  min="0"
                  max="20"
                  value={salesTaxPercent}
                  onChange={(e) => setSalesTaxPercent(e.target.value)}
                  className="pr-7"
                  data-testid="input-sales-tax"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
            </div>

            {/* Commission Rate */}
            <div className="space-y-2">
              <Label htmlFor="commission" className="flex items-center gap-2">
                <Percent className="w-4 h-4 text-muted-foreground" />
                Commission Rate %
              </Label>
              <div className="relative">
                <Input
                  id="commission"
                  type="number"
                  step="0.01"
                  min="0"
                  max="50"
                  value={commissionPercent}
                  onChange={(e) => setCommissionPercent(e.target.value)}
                  className="pr-7"
                  data-testid="input-commission"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
            </div>

            {/* Commission Burden */}
            <div className="space-y-2">
              <Label htmlFor="commissionBurden" className="flex items-center gap-2">
                <Percent className="w-4 h-4 text-muted-foreground" />
                Commission Burden %
              </Label>
              <div className="relative">
                <Input
                  id="commissionBurden"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={commissionBurdenPercent}
                  onChange={(e) => setCommissionBurdenPercent(e.target.value)}
                  className="pr-7"
                  data-testid="input-commission-burden"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
            </div>

            {/* Round Up Toggle */}
            <div className="flex items-center space-x-2 pt-2">
              <Checkbox
                id="roundUp"
                checked={roundUp}
                onCheckedChange={(checked) => setRoundUp(checked === true)}
                data-testid="checkbox-round-up"
              />
              <Label htmlFor="roundUp" className="cursor-pointer">
                Round up to nearest dollar
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* Results Card */}
        <Card className="bg-gradient-to-br from-primary/5 to-primary/10">
          <CardHeader>
            <CardTitle className="text-lg">Price Calculation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Breakdown */}
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Materials Cost</span>
                <span className="font-medium">${materialsVal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Marked Up Materials ({materialMarkup}%)</span>
                <span className="font-medium">${markedUpMaterials.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Sales Tax ({salesTaxPercent}%)</span>
                <span className="font-medium">${tax.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Direct Labor ({laborHoursVal} hrs × ${laborRateVal}/hr)</span>
                <span className="font-medium">${directLaborCost.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Labor Burden ({laborBurdenPercent}%)</span>
                <span className="font-medium">${laborBurden.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Burdened Labor</span>
                <span className="font-medium">${burdenedLaborCost.toFixed(2)}</span>
              </div>
              <div className="border-t border-border pt-2 flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Direct Commission ({commissionPercent}%)</span>
                <span className="font-medium">${directCommission.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Commission Burden ({commissionBurdenPercent}%)</span>
                <span className="font-medium">${commissionBurden.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Burdened Commission</span>
                <span className="font-medium">${burdenedCommission.toFixed(2)}</span>
              </div>
            </div>

            {/* Total Price */}
            <div className="border-t border-border pt-4">
              <div className="flex justify-between items-center">
                <span className="text-lg font-medium">Total Price</span>
                <span className="text-3xl font-bold text-primary" data-testid="text-total-price">
                  ${totalPrice.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Margin Info */}
            <div className="bg-background/50 rounded-lg p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Gross Margin</span>
                <span className="font-medium">${grossMargin.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Margin %</span>
                <span className={`font-medium ${grossMarginPercent >= 30 ? 'text-green-600' : grossMarginPercent >= 20 ? 'text-yellow-600' : 'text-red-600'}`}>
                  {grossMarginPercent.toFixed(1)}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
