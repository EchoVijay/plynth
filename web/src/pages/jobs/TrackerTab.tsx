import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { format, parseISO } from 'date-fns';
import { AlertCircle, Briefcase, CalendarPlus, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/Sheet';
import { Skeleton } from '@/components/ui/Loader';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { todayLocal, useApplications, useUserId, type AppRow } from '@/lib/jobs/data';
import { STAGES, STAGE_LABEL, QUIET_AFTER_DAYS, isFollowUpDue, isQuiet, quietDays, trackerStats, type Stage } from '@shared/job-tracker.ts';
import { timeAgo } from './parts';

const STAGE_TINT: Record<Stage, string> = {
  applied: 'bg-blue-500', screening: 'bg-violet-500', interview: 'bg-amber-500', offer: 'bg-emerald-500', rejected: 'bg-red-500', ghosted: 'bg-slate-400',
};

export function TrackerTab({ openJob }: { openJob: (slug: string) => void }) {
  const userId = useUserId();
  const qc = useQueryClient();
  const appsQ = useApplications();
  const apps = appsQ.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const now = useMemo(() => new Date(), []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const move = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Stage }) => {
      const { error } = await supabase.from('job_applications').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['applications', userId] });
      const prev = qc.getQueryData<AppRow[]>(['applications', userId]);
      qc.setQueryData<AppRow[]>(['applications', userId], old => old?.map(a => (a.id === id ? { ...a, status } : a)));
      return { prev };
    },
    onError: (e: Error, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['applications', userId], ctx.prev); toast.error(e.message); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['applications', userId] }); qc.invalidateQueries({ queryKey: ['app-events'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); },
  });

  const quiet = apps.filter(a => isQuiet(a, now));
  const ghostAll = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('job_applications').update({ status: 'ghosted' }).in('id', quiet.map(a => a.id));
      if (error) throw error;
    },
    onSuccess: () => { toast.success(`Marked ${quiet.length} as ghosted`); qc.invalidateQueries({ queryKey: ['applications', userId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const id = String(e.active.id);
    const status = String(e.over.id) as Stage;
    const cur = apps.find(a => a.id === id);
    if (cur && cur.status !== status && STAGES.includes(status)) move.mutate({ id, status });
  };

  const stats = trackerStats(apps);
  const selected = apps.find(a => a.id === selectedId) ?? null;

  if (appsQ.isLoading) return <Skeleton className="h-60" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            ['Total', stats.total], ['Active', stats.active], ['Interviews', stats.interviews], ['Offers', stats.offers],
            ['Response rate', stats.responseRate === null ? '—' : `${stats.responseRate}%`],
          ].map(([l, v]) => (
            <div key={l as string} className="rounded-lg border bg-card px-3 py-2">
              <div className="text-xs text-muted-foreground">{l}</div>
              <div className="text-lg font-semibold leading-tight">{v}</div>
            </div>
          ))}
        </div>
        <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add application</Button>
      </div>

      {quiet.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm dark:bg-amber-500/10">
          <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-amber-500" />
            {quiet.length} application{quiet.length === 1 ? ' has' : 's have'} had no news for {QUIET_AFTER_DAYS}+ days.
          </span>
          <Button size="sm" variant="outline" onClick={() => { if (confirm(`Mark ${quiet.length} quiet application(s) as ghosted?`)) ghostAll.mutate(); }} disabled={ghostAll.isPending}>
            Mark as ghosted
          </Button>
        </div>
      )}

      {apps.length === 0 ? (
        <EmptyState icon={Briefcase} title="No applications yet" description="Apply from a job in Find and tap “I applied”, or add one manually." action={<Button onClick={() => setAdding(true)}>Add application</Button>} />
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-2 lg:grid lg:grid-cols-6 lg:overflow-visible">
            {STAGES.map(s => (
              <Column key={s} stage={s} apps={apps.filter(a => a.status === s)} now={now} onOpen={setSelectedId} />
            ))}
          </div>
        </DndContext>
      )}

      {selected && <ApplicationSheet key={selected.id} app={selected} onClose={() => setSelectedId(null)} openJob={openJob} />}
      {adding && <AddApplicationDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function Column({ stage, apps, now, onOpen }: { stage: Stage; apps: AppRow[]; now: Date; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <div ref={setNodeRef} className={cn('min-h-[220px] w-64 shrink-0 rounded-xl border bg-card/60 p-2 transition-colors lg:w-auto', isOver && 'ring-2 ring-primary')}>
      <div className="mb-2 flex items-center justify-between px-1.5 py-1">
        <span className="flex items-center gap-2 text-sm font-semibold"><span className={cn('h-2 w-2 rounded-full', STAGE_TINT[stage])} />{STAGE_LABEL[stage]}</span>
        <Badge variant="secondary">{apps.length}</Badge>
      </div>
      <div className="space-y-2">{apps.map(a => <Card key={a.id} app={a} now={now} onOpen={() => onOpen(a.id)} />)}</div>
    </div>
  );
}

function Card({ app, now, onOpen }: { app: AppRow; now: Date; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: app.id });
  const q = quietDays(app, now);
  const quiet = isQuiet(app, now);
  const due = isFollowUpDue(app, now);
  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 40 } : undefined}
      {...listeners} {...attributes}
      onClick={onOpen}
      className={cn('cursor-grab touch-manipulation rounded-lg border bg-background p-3 shadow-sm hover:shadow active:cursor-grabbing', isDragging && 'opacity-80 shadow-lg')}
    >
      <p className="truncate text-sm font-medium">{app.role}</p>
      <p className="truncate text-xs text-muted-foreground">{app.company}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>{format(parseISO(app.applied_date), 'd MMM')}</span>
        {quiet && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">quiet {q}d</span>}
        {due && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 font-medium text-blue-800 dark:bg-blue-500/20 dark:text-blue-300">follow up</span>}
        {app.interview_at && app.status === 'interview' && <span className="rounded-full bg-violet-100 px-1.5 py-0.5 font-medium text-violet-800 dark:bg-violet-500/20 dark:text-violet-300">{format(parseISO(app.interview_at), 'd MMM, h:mm a')}</span>}
      </div>
    </div>
  );
}

