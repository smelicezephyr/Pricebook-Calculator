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
  grossMarginMinPercent?: number;
  oemRebate?: number;
  utilityRebate?: number;
  partsOnly?: boolean;
  laborBreakdown?: {
    hours: number;
    numTechs: number;
    hourlyRate: number;
    burdenPercent: number;
  };
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

export function ResultsCard({ price, estimatedLabor, breakdown, metrics, salesTaxRate, discount = 0, roundUp = false, onRoundUpChange, grossMarginMinPercent = 52, oemRebate = 0, utilityRebate = 0, partsOnly = false, laborBreakdown }: ResultsCardProps) {
  // price is already rounded if roundUp is enabled (handled in Calculator)
  const totalOtherCogs = (breakdown.financing || 0) + (breakdown.subcontractor || 0) + (breakdown.crane || 0) + (breakdown.permit || 0);
  const mAndECost = (breakdown.materials || 0) + (breakdown.equipment || 0) + (breakdown.tax || 0);
  const directLaborCost = (breakdown.laborCost || 0) + (breakdown.commission || 0);
  const grossMargin = metrics.grossMarginAmount;
  
  // Margin health calculation with 1% tolerance
  const getMarginHealth = () => {
    const currentMargin = metrics.grossMarginPercent;
    const minMargin = grossMarginMinPercent;
    
    if (currentMargin >= minMargin) {
      return { status: 'strong', label: 'Margin Health: Strong', color: 'bg-emerald-500', glow: '0 0 8px 2px rgba(16, 185, 129, 0.6)' };
    } else if (currentMargin >= minMargin - 2) {
      return { status: 'caution', label: 'Margin Health: Caution', color: 'bg-amber-500', glow: '0 0 8px 2px rgba(245, 158, 11, 0.6)' };
    } else {
      return { status: 'danger', label: 'Margin Health: Low', color: 'bg-red-500', glow: '0 0 8px 2px rgba(239, 68, 68, 0.6)' };
    }
  };
  
  const marginHealth = getMarginHealth();

  const chartData = [
    { name: 'Gross Margin', value: grossMargin, color: '#f59e0b', percent: price > 0 ? (grossMargin / price) * 100 : 0 },
    { name: 'M&E', value: mAndECost, color: '#3b82f6', percent: price > 0 ? (mAndECost / price) * 100 : 0 }, 
    { name: 'Labor & Comm.', value: directLaborCost, color: '#10b981', percent: price > 0 ? (directLaborCost / price) * 100 : 0 },
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
    <div className="space-y-4">
      {/* Primary Result - Two Cards Side by Side */}
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
            <h2 className="text-5xl font-display font-bold tracking-tight">
              {formatCurrency(price)}
            </h2>
            {discount > 0 && (
              <p className="text-sm text-primary-foreground/80 mt-2 font-medium">
                Includes discount of {formatCurrency(discount)}
              </p>
            )}
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-primary-foreground/20">
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

        <div className="md:col-span-2 bg-card border border-border rounded-xl p-5 shadow-lg shadow-black/5 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-3 text-emerald-500 opacity-5 group-hover:opacity-10 transition-opacity">
            <Users size={80} />
          </div>
          <div className="relative z-10">
            <p className="text-muted-foreground font-medium text-sm mb-1">Estimated Labor Field</p>
            <h2 className="text-4xl font-display font-bold tracking-tight text-emerald-600">
              {formatCurrency(estimatedLabor)}
            </h2>
            <p className="text-[10px] text-muted-foreground mt-3 italic leading-tight">
              * This is for the estimated labor field of the service in ServiceTitan
            </p>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
          <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">Gross Margin</p>
          <p className="text-lg font-bold text-foreground">{formatPercent(metrics.grossMarginPercent)}</p>
          <p className="text-xs text-muted-foreground">{formatCurrency(metrics.grossMarginAmount)}</p>
        </div>
        <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
          <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">M&E Percent</p>
          <p className="text-lg font-bold text-foreground">{formatPercent(metrics.mePercent)}</p>
        </div>
        <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
          <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">Labor & Comm.</p>
          <p className="text-lg font-bold text-foreground">{formatCurrency(directLaborCost)}</p>
        </div>
        <div className="bg-white dark:bg-card rounded-lg p-3 border border-border shadow-sm">
          <p className="text-[10px] text-muted-foreground uppercase font-bold mb-0.5">Other COGS</p>
          <p className="text-lg font-bold text-foreground">{formatCurrency(totalOtherCogs)}</p>
        </div>
      </div>

      {/* Chart & Detailed Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Breakdown List */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-border p-4 shadow-sm">
          <div className="mb-3">
            <h3 className="font-display font-bold text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Cost Breakdown
            </h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">Note: Labor and Commission include burdens</p>
          </div>
          
          <div className="space-y-4">
            {/* M&E Group */}
            <div className="space-y-1.5">
              <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">
                {partsOnly ? "Parts (Includes Tax)" : "M&E (Includes Tax)"}
              </h4>
              <div className="space-y-1">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100/50 dark:border-blue-900/30">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    <span className="text-sm font-semibold text-blue-900 dark:text-blue-300">
                      {partsOnly ? "Total Parts" : "Total M&E"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground font-medium">
                      ({formatPercent(price > 0 ? (mAndECost / price) * 100 : 0)})
                    </span>
                    <span className="font-mono text-sm font-medium text-blue-700 dark:text-blue-400">
                      {formatCurrency(mAndECost)}
                    </span>
                  </div>
                </div>

                {/* Sub-items */}
                <div className="ml-5 space-y-0.5 pt-1 border-l-2 border-blue-100/50 dark:border-blue-900/30 pl-3">
                  {partsOnly ? (
                    <>
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-xs text-muted-foreground">Parts</span>
                        <span className="text-xs font-mono text-muted-foreground">{formatCurrency(breakdown.materials)}</span>
                      </div>
                      <div className="flex justify-between items-center py-0.5">
                        <span className="text-xs text-muted-foreground">Sales Tax ({salesTaxRate || "6.35"}%)</span>
                        <span className="text-xs font-mono text-muted-foreground">{formatCurrency(breakdown.tax)}</span>
                      </div>
                    </>
                  ) : (
                    [
                      { label: "Materials", value: breakdown.materials },
                      { label: "Equipment", value: breakdown.equipment },
                      { label: `Sales Tax (${salesTaxRate || "6.35"}%)`, value: breakdown.tax },
                    ].map((sub) => (
                      <div key={sub.label} className="flex justify-between items-center py-0.5">
                        <span className="text-xs text-muted-foreground">{sub.label}</span>
                        <span className="text-xs font-mono text-muted-foreground">{formatCurrency(sub.value)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Direct Labor Group */}
            <div className="space-y-1.5">
              <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">Direct Labor</h4>
              <div className="space-y-1">
                {/* Burdened Labor row */}
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span className="text-sm font-semibold text-emerald-900 dark:text-emerald-300">Burdened Labor</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground font-medium">({formatPercent(price > 0 ? (breakdown.laborCost / price) * 100 : 0)})</span>
                    <span className="font-mono text-sm font-medium text-emerald-700 dark:text-emerald-400">{formatCurrency(breakdown.laborCost)}</span>
                  </div>
                </div>
                {laborBreakdown && laborBreakdown.hours > 0 && (
                  <div className="ml-5 space-y-0.5 pt-1 border-l-2 border-emerald-100/50 dark:border-emerald-900/30 pl-3">
                    {(() => {
                      const { hours, numTechs, hourlyRate, burdenPercent } = laborBreakdown;
                      const totalHours = hours * numTechs;
                      const directLabor = totalHours * hourlyRate;
                      const burden = directLabor * (burdenPercent / 100);
                      const rows = [
                        ...(numTechs > 1 ? [{ label: `${numTechs} techs × ${hours} hrs = ${totalHours} total hrs` }] : [{ label: `${hours} hrs` }]),
                        { label: `${formatCurrency(hourlyRate)}/hr × ${totalHours} hrs`, value: directLabor },
                        { label: `Labor Burden (${burdenPercent}%)`, value: burden },
                      ];
                      return rows.map((row) => (
                        <div key={row.label} className="flex justify-between items-center py-0.5">
                          <span className="text-xs text-muted-foreground">{row.label}</span>
                          {row.value !== undefined && <span className="text-xs font-mono text-muted-foreground">{formatCurrency(row.value)}</span>}
                        </div>
                      ));
                    })()}
                  </div>
                )}
                {/* Burdened Commission row */}
                <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/50">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                    <span className="text-sm text-foreground">Burdened Commission</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground font-medium">({formatPercent(price > 0 ? (breakdown.commission / price) * 100 : 0)})</span>
                    <span className="font-mono text-sm font-medium text-muted-foreground">{formatCurrency(breakdown.commission)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Other COGS Group */}
            <div className="space-y-1.5">
              <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">Other COGS</h4>
              <div className="space-y-1">
                {[
                  { label: "Financing Fees", value: breakdown.financing, color: "bg-violet-500" },
                  { label: "Subcontractor", value: breakdown.subcontractor, color: "bg-orange-400" },
                  { label: "Crane", value: breakdown.crane, color: "bg-pink-400" },
                  { label: "Permit", value: breakdown.permit, color: "bg-cyan-400" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/50">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                      <span className="text-sm text-foreground">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground font-medium">
                        ({formatPercent(price > 0 ? ((item.value || 0) / price) * 100 : 0)})
                      </span>
                      <span className="font-mono text-sm font-medium text-muted-foreground">
                        {formatCurrency(item.value || 0)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {(oemRebate > 0 || utilityRebate > 0) && (
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">Rebates (Added to Revenue)</h4>
                <div className="space-y-1">
                  {[
                    { label: "OEM Rebate", value: oemRebate, color: "bg-teal-500" },
                    { label: "Utility Rebate", value: utilityRebate, color: "bg-sky-500" },
                  ].filter(item => item.value > 0).map((item) => (
                    <div key={item.label} className="flex items-center justify-between p-2.5 rounded-lg bg-teal-50/50 dark:bg-teal-950/20 border border-teal-100/50 dark:border-teal-900/30">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${item.color}`} />
                        <span className="text-sm font-medium text-teal-900 dark:text-teal-300">{item.label}</span>
                      </div>
                      <span className="font-mono text-sm font-medium text-teal-700 dark:text-teal-400">
                        +{formatCurrency(item.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Pie Chart */}
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
  );
}
