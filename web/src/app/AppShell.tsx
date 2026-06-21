import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, BookOpen, Briefcase, CheckSquare, Wallet, Settings, MessageCircle,
  Menu, Bell, LogOut, Moon, Sun, Monitor, NotebookPen, Heart, FileText, CalendarDays,
  Bookmark,
} from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { cn, greeting } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useSession } from './useSession';
import { useTheme } from './ThemeProvider';
import { ErrorBoundary } from './ErrorBoundary';
import { useQuery } from '@tanstack/react-query';

// All toggleable pages. Dashboard & Settings are pinned (always visible).
export const ALL_PAGES: { key: string; to: string; label: string; icon: any; defaultEnabled: boolean }[] = [
  { key: 'learning', to: '/learning', label: 'Learning', icon: BookOpen, defaultEnabled: true },
  { key: 'jobs', to: '/jobs', label: 'Jobs', icon: Briefcase, defaultEnabled: true },
  { key: 'todos', to: '/todos', label: 'To-Do', icon: CheckSquare, defaultEnabled: true },
  { key: 'notes', to: '/notes', label: 'Notes', icon: NotebookPen, defaultEnabled: true },
  { key: 'finance', to: '/finance', label: 'Finance', icon: Wallet, defaultEnabled: true },
  { key: 'chat', to: '/chat', label: 'Chat', icon: MessageCircle, defaultEnabled: true },
  { key: 'calendar', to: '/calendar', label: 'Calendar', icon: CalendarDays, defaultEnabled: false },
  { key: 'period_tracker', to: '/period', label: 'Period', icon: Heart, defaultEnabled: false },
  { key: 'documents_vault', to: '/documents', label: 'Docs', icon: FileText, defaultEnabled: false },
  { key: 'bookmarks', to: '/bookmarks', label: 'Bookmarks', icon: Bookmark, defaultEnabled: false },
];

export function isPageEnabled(enabledPages: Record<string, boolean> | null | undefined, key: string): boolean {
  const cfg = ALL_PAGES.find(p => p.key === key);
  if (!cfg) return false;
  return (enabledPages ?? {})[key] ?? cfg.defaultEnabled;
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const { session } = useSession();
  const navigate = useNavigate();
  const loc = useLocation();
  const { theme, setTheme } = useTheme();

  const { data: profile } = useQuery({
    queryKey: ['profile', session?.user.id],
    enabled: !!session?.user.id,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('*').eq('user_id', session!.user.id).maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (session && profile === null) navigate('/onboarding', { replace: true });
  }, [session, profile, navigate]);

  // Build nav: Dashboard (pinned first) + enabled pages in order + Settings (pinned last)
  const visibleNav = useMemo(() => {
    const enabled = profile?.enabled_pages;
    const order: string[] | null = profile?.page_order;

    // Filter enabled pages
    let pages = ALL_PAGES.filter(p => isPageEnabled(enabled, p.key));

    // Apply custom order if set
    if (order?.length) {
      const ordered: typeof pages = [];
      for (const key of order) {
        const p = pages.find(pg => pg.key === key);
        if (p) ordered.push(p);
      }
      // Append any pages not in the order list (newly added pages)
      for (const p of pages) {
        if (!ordered.some(o => o.key === p.key)) ordered.push(p);
      }
      pages = ordered;
    }

    return [
      { key: '_dashboard', to: '/', label: 'Dashboard', icon: LayoutDashboard, defaultEnabled: true },
      ...pages,
      { key: '_settings', to: '/settings', label: 'Settings', icon: Settings, defaultEnabled: true },
    ];
  }, [profile?.enabled_pages, profile?.page_order]);

  const cycleTheme = () => setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light');

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 72 : 240 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="hidden md:flex flex-col border-r bg-card sticky top-0 h-screen overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 h-16 border-b">
          <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold">P</div>
          {!collapsed && <span className="font-semibold tracking-tight">Plynth</span>}
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {visibleNav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-muted-foreground hover:text-foreground',
                )
              }
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => setCollapsed(c => !c)}
          className="p-3 border-t flex items-center gap-3 text-sm text-muted-foreground hover:text-foreground"
        >
          <Menu className="h-5 w-5" />
          {!collapsed && <span>Collapse</span>}
        </button>
        {!collapsed && <span className="px-3 pb-2 text-[10px] text-muted-foreground/50">v{__APP_VERSION__}</span>}
      </motion.aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b bg-card/80 backdrop-blur flex items-center justify-between px-4 md:px-6 h-16">
          <div>
            <p className="text-sm text-muted-foreground">{new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            <h1 className="font-semibold">{greeting(profile?.full_name)}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={cycleTheme} className="p-2 rounded-lg hover:bg-accent" title={`Theme: ${theme}`}>
              {theme === 'light' ? <Sun className="h-5 w-5" /> : theme === 'dark' ? <Moon className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
            </button>
            <button className="p-2 rounded-lg hover:bg-accent" title="Notifications"><Bell className="h-5 w-5" /></button>
            <button
              onClick={async () => { await supabase.auth.signOut(); navigate('/auth/login'); }}
              className="p-2 rounded-lg hover:bg-accent"
              title="Sign out"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 md:px-6 py-6 pb-24 md:pb-6 overflow-x-hidden">
          <ErrorBoundary key={loc.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-card/95 backdrop-blur border-t flex justify-around py-2">
          {visibleNav.slice(0, 5).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn('flex flex-col items-center gap-1 px-3 py-1 text-xs', isActive ? 'text-primary' : 'text-muted-foreground')
              }
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
