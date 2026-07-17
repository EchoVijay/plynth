import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  CreditCard, Plus, Pause, Play, Trash2, Pencil, Calendar as CalIcon,
  TrendingUp, ChevronDown, ChevronUp,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { cn, formatINR } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/Dialog';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from 'sonner';

type Subscription = {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  category: string;
  billing_cycle: string;
  billing_day: number;
  next_renewal_date: string;
  status: string;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
};

const CATEGORIES = [
  { id: 'streaming', emoji: '🎬', label: 'Streaming' },
  { id: 'music', emoji: '🎵', label: 'Music' },
  { id: 'cloud', emoji: '☁️', label: 'Cloud' },
  { id: 'fitness', emoji: '💪', label: 'Fitness' },
  { id: 'saas', emoji: '💻', label: 'SaaS' },
  { id: 'news', emoji: '📰', label: 'News' },
  { id: 'gaming', emoji: '🎮', label: 'Gaming' },
  { id: 'other', emoji: '📦', label: 'Other' },
];

const CYCLES = [
  { id: 'monthly', label: 'Monthly', months: 1 },
  { id: 'quarterly', label: 'Quarterly', months: 3 },
  { id: 'yearly', label: 'Yearly', months: 12 },
];

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4'];

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysUntil(dateStr: string): number {
  const t = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((t.getTime() - now.getTime()) / 86400000);
}

function monthlyEquivalent(amount: number, cycle: string): number {
  const c = CYCLES.find(cy => cy.id === cycle);
  return c ? amount / c.months : amount;
}