interface EventRow { id: string; kind: string; from_status: string | null; to_status: string | null; note: string | null; meta: { at?: string } | null; created_at: string }

function describeEvent(e: EventRow): string {
  switch (e.kind) {
    case 'created': return `Added as ${STAGE_LABEL[e.to_status as Stage] ?? e.to_status}`;
    case 'status_changed': return `${STAGE_LABEL[e.from_status as Stage] ?? e.from_status} → ${STAGE_LABEL[e.to_status as Stage] ?? e.to_status}`;
    case 'interview_scheduled': return e.meta?.at ? `Interview scheduled for ${format(parseISO(e.meta.at), 'EEE d MMM, h:mm a')}` : 'Interview scheduled';
    case 'reminder_sent': return 'Reminder sent';
    case 'auto_flagged': return e.note ?? 'Flagged as quiet';
    default: return e.note ?? e.kind;
  }
}

function ApplicationSheet({ app, onClose, openJob }: { app: AppRow; onClose: () => void; openJob: (slug: string) => void }) {
  const userId = useUserId();
  const qc = useQueryClient();
  const [f, setF] = useState({
    role: app.role, company: app.company, job_url: app.job_url ?? '', status: app.status, applied_date: app.applied_date,
    follow_up_date: app.follow_up_date ?? '', salary_offered: app.salary_offered?.toString() ?? '', notes: app.notes ?? '',
    interview_at: app.interview_at ? format(parseISO(app.interview_at), "yyyy-MM-dd'T'HH:mm") : '',
  });
  const [note, setNote] = useState('');

  const eventsQ = useQuery({
    queryKey: ['app-events', app.id],
    queryFn: async (): Promise<EventRow[]> => {
      const { data, error } = await supabase.from('job_application_events').select('id,kind,from_status,to_status,note,meta,created_at')
        .eq('application_id', app.id).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['applications', userId] });
    qc.invalidateQueries({ queryKey: ['app-events', app.id] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const salary = f.salary_offered.trim() ? Number(f.salary_offered) : null;
      if (salary !== null && !Number.isFinite(salary)) throw new Error('Salary must be a number');
      const { error } = await supabase.from('job_applications').update({
        role: f.role.trim() || app.role, company: f.company.trim() || app.company, job_url: f.job_url.trim() || null,
        status: f.status, applied_date: f.applied_date, follow_up_date: f.follow_up_date || null,
        salary_offered: salary, notes: f.notes.trim() || null,
        interview_at: f.interview_at ? new Date(f.interview_at).toISOString() : null,
      }).eq('id', app.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Saved'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addNote = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('job_application_events').insert({ user_id: userId!, application_id: app.id, kind: 'note', note: note.trim() });
      if (error) throw error;
    },
    onSuccess: () => { setNote(''); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addToCalendar = useMutation({
    mutationFn: async () => {
      if (!f.interview_at) throw new Error('Pick the interview date and time first');
      const start = new Date(f.interview_at);
      const end = new Date(start.getTime() + 60 * 60000);
      const payload = {
        title: `Interview: ${f.role} @ ${f.company}`,
        description: [f.job_url, f.notes].filter(Boolean).join('\n') || null,
        event_date: format(start, 'yyyy-MM-dd'), event_time: format(start, 'HH:mm'),
        end_date: format(end, 'yyyy-MM-dd') !== format(start, 'yyyy-MM-dd') ? format(end, 'yyyy-MM-dd') : null, end_time: format(end, 'HH:mm'),
        is_all_day: false, category: 'interview', reminder_minutes: [60, 1440], reminder_sent_for: {},
      };
      let eventId = app.calendar_event_id;
      if (eventId) {
        const { error } = await supabase.from('calendar_events').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', eventId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('calendar_events').insert({ user_id: userId!, ...payload }).select('id').single();
        if (error) throw error;
        eventId = data.id as string;
      }
      const { error } = await supabase.from('job_applications').update({
        interview_at: start.toISOString(), calendar_event_id: eventId,
        status: app.status === 'applied' || app.status === 'screening' ? 'interview' : app.status,
      }).eq('id', app.id);
      if (error) throw error;
      if (app.status === 'applied' || app.status === 'screening') setF(x => ({ ...x, status: 'interview' }));
    },
    onSuccess: () => { toast.success('Added to your Calendar with reminders'); invalidate(); qc.invalidateQueries({ queryKey: ['calendar-events'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('job_applications').delete().eq('id', app.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Deleted'); invalidate(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF(x => ({ ...x, [k]: e.target.value }));
  const dirty = JSON.stringify(f) !== JSON.stringify({
    role: app.role, company: app.company, job_url: app.job_url ?? '', status: app.status, applied_date: app.applied_date,
    follow_up_date: app.follow_up_date ?? '', salary_offered: app.salary_offered?.toString() ?? '', notes: app.notes ?? '',
    interview_at: app.interview_at ? format(parseISO(app.interview_at), "yyyy-MM-dd'T'HH:mm") : '',
  });

  return (
    <Sheet open onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="max-w-lg">
        <header className="border-b p-5 pr-12">
          <SheetTitle className="text-lg font-semibold">{app.role}</SheetTitle>
          <p className="text-sm text-muted-foreground">{app.company}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {app.job_url && <a href={app.job_url} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline"><ExternalLink className="h-4 w-4" /> Posting</Button></a>}
            {app.public_slug && <Button size="sm" variant="outline" onClick={() => openJob(app.public_slug!)}>Job details</Button>}
          </div>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5"><Label>Role</Label><Input value={f.role} onChange={set('role')} /></div>
            <div className="col-span-2 space-y-1.5"><Label>Company</Label><Input value={f.company} onChange={set('company')} /></div>
            <div className="space-y-1.5">
              <Label>Stage</Label>
              <select value={f.status} onChange={set('status')} className="h-10 w-full rounded-lg border border-input bg-background px-2 text-sm">
                {STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label>Applied on</Label><Input type="date" value={f.applied_date} max={todayLocal()} onChange={set('applied_date')} /></div>
            <div className="space-y-1.5"><Label>Follow up on</Label><Input type="date" value={f.follow_up_date} onChange={set('follow_up_date')} /></div>
            <div className="space-y-1.5"><Label>Offer / salary (₹)</Label><Input inputMode="numeric" value={f.salary_offered} onChange={set('salary_offered')} placeholder="optional" /></div>
            <div className="col-span-2 space-y-1.5"><Label>Posting URL</Label><Input value={f.job_url} onChange={set('job_url')} placeholder="https://…" /></div>
            <div className="col-span-2 space-y-1.5">
              <Label>Interview</Label>
              <div className="flex gap-2">
                <Input type="datetime-local" value={f.interview_at} onChange={set('interview_at')} />
                <Button type="button" variant="outline" onClick={() => addToCalendar.mutate()} disabled={addToCalendar.isPending || !f.interview_at} title="Create a Calendar event with reminders">
                  <CalendarPlus className="h-4 w-4" /> {app.calendar_event_id ? 'Update' : 'Add'} in Calendar
                </Button>
              </div>
            </div>
            <div className="col-span-2 space-y-1.5"><Label>Notes</Label><Textarea value={f.notes} onChange={set('notes')} rows={4} placeholder="Contacts, questions, prep…" /></div>
          </div>
          <div className="flex justify-between gap-2">
            <Button variant="ghost" className="text-destructive" onClick={() => { if (confirm('Delete this application and its history?')) remove.mutate(); }}><Trash2 className="h-4 w-4" /> Delete</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>{save.isPending ? 'Saving…' : 'Save changes'}</Button>
          </div>

          <section>
            <h3 className="mb-2 text-sm font-semibold">Timeline</h3>
            <form className="mb-3 flex gap-2" onSubmit={e => { e.preventDefault(); if (note.trim()) addNote.mutate(); }}>
              <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note (e.g. “Recruiter called”)" maxLength={500} aria-label="Add a note" />
              <Button type="submit" variant="outline" disabled={!note.trim() || addNote.isPending}>Add</Button>
            </form>
            {eventsQ.isLoading ? <Skeleton className="h-20" /> : (
              <ol className="relative space-y-3 border-l pl-4">
                {(eventsQ.data ?? []).map(e => (
                  <li key={e.id} className="relative text-sm">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                    <div>{describeEvent(e)}</div>
                    <div className="text-xs text-muted-foreground">{timeAgo(e.created_at)} · {format(parseISO(e.created_at), 'd MMM yyyy, h:mm a')}</div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AddApplicationDialog({ onClose }: { onClose: () => void }) {
  const userId = useUserId();
  const qc = useQueryClient();
  const [f, setF] = useState({ company: '', role: '', job_url: '', status: 'applied' as Stage, applied_date: todayLocal(), notes: '' });
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('job_applications').insert({
        user_id: userId!, company: f.company.trim(), role: f.role.trim(), job_url: f.job_url.trim() || null,
        status: f.status, applied_date: f.applied_date, notes: f.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Added'); qc.invalidateQueries({ queryKey: ['applications', userId] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader><DialogTitle>Add application</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); add.mutate(); }}>
          <div className="space-y-1.5"><Label>Company</Label><Input required value={f.company} onChange={e => setF({ ...f, company: e.target.value })} autoFocus /></div>
          <div className="space-y-1.5"><Label>Role</Label><Input required value={f.role} onChange={e => setF({ ...f, role: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Job URL</Label><Input value={f.job_url} onChange={e => setF({ ...f, job_url: e.target.value })} placeholder="https://…" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Stage</Label>
              <select value={f.status} onChange={e => setF({ ...f, status: e.target.value as Stage })} className="h-10 w-full rounded-lg border border-input bg-background px-2 text-sm">
                {STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label>Applied on</Label><Input type="date" value={f.applied_date} max={todayLocal()} onChange={e => setF({ ...f, applied_date: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5"><Label>Notes</Label><Textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={add.isPending}>{add.isPending ? 'Adding…' : 'Add'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
