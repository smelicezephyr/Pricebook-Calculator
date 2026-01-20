import { DollarSign, TrendingUp, Users } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Label } from "recharts";
import { Switch } from "@/components/ui/switch";
import { Label as UILabel } from "@/components/ui/label";

interface ResultsCardProps {
  price: number;
  estimatedLabor: number;
  salesTaxRate?: string;
  discount?: number;
  roundUp?: boolean;
  onRoundUpChange?: (value: boolean) => void;
  breakdown: {
    materials: number;
    equipment: number;
    tax: number;
    commission: number;
    financing: number;
    laborCost: number;
    subcontractor?: number;
    crane?: number;
    permit?: number;
  };
  metrics: {
    grossMarginPercent: number;
    grossMarginAmount: number;
    mePercent: number;
  };
}

const formatCurrency = (val: number) => 
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

const formatPercent = (val: number) => 
  `${val.toFixed(2)}%`;

export function ResultsCard({ price, estimatedLabor, breakdown, metrics, salesTaxRate, discount = 0, roundUp = false, onRoundUpChange }: ResultsCardProps) {
  const displayPrice = roundUp ? Math.ceil(price) : price;
  const totalOtherCogs = (breakdown.financing || 0) + (breakdown.subcontractor || 0) + (breakdown.crane || 0) + (breakdown.permit || 0);
  const mAndECost = (breakdown.materials || 0) + (breakdown.equipment || 0) + (breakdown.tax || 0);
  const directLaborCost = (breakdown.laborCost || 0) + (breakdown.commission || 0);
  const grossMargin = metrics.grossMarginAmount;

  const chartData = [
    { name: 'Gross Margin', value: grossMargin, color: '#f59e0b', percent: price > 0 ? (grossMargin / price) * 100 : 0 },
    { name: 'M&E', value: mAndECost, color: '#3b82f6', percent: price > 0 ? (mAndECost / price) * 100 : 0 }, 
    { name: 'Direct Labor', value: directLaborCost, color: '#10b981', percent: price > 0 ? (directLaborCost / price) * 100 : 0 },
    { name: 'Other COGS', value: totalOtherCogs, color: '#8b5cf6', percent: price > 0 ? (totalOtherCogs / price) * 100 : 0 },
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

  return (
    <div className="space-y-6">
      {/* Primary Result */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-primary text-primary-foreground rounded-2xl p-6 shadow-xl shadow-primary/20 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <DollarSign size={120} />
          </div>
          <div className="relative z-10">
            <p className="text-primary-foreground/80 font-medium mb-1">Total Price</p>
            <h2 className="text-4xl font-display font-bold tracking-tight">
              {formatCurrency(displayPrice)}
            </h2>
            {discount > 0 && (
              <p className="text-sm text-primary-foreground/80 mt-2 font-medium">
                Includes discount of {formatCurrency(discount)}
              </p>
            )}
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-primary-foreground/20">
              <Switch
                id="round-up-toggle"
                checked={roundUp}
                onCheckedChange={onRoundUpChange}
                data-testid="switch-round-up"
                className="data-[state=checked]:bg-primary-foreground data-[state=unchecked]:bg-primary-foreground/30"
              />
              <UILabel 
                htmlFor="round-up-toggle" 
                className="text-sm text-primary-foreground/90 cursor-pointer"
              >
                Round up to whole dollar
              </UILabel>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-lg shadow-black/5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 text-emerald-500 opacity-5 group-hover:opacity-10 transition-opacity">
            <Users size={120} />
          </div>
          <div className="relative z-10">
            <p className="text-muted-foreground font-medium mb-1">Estimated Labor Field</p>
            <h2 className="text-4xl font-display font-bold tracking-tight text-emerald-600">
              {formatCurrency(estimatedLabor)}
            </h2>
            <p className="text-[10px] text-muted-foreground mt-2 italic leading-tight">
              * This is for the estimated labor field of the service in ServiceTitan
            </p>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border border-border shadow-sm">
          <p className="text-xs text-muted-foreground uppercase font-bold mb-1">Gross Margin</p>
          <p className="text-xl font-bold text-foreground">{formatPercent(metrics.grossMarginPercent)}</p>
          <p className="text-xs text-muted-foreground mt-1">{formatCurrency(metrics.grossMarginAmount)}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-border shadow-sm">
          <p className="text-xs text-muted-foreground uppercase font-bold mb-1">M&E Percent</p>
          <p className="text-xl font-bold text-foreground">{formatPercent(metrics.mePercent)}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-border shadow-sm">
          <p className="text-xs text-muted-foreground uppercase font-bold mb-1">Direct Labor</p>
          <p className="text-xl font-bold text-foreground">{formatCurrency(directLaborCost)}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-border shadow-sm">
          <p className="text-xs text-muted-foreground uppercase font-bold mb-1">Other COGS</p>
          <p className="text-xl font-bold text-foreground">{formatCurrency(totalOtherCogs)}</p>
        </div>
      </div>

      {/* Chart & Detailed Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Breakdown List */}
        <div className="lg:col-span-2 bg-card rounded-2xl border border-border p-6 shadow-sm">
          <div className="mb-4">
            <h3 className="font-display font-bold text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" /> Cost Breakdown
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">Note: Labor and Commission include burdens</p>
          </div>
          
          <div className="space-y-6">
            {/* M&E Group */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-1">M&E (Includes Tax)</h4>
              <div className="space-y-1">
                <div className="flex items-center justify-between p-3 rounded-lg bg-blue-50/50 border border-blue-100/50">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                    <span className="text-sm font-semibold text-blue-900">Total M&E</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground font-medium">
                      ({formatPercent(price > 0 ? (mAndECost / price) * 100 : 0)})
                    </span>
                    <span className="font-mono font-medium text-blue-700">
                      {formatCurrency(mAndECost)}
                    </span>
                  </div>
                </div>
                
                {/* M&E Breakdown Sub-items */}
                <div className="ml-6 space-y-1 pt-1 border-l-2 border-blue-100/50 pl-4">
                  {[
                    { label: "Materials", value: breakdown.materials },
                    { label: "Equipment", value: breakdown.equipment },
                    { label: `Sales Tax (${salesTaxRate || "6.35"}%)`, value: breakdown.tax },
                  ].map((sub) => (
                    <div key={sub.label} className="flex justify-between items-center py-1">
                      <span className="text-xs text-muted-foreground">{sub.label}</span>
                      <span className="text-xs font-mono text-muted-foreground">{formatCurrency(sub.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Direct Labor Group */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-1">Direct Labor</h4>
              <div className="space-y-1">
                {[
                  { label: "Burdened Labor", value: breakdown.laborCost, color: "bg-emerald-500", highlight: true },
                  { label: "Burdened Commission", value: breakdown.commission, color: "bg-amber-500" },
                ].map((item) => (
                  <div key={item.label} className={`flex items-center justify-between p-3 rounded-lg ${item.highlight ? 'bg-emerald-50 border border-emerald-100' : 'hover:bg-muted/50'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${item.color}`} />
                      <span className={`text-sm ${item.highlight ? 'font-semibold text-emerald-900' : 'text-foreground'}`}>
                        {item.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground font-medium">
                        ({formatPercent(price > 0 ? (item.value / price) * 100 : 0)})
                      </span>
                      <span className={`font-mono font-medium ${item.highlight ? 'text-emerald-700' : 'text-muted-foreground'}`}>
                        {formatCurrency(item.value)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Other COGS Group */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-1">Other COGS</h4>
              <div className="space-y-1">
                {[
                  { label: "Financing Fees", value: breakdown.financing, color: "bg-violet-500" },
                  { label: "Subcontractor", value: breakdown.subcontractor, color: "bg-orange-400" },
                  { label: "Crane", value: breakdown.crane, color: "bg-pink-400" },
                  { label: "Permit", value: breakdown.permit, color: "bg-cyan-400" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${item.color}`} />
                      <span className="text-sm text-foreground">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground font-medium">
                        ({formatPercent(price > 0 ? ((item.value || 0) / price) * 100 : 0)})
                      </span>
                      <span className="font-mono font-medium text-muted-foreground">
                        {formatCurrency(item.value || 0)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Pie Chart */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm flex flex-col items-center justify-center min-h-[300px]">
          <h3 className="font-display font-bold text-lg mb-2 text-center w-full">Distribution</h3>
          <div className="w-full h-[220px] flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={65}
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
          <div className="flex flex-wrap justify-center gap-3 text-xs mt-2">
            {chartData.map(d => (
              <div key={d.name} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                <span className="text-muted-foreground font-medium">{d.name}: {d.percent.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
