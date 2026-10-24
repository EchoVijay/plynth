import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Send, Copy, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Loader';
import { Switch } from '@/components/ui/Switch';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { useTheme } from '@/app/ThemeProvider';
import { cn } from '@/lib/utils';
import { ALL_PAGES, isPageEnabled } from '@/app/AppShell';
import { RemindersCard } from './settings/RemindersCard';


export function SettingsPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const { theme, setTheme } = useTheme();

  const profileQ = useQuery({
    queryKey: ['profile-settings', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('*').eq('user_id', userId!).maybeSingle();
      return data;
    },
  });

  const [profileF, setProfileF] = useState({ full_name: '', timezone: '' });
  const [learnF, setLearnF] = useState<{ daily_plan_max_items: number; budget_enabled: boolean; daily_plan_budget_hours: number }>({
    daily_plan_max_items: 8, budget_enabled: false, daily_plan_budget_hours: 1.5,
  });
  useEffect(() => {
    if (profileQ.data) {
      setProfileF({
        full_name: profileQ.data.full_name ?? '',
        timezone: profileQ.data.timezone ?? 'Asia/Kolkata',
      });
      const min = profileQ.data.daily_plan_budget_min;
      setLearnF({
        daily_plan_max_items: profileQ.data.daily_plan_max_items ?? 8,
        budget_enabled: min != null,
        daily_plan_budget_hours: min != null ? Math.round((min / 60) * 4) / 4 : 1.5,
      });
    }
  }, [profileQ.data]);

  async function saveLearning(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    const max = Math.max(1, Math.min(30, Number(learnF.daily_plan_max_items) || 8));
    let budgetMin: number | null = null;
    if (learnF.budget_enabled) {
      const hours = Math.max(0.25, Math.min(8, Number(learnF.daily_plan_budget_hours) || 1.5));
      budgetMin = Math.round(hours * 60);
    }
    const { error } = await supabase.from('profiles').update({
      daily_plan_max_items: max, daily_plan_budget_min: budgetMin,
    }).eq('user_id', userId);
    if (error) return toast.error(error.message);
    toast.success('Learning preferences saved');
    qc.invalidateQueries({ queryKey: ['profile-settings', userId] });
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    const { error } = await supabase.from('profiles').update(profileF).eq('user_id', userId);
    if (error) return toast.error(error.message);
    toast.success('Profile saved');
    qc.invalidateQueries({ queryKey: ['profile-settings', userId] });
  }

  async function exportData() {
    if (!userId) return;
    const tables = ['profiles', 'learning_topics', 'learning_plans', 'learning_streaks', 'job_settings', 'job_profile', 'job_listings', 'job_applications', 'job_application_events', 'job_saved_searches', 'resumes', 'task_categories', 'tasks', 'loans', 'emi_payments', 'reminder_settings'] as const;
    const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
    for (const t of tables) {
      const { data } = await supabase.from(t).select('*');
      out[t] = data ?? [];
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `plynth-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardContent>
          {profileQ.isLoading ? <Skeleton className="h-32" /> : (
            <form onSubmit={saveProfile} className="space-y-3">
              <div className="space-y-1.5"><Label>Full name</Label><Input value={profileF.full_name} onChange={e => setProfileF({ ...profileF, full_name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Email</Label><Input value={profileQ.data?.email ?? ''} disabled /></div>
              <div className="space-y-1.5"><Label>Timezone</Label><Input value={profileF.timezone} onChange={e => setProfileF({ ...profileF, timezone: e.target.value })} /></div>
              <Button type="submit">Save profile</Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Theme</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          {(['light', 'dark', 'system'] as const).map(t => (
            <Button key={t} variant={theme === t ? 'default' : 'outline'} onClick={() => setTheme(t)}>{t}</Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Page Visibility</CardTitle>
          <CardDescription>Show or hide pages from your navigation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {ALL_PAGES.map(page => {
            const Icon = page.icon;
            const checked = isPageEnabled(profileQ.data?.enabled_pages, page.key);
            return (
              <div key={page.key} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{page.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {page.defaultEnabled ? 'Core' : 'Optional'} · {page.to}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={checked}
                  onCheckedChange={async (val) => {
                    const current = profileQ.data?.enabled_pages ?? {};
                    const next = { ...current, [page.key]: val };
                    await supabase.from('profiles').update({ enabled_pages: next }).eq('user_id', userId!);
                    qc.invalidateQueries({ queryKey: ['profile-settings', userId] });
                    qc.invalidateQueries({ queryKey: ['profile', userId] });
                    toast.success(val ? `${page.label} enabled` : `${page.label} hidden`);
                  }}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Learning</CardTitle>
          <CardDescription>Controls how AI builds your daily study plan.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveLearning} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Max items per day (1–30)</Label>
                <Input type="number" min={1} max={30} value={learnF.daily_plan_max_items}
                  onChange={e => setLearnF({ ...learnF, daily_plan_max_items: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Daily hours (0.25–8)</Label>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={learnF.budget_enabled}
                      onChange={e => setLearnF({ ...learnF, budget_enabled: e.target.checked })} />
                    Cap study time
                  </label>
                </div>
                <Input type="number" min={0.25} max={8} step={0.25}
                  disabled={!learnF.budget_enabled}
                  value={learnF.daily_plan_budget_hours}
                  onChange={e => setLearnF({ ...learnF, daily_plan_budget_hours: Number(e.target.value) })} />
                <p className="text-xs text-muted-foreground">
                  {learnF.budget_enabled
                    ? `Plan capped at ~${Math.round(learnF.daily_plan_budget_hours * 60)} min/day.`
                    : 'No time cap — only "Max items per day" applies.'}
                </p>
              </div>
            </div>
            <Button type="submit">Save learning preferences</Button>
          </form>
        </CardContent>
      </Card>

      <RemindersCard profile={profileQ.data} />

      <TelegramCard userId={userId!} chatId={profileQ.data?.telegram_chat_id} onLinked={() => qc.invalidateQueries({ queryKey: ['profile-settings', userId] })} />

      <Card>
        <CardHeader><CardTitle>API keys</CardTitle><CardDescription>Stored in Supabase Vault, set via CLI by admin. Read-only here.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {[
            { k: 'GEMINI_API_KEY', label: 'Google Gemini' },
            { k: 'GROQ_API_KEY', label: 'Groq' },
            { k: 'RESEND_API_KEY', label: 'Resend (email fallback)' },
            { k: 'MAIL_BRIDGE_URL', label: 'Mail bridge URL' },
            { k: 'NTFY_TOPIC', label: 'ntfy.sh topic' },
          ].map(s => (
            <div key={s.k} className="flex items-center justify-between text-sm">
              <span>{s.label}</span><Badge variant="outline">configured server-side</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Data</CardTitle></CardHeader>
        <CardContent>
          <Button variant="outline" onClick={exportData}><Download className="h-4 w-4" /> Export all data (JSON)</Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ==================== Telegram Link ====================
function TelegramCard({ userId, chatId, onLinked }: { userId: string; chatId?: number | null; onLinked: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  async function generateCode() {
    setGenerating(true);
    try {
      // Generate 6-char random code
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let c = '';
      for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
      // Store in system_kv with service role (via RPC or direct insert)
      const { error } = await supabase.from('system_kv').upsert({
        key: `tg_link_${c}`,
        value: userId,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      setCode(c);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function unlinkTelegram() {
    const { error } = await supabase.from('profiles').update({ telegram_chat_id: null }).eq('user_id', userId);
    if (error) return toast.error(error.message);
    toast.success('Telegram unlinked');
    onLinked();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5" /> Telegram Bot</CardTitle>
        <CardDescription>Link your Telegram account to add tasks, bookmarks, events and receive notifications via Telegram.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {chatId ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="default">Linked</Badge>
              <span className="text-sm text-muted-foreground">Chat ID: {chatId}</span>
            </div>
            <Button variant="outline" size="sm" onClick={unlinkTelegram}>Unlink Telegram</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              1. Open <a href="https://t.me/plynth_vijay_bot" target="_blank" rel="noreferrer" className="underline text-primary">@plynth_vijay_bot</a> in Telegram<br />
              2. Generate a link code below<br />
              3. Send <code>/link CODE</code> to the bot
            </p>
            {code ? (
              <div className="flex items-center gap-2">
                <code className="px-3 py-2 rounded bg-muted border text-lg font-mono tracking-widest">{code}</code>
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(`/link ${code}`); toast.success('Copied'); }}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs text-muted-foreground">Expires in 5 min</span>
              </div>
            ) : (
              <Button onClick={generateCode} disabled={generating}>
                {generating ? 'Generating...' : 'Generate Link Code'}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
