import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bookmark, Plus, Search, Trash2, Edit2, ExternalLink, Github,
  Globe, Wrench, FileText, Video, Users, FolderOpen,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/Dialog';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { cn } from '@/lib/utils';

interface BM {
  id: string;
  title: string;
  url: string;
  category: string;
  description: string | null;
  created_at: string;
}

const CATEGORIES = [
  { id: 'all', label: 'All', emoji: '📚', icon: FolderOpen },
  { id: 'github', label: 'GitHub', emoji: '🐙', icon: Github },
  { id: 'website', label: 'Website', emoji: '🌐', icon: Globe },
  { id: 'tool', label: 'Tool', emoji: '🔧', icon: Wrench },
  { id: 'article', label: 'Article', emoji: '📰', icon: FileText },
  { id: 'video', label: 'Video', emoji: '🎬', icon: Video },
  { id: 'social', label: 'Social', emoji: '👥', icon: Users },
  { id: 'other', label: 'Other', emoji: '📌', icon: Bookmark },
];

function getCat(cat: string) { return CATEGORIES.find(c => c.id === cat) ?? CATEGORIES[7]; }

function getDomain(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function BookmarksPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<BM | null>(null);

  const bmQ = useQuery({
    queryKey: ['bookmarks', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('bookmarks').select('*')
        .eq('user_id', userId!).order('created_at', { ascending: false });
      return (data ?? []) as BM[];
    },
  });

  const saveM = useMutation({
    mutationFn: async (data: Partial<BM> & { id?: string }) => {
      if (data.id) {
        const { error } = await supabase.from('bookmarks').update({
          title: data.title, url: data.url, category: data.category,
          description: data.description, updated_at: new Date().toISOString(),
        }).eq('id', data.id).eq('user_id', userId!);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('bookmarks').insert({
          user_id: userId!, title: data.title, url: data.url,
          category: data.category, description: data.description,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookmarks', userId] });
      toast.success(editing ? 'Bookmark updated!' : 'Bookmark saved! 🔖');
      setShowDialog(false); setEditing(null);
    },
    onError: (e: any) => toast.error(e.message || 'Failed to save'),
  });

  const deleteM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('bookmarks').delete().eq('id', id).eq('user_id', userId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookmarks', userId] });
      toast.success('Bookmark deleted');
    },
  });

  const all = bmQ.data ?? [];
  const filtered = all.filter(b => {
    if (filter !== 'all' && b.category !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q) || (b.description ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  const counts: Record<string, number> = {};
  for (const b of all) counts[b.category] = (counts[b.category] ?? 0) + 1;
  counts['all'] = all.length;

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bookmark className="h-6 w-6 text-indigo-500" /> Bookmarks
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Save and organize your important links</p>
        </div>
        <Button onClick={() => { setEditing(null); setShowDialog(true); }}
          className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white">
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      {/* Search + Categories */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input type="text" placeholder="Search bookmarks..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-input bg-background text-sm" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(c => (
            <button key={c.id} onClick={() => setFilter(c.id)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                filter === c.id ? 'bg-indigo-100 border-indigo-300 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'border-border hover:bg-muted')}>
              <span>{c.emoji}</span> {c.label}
              {(counts[c.id] ?? 0) > 0 && <span className="ml-0.5 text-[10px] bg-muted rounded-full px-1.5 py-0.5">{counts[c.id]}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Bookmarks list */}
      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Bookmark className="h-12 w-12 mx-auto text-indigo-400 mb-3" />
            <h2 className="text-lg font-semibold mb-1">{all.length === 0 ? 'No bookmarks yet' : 'No matching bookmarks'}</h2>
            <p className="text-sm text-muted-foreground mb-4">{all.length === 0 ? 'Save your first link to get started.' : 'Try a different search or category.'}</p>
            {all.length === 0 && <Button onClick={() => setShowDialog(true)} variant="outline"><Plus className="h-4 w-4" /> Add Bookmark</Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {filtered.map(b => {
              const cat = getCat(b.category);
              const CatIcon = cat.icon;
              return (
                <motion.div key={b.id} layout initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
                  <Card className="group hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                          <CatIcon className="h-4 w-4 text-indigo-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <a href={b.url} target="_blank" rel="noopener noreferrer"
                            className="text-sm font-medium hover:text-indigo-600 hover:underline flex items-center gap-1 truncate">
                            {b.title} <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-50" />
                          </a>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] text-muted-foreground truncate">{getDomain(b.url)}</span>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{cat.emoji} {cat.label}</Badge>
                          </div>
                          {b.description && <p className="text-xs text-muted-foreground mt-1 truncate">{b.description}</p>}
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => { setEditing(b); setShowDialog(true); }} className="p-1.5 rounded hover:bg-muted" title="Edit">
                            <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <button onClick={() => { if (confirm(`Delete "${b.title}"?`)) deleteM.mutate(b.id); }}
                            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20" title="Delete">
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Add/Edit Dialog */}
      <BookmarkDialog open={showDialog} onClose={() => { setShowDialog(false); setEditing(null); }}
        existing={editing} onSave={data => saveM.mutate(data)} saving={saveM.isPending} />
    </div>
  );
}

// ==================== Dialog ====================
function BookmarkDialog({ open, onClose, existing, onSave, saving }: {
  open: boolean; onClose: () => void; existing: BM | null;
  onSave: (data: any) => void; saving: boolean;
}) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState('website');
  const [description, setDescription] = useState('');

  const populate = useCallback(() => {
    if (existing) {
      setTitle(existing.title); setUrl(existing.url);
      setCategory(existing.category); setDescription(existing.description ?? '');
    } else {
      setTitle(''); setUrl(''); setCategory('website'); setDescription('');
    }
  }, [existing]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useState(() => { if (open) populate(); });
  // Re-populate when dialog opens
  if (open && !title && !url && existing) populate();
  if (open && !existing && !url) { /* fresh form */ }

  const handleSubmit = () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    if (!url.trim()) { toast.error('URL is required'); return; }
    let finalUrl = url.trim();
    if (!/^https?:\/\//i.test(finalUrl)) finalUrl = 'https://' + finalUrl;
    const payload: any = { title: title.trim(), url: finalUrl, category, description: description.trim() || null };
    if (existing) payload.id = existing.id;
    onSave(payload);
  };

  return (
    <Dialog open={open} onOpenChange={() => { onClose(); setTitle(''); setUrl(''); setDescription(''); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bookmark className="h-5 w-5 text-indigo-500" /> {existing ? 'Edit Bookmark' : 'Add Bookmark'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>URL</Label>
            <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://github.com/..." />
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="My awesome repo" />
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <div className="flex gap-2 flex-wrap">
              {CATEGORIES.filter(c => c.id !== 'all').map(c => (
                <button key={c.id} onClick={() => setCategory(c.id)}
                  className={cn('flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-all',
                    category === c.id ? 'bg-indigo-100 border-indigo-300 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'border-border hover:bg-muted')}>
                  <span>{c.emoji}</span> {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Why is this useful..."
              className="w-full h-16 rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none" />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={handleSubmit} disabled={saving}
            className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white">
            {saving ? 'Saving...' : existing ? '✏️ Update' : '🔖 Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