function computeNextRenewal(billingDay: number, cycle: string, fromDate?: string): string {
  const now = fromDate ? new Date(fromDate + 'T00:00:00') : new Date();
  let next = new Date(now.getFullYear(), now.getMonth(), billingDay);
  if (next <= now) {
    if (cycle === 'monthly') next.setMonth(next.getMonth() + 1);
    else if (cycle === 'quarterly') next.setMonth(next.getMonth() + 3);
    else next.setFullYear(next.getFullYear() + 1);
  }
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

export function SubscriptionsPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const subsQ = useQuery({
    queryKey: ['subscriptions', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId!)
        .order('next_renewal_date');
      if (error) throw error;
      return (data ?? []) as Subscription[];
    },
  });

  const subs = subsQ.data ?? [];
  const active = subs.filter(s => s.status === 'active');
  const inactive = subs.filter(s => s.status !== 'active');

  const monthlyBurn = useMemo(() =>
    active.reduce((sum, s) => sum + monthlyEquivalent(s.amount, s.billing_cycle), 0),
    [active]
  );
  const yearlyBurn = monthlyBurn * 12;

  const nextRenewal = active.length ? active[0] : null;

  const categoryBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    active.forEach(s => {
      const monthly = monthlyEquivalent(s.amount, s.billing_cycle);
      map[s.category] = (map[s.category] || 0) + monthly;
    });
    return Object.entries(map).map(([name, value]) => ({
      name: CATEGORIES.find(c => c.id === name)?.label ?? name,
      value: Math.round(value),
    }));
  }, [active]);

  // Renewal calendar dots for current month
  const renewalDates = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const dates: Record<number, string[]> = {};
    active.forEach(s => {
      const rd = new Date(s.next_renewal_date + 'T00:00:00');
      if (rd.getFullYear() === year && rd.getMonth() === month) {
        const day = rd.getDate();
        if (!dates[day]) dates[day] = [];
        dates[day].push(s.name);
      }
    });
    return dates;
  }, [active]);

  const deletM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('subscriptions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subscriptions'] }); toast.success('Deleted'); },
  });

  const statusM = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const update: any = { status, updated_at: new Date().toISOString() };
      if (status === 'active') {
        const sub = subs.find(s => s.id === id);
        if (sub) update.next_renewal_date = computeNextRenewal(sub.billing_day, sub.billing_cycle);
      }
      const { error } = await supabase.from('subscriptions').update(update).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subscriptions'] }); toast.success('Updated'); },
  });

  // Mini calendar
  const calMonth = new Date();
  const daysInMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0).getDate();
  const firstDow = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1).getDay();
  const todayDate = new Date().getDate();

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-purple-500" /> Subscriptions
        </h1>
        <Button onClick={() => setShowAdd(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Monthly Burn</p>
            <p className="text-xl font-bold text-purple-600">{formatINR(monthlyBurn)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Yearly Burn</p>
            <p className="text-xl font-bold text-orange-600">{formatINR(yearlyBurn)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Active</p>
            <p className="text-xl font-bold">{active.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Next Renewal</p>
            {nextRenewal ? (
              <p className="text-sm font-medium">
                {nextRenewal.name} <span className="text-muted-foreground">in {daysUntil(nextRenewal.next_renewal_date)}d</span>
              </p>
            ) : <p className="text-sm text-muted-foreground">—</p>}
          </CardContent>
        </Card>
      </div>

      {/* Renewal Calendar + Category Chart row */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Mini Calendar */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <CalIcon className="h-4 w-4" />
              Renewal Calendar — {calMonth.toLocaleDateString('en', { month: 'long', year: 'numeric' })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-1 text-xs text-center">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <div key={i} className="font-medium text-muted-foreground py-1">{d}</div>
              ))}
              {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const hasSub = renewalDates[day];
                const isToday = day === todayDate;
                return (
                  <div
                    key={day}
                    className={cn(
                      'relative p-1.5 rounded-md transition-colors',
                      isToday && 'bg-primary/10 font-bold',
                      hasSub && 'bg-purple-100 dark:bg-purple-900/30',
                    )}
                    title={hasSub?.join(', ')}
                  >
                    {day}
                    {hasSub && (
                      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-purple-500" />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Category PieChart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4" /> Spend by Category
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {categoryBreakdown.length ? (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={categoryBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name} ₹${value}`}>
                    {categoryBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatINR(v)} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground py-8">No active subscriptions</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active Subscriptions */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Active Subscriptions</h2>
        {!active.length && <EmptyState icon={CreditCard} title="No subscriptions" description="Add your first subscription to start tracking." />}
        <div className="grid gap-3 sm:grid-cols-2">
          {active.map((sub, i) => (
            <motion.div key={sub.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{CATEGORIES.find(c => c.id === sub.category)?.emoji ?? '📦'}</span>
                      <span className="font-semibold truncate">{sub.name}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg font-bold">{formatINR(sub.amount)}</span>
                      <Badge variant="secondary" className="text-xs">{sub.billing_cycle}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Renews {new Date(sub.next_renewal_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      {' '}({daysUntil(sub.next_renewal_date)}d away)
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button onClick={() => setEditing(sub)} className="p-1.5 rounded hover:bg-accent text-muted-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => statusM.mutate({ id: sub.id, status: 'paused' })} className="p-1.5 rounded hover:bg-accent text-muted-foreground"><Pause className="h-3.5 w-3.5" /></button>
                    <button onClick={() => deletM.mutate(sub.id)} className="p-1.5 rounded hover:bg-accent text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Inactive */}
      {inactive.length > 0 && (
        <div className="space-y-2">
          <button onClick={() => setShowInactive(!showInactive)} className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            {showInactive ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Paused / Cancelled ({inactive.length})
          </button>
          {showInactive && (
            <div className="grid gap-2 sm:grid-cols-2">
              {inactive.map(sub => (
                <Card key={sub.id} className="opacity-60">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span>{CATEGORIES.find(c => c.id === sub.category)?.emoji ?? '📦'}</span>
                      <span className="font-medium text-sm">{sub.name}</span>
                      <Badge variant="outline" className="text-xs">{sub.status}</Badge>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => statusM.mutate({ id: sub.id, status: 'active' })} className="p-1.5 rounded hover:bg-accent text-green-600" title="Reactivate">
                        <Play className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => deletM.mutate(sub.id)} className="p-1.5 rounded hover:bg-accent text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <SubDialog
        open={showAdd || !!editing}
        onClose={() => { setShowAdd(false); setEditing(null); }}
        initial={editing}
        userId={userId!}
      />
    </div>
  );
}

function SubDialog({ open, onClose, initial, userId }: {
  open: boolean; onClose: () => void; initial: Subscription | null; userId: string;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('streaming');
  const [cycle, setCycle] = useState('monthly');
  const [billingDay, setBillingDay] = useState('1');
  const [payMethod, setPayMethod] = useState('');

  // Populate when editing
  useState(() => {
    if (initial) {
      setName(initial.name);
      setAmount(String(initial.amount));
      setCategory(initial.category);
      setCycle(initial.billing_cycle);
      setBillingDay(String(initial.billing_day));
      setPayMethod(initial.payment_method ?? '');
    } else {
      setName(''); setAmount(''); setCategory('streaming'); setCycle('monthly'); setBillingDay('1'); setPayMethod('');
    }
  });

  // Reset on open change
  const resetForm = () => {
    if (initial) {
      setName(initial.name); setAmount(String(initial.amount)); setCategory(initial.category);
      setCycle(initial.billing_cycle); setBillingDay(String(initial.billing_day)); setPayMethod(initial.payment_method ?? '');
    } else {
      setName(''); setAmount(''); setCategory('streaming'); setCycle('monthly'); setBillingDay('1'); setPayMethod('');
    }
  };

  const saveM = useMutation({
    mutationFn: async () => {
      const bd = Math.min(31, Math.max(1, parseInt(billingDay) || 1));
      const renewDate = computeNextRenewal(bd, cycle);
      const payload = {
        user_id: userId,
        name: name.trim(),
        amount: parseFloat(amount),
        category,
        billing_cycle: cycle,
        billing_day: bd,
        next_renewal_date: renewDate,
        payment_method: payMethod.trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (initial) {
        const { error } = await supabase.from('subscriptions').update(payload).eq('id', initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('subscriptions').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      toast.success(initial ? 'Updated' : 'Subscription added');
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); else resetForm(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Subscription' : 'Add Subscription'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Input placeholder="Name (e.g. Netflix)" value={name} onChange={e => setName(e.target.value)} />
          <Input type="number" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} />
          {/* Category pills */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Category</label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                    category === c.id ? 'bg-purple-600 text-white' : 'bg-muted hover:bg-accent'
                  )}
                >
                  {c.emoji} {c.label}
                </button>
              ))}
            </div>
          </div>
          {/* Billing cycle */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Billing Cycle</label>
            <div className="flex gap-2">
              {CYCLES.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCycle(c.id)}
                  className={cn(
                    'flex-1 py-2 rounded-lg text-sm font-medium transition-colors',
                    cycle === c.id ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <Input type="number" min={1} max={31} placeholder="Billing day (1-31)" value={billingDay} onChange={e => setBillingDay(e.target.value)} />
          <Input placeholder="Payment method (optional)" value={payMethod} onChange={e => setPayMethod(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveM.mutate()} disabled={!name.trim() || !amount || saveM.isPending}>
            {initial ? 'Save' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
