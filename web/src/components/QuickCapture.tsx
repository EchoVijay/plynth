import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, X, CheckSquare, Receipt, Droplets, NotebookPen, Bookmark, CalendarDays,
  Command, Search,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type CaptureType = 'task' | 'expense' | 'water' | 'note' | 'bookmark' | 'event';

const CAPTURE_TYPES: { id: CaptureType; label: string; icon: any; placeholder: string; color: string; shortcut: string }[] = [
  { id: 'task', label: 'Task', icon: CheckSquare, placeholder: 'Buy groceries, Call dentist...', color: 'text-emerald-500', shortcut: 'T' },
  { id: 'expense', label: 'Expense', icon: Receipt, placeholder: '200 food lunch, 500 transport...', color: 'text-amber-500', shortcut: 'E' },
  { id: 'water', label: 'Water', icon: Droplets, placeholder: 'Number of glasses (1-5)', color: 'text-cyan-500', shortcut: 'W' },
  { id: 'note', label: 'Note', icon: NotebookPen, placeholder: 'Quick thought or note...', color: 'text-violet-500', shortcut: 'N' },
  { id: 'bookmark', label: 'Bookmark', icon: Bookmark, placeholder: 'https://... or paste a URL', color: 'text-orange-500', shortcut: 'B' },
  { id: 'event', label: 'Event', icon: CalendarDays, placeholder: 'Meeting tomorrow 3pm, Birthday...', color: 'text-blue-500', shortcut: 'V' },
];

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function QuickCapture() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<CaptureType | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+K / Cmd+K to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
        setType(null);
        setValue('');
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
        setType(null);
        setValue('');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Focus input when type is selected
  useEffect(() => {
    if (type && open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [type, open]);

  // Type shortcut keys when palette is open but no type selected
  useEffect(() => {
    if (!open || type) return;
    const handler = (e: KeyboardEvent) => {
      const match = CAPTURE_TYPES.find(t => t.shortcut.toLowerCase() === e.key.toLowerCase());
      if (match) { e.preventDefault(); setType(match.id); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, type]);

  const close = useCallback(() => { setOpen(false); setType(null); setValue(''); }, []);

  const submitM = useMutation({
    mutationFn: async () => {
      if (!userId || !value.trim()) return;
      const v = value.trim();

      switch (type) {
        case 'task': {
          const { error } = await supabase.from('tasks').insert({
            user_id: userId, title: v, status: 'pending', priority: 'medium',
          });
          if (error) throw error;
          toast.success('✅ Task added');
          break;
        }
        case 'expense': {
          // Parse: "200 food lunch" → amount=200, category=food, desc=lunch
          const parts = v.split(/\s+/);
          const amount = parseFloat(parts[0]);
          if (isNaN(amount)) throw new Error('Start with an amount: "200 food lunch"');
          const categories = ['food', 'transport', 'shopping', 'utilities', 'health', 'entertainment', 'housing', 'other'];
          const catWord = parts[1]?.toLowerCase();
          const category = categories.includes(catWord ?? '') ? catWord! : 'other';
          const desc = categories.includes(catWord ?? '') ? parts.slice(2).join(' ') || null : parts.slice(1).join(' ') || null;
          const { error } = await supabase.from('daily_expenses').insert({
            user_id: userId, amount, category, description: desc, expense_date: localToday(), payment_method: 'upi',
          });
          if (error) throw error;
          toast.success(`💰 ₹${amount} logged`);
          break;
        }
        case 'water': {
          const glasses = parseInt(v) || 1;
          const { data: existing } = await supabase.from('water_logs').select('glasses,goal')
            .eq('user_id', userId).eq('log_date', localToday()).maybeSingle();
          const current = existing?.glasses ?? 0;
          const goal = existing?.goal ?? 8;
          const { error } = await supabase.from('water_logs').upsert(
            { user_id: userId, log_date: localToday(), glasses: current + glasses, goal, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,log_date' }
          );
          if (error) throw error;
          toast.success(`💧 +${glasses} glass${glasses > 1 ? 'es' : ''} → ${current + glasses}/${goal}`);
          break;
        }
        case 'note': {
          // Find or create "Quick Notes" section
          let { data: section } = await supabase.from('note_sections').select('id')
            .eq('user_id', userId).eq('name', 'Quick Notes').maybeSingle();
          if (!section) {
            const { data: newSec, error: secErr } = await supabase.from('note_sections').insert({
              user_id: userId, name: 'Quick Notes', color: '#8b5cf6', icon: '⚡', sort_order: 98,
            }).select('id').single();
            if (secErr) throw secErr;
            section = newSec;
          }
          const title = v.split('\n')[0].slice(0, 80);
          const contentJson = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: v }] }] };
          const { error } = await supabase.from('note_pages').insert({
            user_id: userId, section_id: section!.id, title,
            content_json: contentJson, word_count: v.split(/\s+/).length,
          });
          if (error) throw error;
          toast.success('📝 Note saved');
          break;
        }
        case 'bookmark': {
          const url = v.startsWith('http') ? v : `https://${v}`;
          const { error } = await supabase.from('bookmarks').insert({
            user_id: userId, url, title: url, category: 'other',
          });
          if (error) throw error;
          toast.success('🔖 Bookmark saved');
          break;
        }
        case 'event': {
          // Simple: just title, set to today
          const { error } = await supabase.from('calendar_events').insert({
            user_id: userId, title: v, event_date: localToday(), category: 'other',
          });
          if (error) throw error;
          toast.success('📅 Event added');
          break;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries();
      close();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) submitM.mutate();
  };

  const selectedType = CAPTURE_TYPES.find(t => t.id === type)!;

  return (
    <>
      {/* Floating action button */}
      <button
        onClick={() => { setOpen(true); setType(null); setValue(''); }}
        className={cn(
          'fixed z-40 right-4 bottom-20 md:bottom-6 h-12 w-12 rounded-full',
          'bg-primary text-primary-foreground shadow-lg shadow-primary/25',
          'flex items-center justify-center',
          'hover:scale-105 active:scale-95 transition-transform',
        )}
        title="Quick Capture (Ctrl+K)"
      >
        <Plus className="h-5 w-5" />
      </button>

      {/* Palette overlay */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={close}
            />

            {/* Palette */}
            <motion.div
              key="palette"
              className="fixed z-50 top-[15%] left-1/2 w-[calc(100%-2rem)] max-w-lg"
              initial={{ opacity: 0, y: -20, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: -20, x: '-50%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              <div className="bg-card rounded-xl shadow-2xl border overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {type ? (
                      <button onClick={() => { setType(null); setValue(''); }} className="flex items-center gap-1.5 hover:text-foreground">
                        <Search className="h-3.5 w-3.5" />
                        <span>Back</span>
                      </button>
                    ) : (
                      <>
                        <Command className="h-3.5 w-3.5" />
                        <span>Quick Capture</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded border text-muted-foreground">
                      Ctrl+K
                    </kbd>
                    <button onClick={close} className="p-1 rounded hover:bg-accent text-muted-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {!type ? (
                  /* Type selector */
                  <div className="p-2">
                    {CAPTURE_TYPES.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setType(t.id)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-accent transition-colors text-left group"
                      >
                        <t.icon className={cn('h-5 w-5', t.color)} />
                        <span className="flex-1 text-sm font-medium">{t.label}</span>
                        <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-muted rounded border text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                          {t.shortcut}
                        </kbd>
                      </button>
                    ))}
                  </div>
                ) : (
                  /* Input form */
                  <form onSubmit={handleSubmit} className="p-3">
                    <div className="flex items-center gap-2 mb-3">
                      <selectedType.icon className={cn('h-5 w-5 shrink-0', selectedType.color)} />
                      <span className="text-sm font-semibold">{selectedType.label}</span>
                    </div>
                    <input
                      ref={inputRef}
                      type="text"
                      value={value}
                      onChange={e => setValue(e.target.value)}
                      placeholder={selectedType.placeholder}
                      className="w-full bg-muted/50 border rounded-lg px-3 py-2.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/50"
                      autoFocus
                    />
                    <div className="flex items-center justify-between mt-3">
                      <p className="text-[11px] text-muted-foreground">
                        {type === 'expense' && '💡 Format: amount category note'}
                        {type === 'water' && '💡 Enter number of glasses (default: 1)'}
                        {type === 'bookmark' && '💡 Paste a URL'}
                      </p>
                      <button
                        type="submit"
                        disabled={!value.trim() || submitM.isPending}
                        className={cn(
                          'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
                          'bg-primary text-primary-foreground hover:bg-primary/90',
                          'disabled:opacity-50 disabled:cursor-not-allowed',
                        )}
                      >
                        {submitM.isPending ? '...' : 'Save'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
