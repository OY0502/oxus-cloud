import React from "react";
import { financeData } from "@/data/mock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

export function Finance() {
  const latestData = financeData[financeData.length - 1];
  const previousData = financeData[financeData.length - 2];
  
  const incomeTrend = ((latestData.income - previousData.income) / previousData.income) * 100;
  const netTrend = ((latestData.net - previousData.net) / previousData.net) * 100;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Finance</h2>
          <p className="text-muted-foreground text-sm">Track your agency's financial health.</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Total Income (MTD)</h3>
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-bold">${latestData.income.toLocaleString()}</p>
              <span className={`text-sm font-medium ${incomeTrend >= 0 ? 'text-chart-2' : 'text-destructive'}`}>
                {incomeTrend >= 0 ? '+' : ''}{incomeTrend.toFixed(1)}%
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Expenses (MTD)</h3>
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-bold">${latestData.expenses.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-primary text-primary-foreground">
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-primary-foreground/80 mb-2">Net Profit (MTD)</h3>
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-bold">${latestData.net.toLocaleString()}</p>
              <span className={`text-sm font-medium ${netTrend >= 0 ? 'text-chart-2' : 'text-destructive'}`}>
                {netTrend >= 0 ? '+' : ''}{netTrend.toFixed(1)}%
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border shadow-sm">
        <CardHeader>
          <CardTitle>Cash Flow Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={financeData}
                margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorNet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value/1000}k`} />
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '8px', border: '1px solid hsl(var(--border))', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ fontWeight: 500 }}
                />
                <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                <Area type="monotone" dataKey="income" name="Income" stroke="hsl(var(--chart-2))" strokeWidth={2} fillOpacity={1} fill="url(#colorIncome)" />
                <Area type="monotone" dataKey="expenses" name="Expenses" stroke="hsl(var(--chart-1))" strokeWidth={2} fillOpacity={1} fill="url(#colorExpenses)" />
                <Area type="monotone" dataKey="net" name="Net Profit" stroke="hsl(var(--primary))" strokeWidth={3} fillOpacity={1} fill="url(#colorNet)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
