import React, { useMemo, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import { PageHeader } from "@/components/PageHeader";
import { MetricCard } from "@/components/MetricCard";
import { ChartCard } from "@/components/ChartCard";
import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { Wallet, CreditCard, Download, TrendingUp, Plus, LineChart as LineChartIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTransactions } from "@/hooks/api";
import { CreateTransactionDialog } from "@/components/forms/CreateDialogs";
import { CardGridSkeleton, EmptyState, ErrorState } from "@/components/states/QueryStates";
import { Skeleton } from "@/components/ui/skeleton";
import { formatEUR } from "@/lib/currency";
import type { Transaction } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CATEGORY_PALETTE = ["#c4b5fd", "#a5f3fc", "#fca5a5", "#fde68a", "#bbf7d0", "#f9a8d4", "#fdba74"];

export function Finance() {
  const { data: transactions = [], isLoading, isError, error, refetch } = useTransactions();
  const [createOpen, setCreateOpen] = useState(false);

  const now = new Date();
  const year = now.getFullYear();
  const currentMonth = now.getMonth();

  const monthly = useMemo(() => {
    return MONTHS.map((month, m) => {
      let income = 0;
      let expenses = 0;
      for (const t of transactions) {
        const d = new Date(t.occurred_on);
        if (d.getFullYear() !== year || d.getMonth() !== m) continue;
        if (t.amount >= 0) income += t.amount;
        else expenses += Math.abs(t.amount);
      }
      return { month, income, expenses, net: income - expenses };
    });
  }, [transactions, year]);

  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    let totalExpense = 0;
    for (const t of transactions) {
      if (t.amount >= 0) continue;
      const d = new Date(t.occurred_on);
      if (d.getFullYear() !== year || d.getMonth() !== currentMonth) continue;
      const amt = Math.abs(t.amount);
      totals.set(t.category, (totals.get(t.category) ?? 0) + amt);
      totalExpense += amt;
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount], i) => ({
        name,
        value: totalExpense > 0 ? Math.round((amount / totalExpense) * 100) : 0,
        color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
      }));
  }, [transactions, year, currentMonth]);

  const latest = monthly[currentMonth];
  const previous = monthly[(currentMonth + 11) % 12];
  const pct = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? 0 : 100) : ((cur - prev) / prev) * 100);
  const incomeTrend = pct(latest.income, previous.income);
  const netTrend = pct(latest.net, previous.net);
  const expensesTrend = pct(latest.expenses, previous.expenses);

  const transactionColumns = [
    { header: "Date", cell: (tx: Transaction) => <span className="text-muted-foreground whitespace-nowrap">{new Date(tx.occurred_on).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span> },
    { header: "Description", cell: (tx: Transaction) => <div className="font-medium text-foreground">{tx.description}</div> },
    { header: "Category", cell: (tx: Transaction) => <StatusBadge status={tx.category} variant={tx.amount >= 0 ? "success" : "neutral"} /> },
    { header: "Amount", className: "text-right", cell: (tx: Transaction) => <span className={`font-semibold ${tx.amount > 0 ? "text-soft-green" : "text-foreground"}`}>{tx.amount > 0 ? "+" : "-"}{formatEUR(Math.abs(tx.amount))}</span> },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Finance"
        subtitle="Founder financial cockpit and cash flow overview."
        actions={
          <div className="flex items-center gap-3">
            <Button variant="outline" className="gap-2 bg-card hover:bg-muted/50 border-border shadow-soft"><Download className="w-4 h-4" />Export Report</Button>
            <Button className="gap-2" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" />New Transaction</Button>
          </div>
        }
      />

      <CreateTransactionDialog open={createOpen} onOpenChange={setCreateOpen} />

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <>
          <CardGridSkeleton count={3} />
          <Skeleton className="h-[420px] w-full rounded-xl" />
        </>
      ) : transactions.length === 0 ? (
        <EmptyState
          icon={<LineChartIcon />}
          title="No financial data yet"
          description="Record income and expenses to see your cash flow, category breakdown and monthly trends."
          action={<Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" />Record a transaction</Button>}
        />
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-3">
            <MetricCard title="Total Income (MTD)" value={formatEUR(latest.income)} trend={{ value: `${incomeTrend >= 0 ? "+" : ""}${incomeTrend.toFixed(1)}%`, label: "vs last month", positive: incomeTrend >= 0 }} icon={<Wallet className="w-5 h-5" />} />
            <MetricCard title="Expenses (MTD)" value={formatEUR(latest.expenses)} trend={{ value: `${expensesTrend >= 0 ? "+" : ""}${expensesTrend.toFixed(1)}%`, label: "vs last month", positive: expensesTrend <= 0 }} icon={<CreditCard className="w-5 h-5" />} />
            <MetricCard className="bg-sidebar border-sidebar-border text-sidebar-foreground" valueClassName="text-white" title="Net Profit (MTD)" value={formatEUR(latest.net)} trend={{ value: `${netTrend >= 0 ? "+" : ""}${netTrend.toFixed(1)}%`, label: "vs last month", positive: netTrend >= 0 }} icon={<TrendingUp className="w-5 h-5 text-white" />} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <ChartCard title="Cash Flow Overview" subtitle="Monthly income vs expenses" className="lg:col-span-2">
              <div className="h-[350px] w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthly} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6ee7b7" stopOpacity={0.35} /><stop offset="95%" stopColor="#6ee7b7" stopOpacity={0} /></linearGradient>
                      <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#fca5a5" stopOpacity={0.35} /><stop offset="95%" stopColor="#fca5a5" stopOpacity={0} /></linearGradient>
                    </defs>
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} dy={10} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `€${value / 1000}k`} dx={-10} />
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderRadius: "var(--radius-md)", border: "1px solid hsl(var(--border))", boxShadow: "var(--shadow-layered)", padding: "12px" }} itemStyle={{ fontWeight: 500 }} labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: "8px" }} />
                    <Legend iconType="circle" wrapperStyle={{ paddingTop: "20px" }} />
                    <Area type="monotone" dataKey="income" name="Income" stroke="#6ee7b7" strokeWidth={2.5} fillOpacity={1} fill="url(#colorIncome)" />
                    <Area type="monotone" dataKey="expenses" name="Expenses" stroke="#fca5a5" strokeWidth={2.5} fillOpacity={1} fill="url(#colorExpenses)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard title="Expense Breakdown" subtitle="Top categories this month">
              {categories.length > 0 ? (
                <>
                  <div className="h-[250px] w-full mt-4 flex items-center justify-center">
                    <PieChart width={250} height={250}>
                      <Pie data={categories} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={5} dataKey="value" stroke="none" isAnimationActive={false}>
                        {categories.map((entry, index) => (<Cell key={`cell-${index}`} fill={entry.color} />))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderRadius: "var(--radius-md)", border: "1px solid hsl(var(--border))", boxShadow: "var(--shadow-soft)" }} itemStyle={{ color: "hsl(var(--foreground))", fontWeight: 500 }} formatter={(value: number) => [`${value}%`, "Share"]} />
                    </PieChart>
                  </div>
                  <div className="space-y-3 mt-4">
                    {categories.map((category) => (
                      <div key={category.name} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full" style={{ backgroundColor: category.color }} /><span className="text-muted-foreground">{category.name}</span></div>
                        <span className="font-medium text-foreground">{category.value}%</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-[250px] flex items-center justify-center text-center text-sm text-muted-foreground">No expenses recorded this month.</div>
              )}
            </ChartCard>
          </div>

          <div className="pt-4">
            <div className="flex justify-between items-center mb-6"><h3 className="text-xl font-semibold text-foreground">Recent Transactions</h3></div>
            <DataTable data={transactions.slice(0, 12)} columns={transactionColumns} />
          </div>
        </>
      )}
    </div>
  );
}
