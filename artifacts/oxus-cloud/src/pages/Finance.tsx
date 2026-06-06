import React, { useMemo } from "react";
import { financeData } from "@/data/mock";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import { PageHeader } from "@/components/PageHeader";
import { MetricCard } from "@/components/MetricCard";
import { ChartCard } from "@/components/ChartCard";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowUpRight, ArrowDownRight, Wallet, CreditCard, Building2, Download, TrendingUp, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Finance() {
  const latestData = financeData.monthly[financeData.monthly.length - 1];
  const previousData = financeData.monthly[financeData.monthly.length - 2];
  
  const incomeTrend = ((latestData.income - previousData.income) / previousData.income) * 100;
  const netTrend = ((latestData.net - previousData.net) / previousData.net) * 100;
  const expensesTrend = ((latestData.expenses - previousData.expenses) / previousData.expenses) * 100;

  const transactionColumns = [
    {
      header: "Date",
      accessorKey: "date" as keyof typeof financeData.transactions[0],
      cell: (tx: any) => (
        <span className="text-muted-foreground whitespace-nowrap">
          {new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      ),
    },
    {
      header: "Description",
      accessorKey: "description" as keyof typeof financeData.transactions[0],
      cell: (tx: any) => (
        <div className="font-medium text-foreground">
          {tx.description}
        </div>
      ),
    },
    {
      header: "Category",
      accessorKey: "category" as keyof typeof financeData.transactions[0],
      cell: (tx: any) => (
        <StatusBadge 
          status={tx.category} 
          variant={tx.category === "Income" ? "success" : "neutral"} 
        />
      ),
    },
    {
      header: "Amount",
      accessorKey: "amount" as keyof typeof financeData.transactions[0],
      className: "text-right",
      cell: (tx: any) => (
        <span className={`font-semibold ${tx.amount > 0 ? "text-soft-green" : "text-foreground"}`}>
          {tx.amount > 0 ? "+" : ""}{tx.amount < 0 ? "-" : ""}${Math.abs(tx.amount).toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader 
        title="Finance" 
        subtitle="Founder financial cockpit and cash flow overview."
        actions={
          <Button variant="outline" className="gap-2 bg-card hover:bg-muted/50 border-border shadow-soft">
            <Download className="w-4 h-4" />
            Export Report
          </Button>
        }
      />

      <div className="grid gap-6 md:grid-cols-3">
        <MetricCard
          title="Total Income (MTD)"
          value={`$${latestData.income.toLocaleString()}`}
          trend={{
            value: `${incomeTrend >= 0 ? '+' : ''}${incomeTrend.toFixed(1)}%`,
            label: "vs last month",
            positive: incomeTrend >= 0
          }}
          icon={<Wallet className="w-5 h-5" />}
        />
        <MetricCard
          title="Expenses (MTD)"
          value={`$${latestData.expenses.toLocaleString()}`}
          trend={{
            value: `${expensesTrend >= 0 ? '+' : ''}${expensesTrend.toFixed(1)}%`,
            label: "vs last month",
            positive: expensesTrend <= 0 // lower expenses is positive
          }}
          icon={<CreditCard className="w-5 h-5" />}
        />
        <MetricCard
          className="bg-sidebar border-sidebar-border text-sidebar-foreground"
          valueClassName="text-white"
          title="Net Profit (MTD)"
          value={`$${latestData.net.toLocaleString()}`}
          trend={{
            value: `${netTrend >= 0 ? '+' : ''}${netTrend.toFixed(1)}%`,
            label: "vs last month",
            positive: netTrend >= 0
          }}
          icon={<TrendingUp className="w-5 h-5 text-white" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <ChartCard 
          title="Cash Flow Overview" 
          subtitle="Monthly income vs expenses"
          className="lg:col-span-2"
        >
          <div className="h-[350px] w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={financeData.monthly}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6ee7b7" stopOpacity={0.35}/>
                    <stop offset="95%" stopColor="#6ee7b7" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#fca5a5" stopOpacity={0.35}/>
                    <stop offset="95%" stopColor="#fca5a5" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="month" 
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={12} 
                  tickLine={false} 
                  axisLine={false} 
                  dy={10}
                />
                <YAxis 
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={12} 
                  tickLine={false} 
                  axisLine={false} 
                  tickFormatter={(value) => `$${value/1000}k`} 
                  dx={-10}
                />
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    borderRadius: 'var(--radius-md)', 
                    border: '1px solid hsl(var(--border))', 
                    boxShadow: 'var(--shadow-layered)',
                    padding: '12px'
                  }}
                  itemStyle={{ fontWeight: 500 }}
                  labelStyle={{ color: 'hsl(var(--muted-foreground))', marginBottom: '8px' }}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                <Area 
                  type="monotone" 
                  dataKey="income" 
                  name="Income" 
                  stroke="#6ee7b7"
                  strokeWidth={2.5} 
                  fillOpacity={1} 
                  fill="url(#colorIncome)" 
                />
                <Area 
                  type="monotone" 
                  dataKey="expenses" 
                  name="Expenses" 
                  stroke="#fca5a5"
                  strokeWidth={2.5} 
                  fillOpacity={1} 
                  fill="url(#colorExpenses)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard 
          title="Expense Breakdown" 
          subtitle="Top categories this month"
        >
          <div className="h-[250px] w-full mt-4 flex items-center justify-center">
            <PieChart width={250} height={250}>
                <Pie
                  data={financeData.categories}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                  isAnimationActive={false}
                >
                  {financeData.categories.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    borderRadius: 'var(--radius-md)', 
                    border: '1px solid hsl(var(--border))', 
                    boxShadow: 'var(--shadow-soft)',
                  }}
                  itemStyle={{ color: 'hsl(var(--foreground))', fontWeight: 500 }}
                  formatter={(value: number) => [`${value}%`, 'Share']}
                />
            </PieChart>
          </div>
          <div className="space-y-3 mt-4">
            {financeData.categories.map((category) => (
              <div key={category.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: category.color }} />
                  <span className="text-muted-foreground">{category.name}</span>
                </div>
                <span className="font-medium text-foreground">{category.value}%</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      <div className="pt-4">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-semibold text-foreground">Recent Transactions</h3>
          <Button variant="ghost" size="sm">View All</Button>
        </div>
        <DataTable 
          data={financeData.transactions} 
          columns={transactionColumns} 
        />
      </div>
    </div>
  );
}
