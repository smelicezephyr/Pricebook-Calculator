import { DollarSign, TrendingUp, Users } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface ResultsCardProps {
  price: number;
  estimatedLabor: number;
  breakdown: {
    materials: number;
    equipment: number;
    tax: number;
    commission: number;
    financing: number;
    laborCost: number; // For reference/margin calc, not the "Estimated Labor" output
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

export function ResultsCard({ price, estimatedLabor, breakdown, metrics }: ResultsCardProps) {
  const chartData = [
    { name: 'Materials', value: breakdown.materials, color: '#3b82f6' }, // blue-500
    { name: 'Equipment', value: breakdown.equipment, color: '#0ea5e9' }, // sky-500
    { name: 'Tax', value: breakdown.tax, color: '#94a3b8' },             // slate-400
    { name: 'Commission', value: breakdown.commission, color: '#f59e0b' }, // amber-500
    { name: 'Financing', value: breakdown.financing, color: '#8b5cf6' },   // violet-500
    { name: 'Labor (Est)', value: estimatedLabor, color: '#10b981' },      // emerald-500
  ].filter(d => d.value > 0);

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
              {formatCurrency(price)}
            </h2>
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
          <p className="text-xs text-muted-foreground uppercase font-bold mb-1">Commission</p>
          <p className="text-xl font-bold text-foreground">{formatCurrency(breakdown.commission)}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-border shadow-sm">
          <p className="text-xs text-muted-foreground uppercase font-bold mb-1">Financing</p>
          <p className="text-xl font-bold text-foreground">{formatCurrency(breakdown.financing)}</p>
        </div>
      </div>

      {/* Chart & Detailed Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Breakdown List */}
        <div className="lg:col-span-2 bg-card rounded-2xl border border-border p-6 shadow-sm">
          <h3 className="font-display font-bold text-lg mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" /> Cost Breakdown
          </h3>
          <div className="space-y-3">
            {[
              { label: "Materials", value: breakdown.materials, color: "bg-blue-500" },
              { label: "Equipment", value: breakdown.equipment, color: "bg-sky-500" },
              { label: "Sales Tax", value: breakdown.tax, color: "bg-slate-400" },
              { label: "Commission & Burden", value: breakdown.commission, color: "bg-amber-500" },
              { label: "Financing Fees", value: breakdown.financing, color: "bg-violet-500" },
              { label: "Estimated Labor", value: breakdown.laborCost, color: "bg-emerald-500", highlight: true },
            ].map((item) => (
              <div key={item.label} className={`flex items-center justify-between p-3 rounded-lg ${item.highlight ? 'bg-emerald-50 border border-emerald-100' : 'hover:bg-muted/50'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${item.color}`} />
                  <span className={`text-sm ${item.highlight ? 'font-semibold text-emerald-900' : 'text-foreground'}`}>
                    {item.label}
                  </span>
                </div>
                <span className={`font-mono font-medium ${item.highlight ? 'text-emerald-700' : 'text-muted-foreground'}`}>
                  {formatCurrency(item.value)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Pie Chart */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-sm flex flex-col items-center justify-center min-h-[300px]">
          <h3 className="font-display font-bold text-lg mb-2 text-center w-full">Distribution</h3>
          <div className="w-full h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value: number) => formatCurrency(value)}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap justify-center gap-2 text-xs mt-2">
            {chartData.map(d => (
              <div key={d.name} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                <span className="text-muted-foreground">{d.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
