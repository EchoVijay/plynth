import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BookOpen, Briefcase, CheckSquare, Wallet, ArrowRight, Sparkles, Flame, Receipt } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Loader';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { formatINR } from '@/lib/utils';
import { isPageEnabled } from '@/app/AppShell';

const QUOTES = [
  'Small steps every day beat giant leaps once a year.',
  'Discipline is choosing between what you want now and what you want most.',
  'Done is better than perfect.',
  'Compounding works on knowledge too.',
  'Show up, especially when you don\'t feel like it.',
];

export function DashboardPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const today = new Date().toISOString().slice(0, 10);
  const quote = QUOTES[new Date().getDate() % QUOTES.length];

  const profileQ = useQuery({
    queryKey: ['profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('enabled_pages').eq('user_id', userId!).maybeSingle();
      return data;
    },
  });
  const ep = profileQ.data?.enabled_pages;

  const learningQ = useQuery({
    queryKey: ['dashboard', 'learning', userId, today],
    enabled: !!userId && isPageEnabled(ep, 'learning'),
    queryFn: async () => {
      const { data } = await supabase.from('learning_plans').select('id,status').eq('user_id', userId!).eq('date', today);
      return { total: data?.length ?? 0, done: data?.filter(d => d.status === 'completed').length ?? 0 };
    },
  });

  const jobsQ = useQuery({
    queryKey: ['dashboard', 'jobs', userId],
    enabled: !!userId && isPageEnabled(ep, 'jobs'),
    queryFn: async () => {
      const { count } = await supabase.from('job_listings').select('*', { count: 'exact', head: true }).eq('user_id', userId!).eq('is_new', true);
      return count ?? 0;
    },
  });

  const tasksQ = useQuery({
    queryKey: ['dashboard', 'tasks', userId, today],
    enabled: !!userId && isPageEnabled(ep, 'todos'),
    queryFn: async () => {
      const { data } = await supabase.from('tasks').select('id,status').eq('user_id', userId!).eq('due_date', today);
      return { total: data?.length ?? 0, done: data?.filter(t => t.status === 'completed').length ?? 0 };
    },
  });

  const financeQ = useQuery({
    queryKey: ['dashboard', 'finance', userId],
    enabled: !!userId && isPageEnabled(ep, 'finance'),
    queryFn: async () => {
      const { data } = await supabase.from('loans').select('emi_amount,emi_due_day,status').eq('user_id', userId!).eq('status', 'active');
      const totalEMI = (data ?? []).reduce((s, l) => s + Number(l.emi_amount), 0);
      const today = new Date();
      const nextDay = (data ?? [])
        .map(l => l.emi_due_day)
        .filter(d => d >= today.getDate())
        .sort((a, b) => a - b)[0];
      return { totalEMI, nextDay: nextDay ?? null };
    },
  });

  const habitsQ = useQuery({
    queryKey: ['dashboard', 'habits', userId, today],
    enabled: !!userId && isPageEnabled(ep, 'habits'),
    queryFn: async () => {
      const { data: habits } = await supabase.from('habits').select('id,frequency,custom_days,target_per_day')
        .eq('user_id', userId!).eq('archived', false);
      const dow = new Date().getDay();
      const due = (habits ?? []).filter(h => {
        if (h.frequency === 'daily') return true;
        if (h.frequency === 'weekdays') return dow >= 1 && dow <= 5;
        if (h.frequency === 'weekends') return dow === 0 || dow === 6;
        return (h.custom_days ?? []).includes(dow);
      });
      const { data: checkins } = await supabase.from('habit_checkins').select('habit_id,count')
        .eq('user_id', userId!).eq('check_date', today);
      const done = due.filter(h => {
        const c = (checkins ?? []).find(ci => ci.habit_id === h.id);
        return (c?.count ?? 0) >= h.target_per_day;
      }).length;
      return { total: due.length, done };
    },
  });

  const expensesQ = useQuery({
    queryKey: ['dashboard', 'expenses', userId, today],
    enabled: !!userId && isPageEnabled(ep, 'finance'),
    queryFn: async () => {
      const { data } = await supabase.from('daily_expenses').select('amount,expense_date')
        .eq('user_id', userId!).gte('expense_date', today.slice(0, 8) + '01');
      const todayTotal = (data ?? []).filter(e => e.expense_date === today).reduce((s, e) => s + Number(e.amount), 0);
      const monthTotal = (data ?? []).reduce((s, e) => s + Number(e.amount), 0);
      return { todayTotal, monthTotal };
    },
  });

  const allCards = [
    {
      id: 'learning', pageKey: 'learning', to: '/learning', label: "Today's Learning", icon: BookOpen, gradient: 'from-violet-500 to-fuchsia-500',
      value: learningQ.data ? `${learningQ.data.done} / ${learningQ.data.total}` : '—', sub: 'items completed',
      loading: learningQ.isLoading,
    },
    {
      id: 'jobs', pageKey: 'jobs', to: '/jobs', label: 'New Jobs', icon: Briefcase, gradient: 'from-sky-500 to-cyan-500',
      value: jobsQ.data?.toString() ?? '—', sub: 'fresh listings',
      loading: jobsQ.isLoading,
    },
    {
      id: 'todos', pageKey: 'todos', to: '/todos', label: 'Tasks Due Today', icon: CheckSquare, gradient: 'from-emerald-500 to-teal-500',
      value: tasksQ.data ? `${tasksQ.data.done} / ${tasksQ.data.total}` : '—', sub: 'completed',
      loading: tasksQ.isLoading,
    },
    {
      id: 'finance', pageKey: 'finance', to: '/finance', label: 'Monthly EMI', icon: Wallet, gradient: 'from-amber-500 to-orange-500',
      value: financeQ.data ? formatINR(financeQ.data.totalEMI) : '—',
      sub: financeQ.data?.nextDay ? `Next due: ${financeQ.data.nextDay}` : 'No active loans',
      loading: financeQ.isLoading,
    },
    {
      id: 'habits', pageKey: 'habits', to: '/habits', label: 'Habits Today', icon: Flame, gradient: 'from-pink-500 to-rose-500',
      value: habitsQ.data ? `${habitsQ.data.done} / ${habitsQ.data.total}` : '—',
      sub: habitsQ.data?.done === habitsQ.data?.total && habitsQ.data?.total ? '🔥 All done!' : 'completed',
      loading: habitsQ.isLoading,
    },
    {
      id: 'expenses', pageKey: 'finance', to: '/finance', label: 'Spent Today', icon: Receipt, gradient: 'from-green-500 to-emerald-500',
      value: expensesQ.data ? `₹${expensesQ.data.todayTotal.toLocaleString('en-IN')}` : '—',
      sub: expensesQ.data ? `₹${expensesQ.data.monthTotal.toLocaleString('en-IN')} this month` : '',
      loading: expensesQ.isLoading,
    },
  ];

  const cards = allCards.filter(c => isPageEnabled(ep, c.pageKey));

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <Card className="overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-fuchsia-500/10 pointer-events-none" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Sparkles className="h-6 w-6 text-primary" />
            Welcome back
          </CardTitle>
          <CardDescription className="text-base">{quote}</CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c, i) => (
          <motion.div key={c.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Link to={c.to}>
              <Card className="h-full hover:shadow-md hover:-translate-y-0.5 transition-all">
                <CardContent className="p-5">
                  <div className={`inline-flex p-2 rounded-lg bg-gradient-to-br ${c.gradient} text-white mb-3`}>
                    <c.icon className="h-5 w-5" />
                  </div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</p>
                  {c.loading
                    ? <Skeleton className="h-8 w-24 mt-1" />
                    : <p className="text-2xl font-bold mt-1">{c.value}</p>}
                  <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                    <span>{c.sub}</span>
                    <ArrowRight className="h-3 w-3" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
