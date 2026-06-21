import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, Upload, Download, Trash2, Plus, Search, Filter,
  Image, File, FileSpreadsheet, Eye, X, FolderOpen,
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

// ---- Types ----
interface Doc {
  id: string;
  title: string;
  category: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  remarks: string | null;
  created_at: string;
}

const CATEGORIES = [
  { id: 'all', label: 'All', emoji: '📁' },
  { id: 'aadhaar', label: 'Aadhaar', emoji: '🪪' },
  { id: 'pan', label: 'PAN', emoji: '💳' },
  { id: 'passport', label: 'Passport', emoji: '🛂' },
  { id: 'insurance', label: 'Insurance', emoji: '🛡️' },
  { id: 'rental_agreement', label: 'Rental', emoji: '🏠' },
  { id: 'driving_license', label: 'License', emoji: '🚗' },
  { id: 'other', label: 'Other', emoji: '📄' },
];

const ACCEPT = 'application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,image/jpeg,.jpg,.jpeg,image/png,.png';
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(mime: string) {
  if (mime.startsWith('image/')) return <Image className="h-5 w-5 text-emerald-500" />;
  if (mime.includes('pdf')) return <FileText className="h-5 w-5 text-red-500" />;
  if (mime.includes('word') || mime.includes('document')) return <FileSpreadsheet className="h-5 w-5 text-blue-500" />;
  return <File className="h-5 w-5 text-muted-foreground" />;
}

function getCategoryBadge(cat: string) {
  const c = CATEGORIES.find(x => x.id === cat);
  return c ? `${c.emoji} ${c.label}` : cat;
}

// ==================== Main Page ====================
export function DocumentsPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState('');

  // ---- Query ----
  const docsQ = useQuery({
    queryKey: ['documents', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('documents').select('*')
        .eq('user_id', userId!).order('created_at', { ascending: false });
      return (data ?? []) as Doc[];
    },
  });

  // ---- Upload mutation ----
  const uploadM = useMutation({
    mutationFn: async ({ title, category, file, remarks }: { title: string; category: string; file: File; remarks: string }) => {
      const ext = file.name.split('.').pop();
      const storagePath = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('documents').upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadErr) throw uploadErr;
      const { error: dbErr } = await supabase.from('documents').insert({
        user_id: userId!,
        title,
        category,
        file_path: storagePath,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        remarks: remarks || null,
      });
      if (dbErr) {
        // Cleanup storage on db failure
        await supabase.storage.from('documents').remove([storagePath]);
        throw dbErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents', userId] });
      toast.success('Document uploaded! 📄');
      setShowUpload(false);
    },
    onError: (e: any) => toast.error(e.message || 'Upload failed'),
  });

  // ---- Delete mutation ----
  const deleteM = useMutation({
    mutationFn: async (doc: Doc) => {
      const { error: storageErr } = await supabase.storage.from('documents').remove([doc.file_path]);
      if (storageErr) throw storageErr;
      const { error: dbErr } = await supabase.from('documents').delete().eq('id', doc.id).eq('user_id', userId!);
      if (dbErr) throw dbErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents', userId] });
      toast.success('Document deleted');
    },
    onError: (e: any) => toast.error(e.message || 'Delete failed'),
  });

  // ---- Download ----
  const handleDownload = useCallback(async (doc: Doc) => {
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 60);
    if (error || !data?.signedUrl) { toast.error('Failed to get download link'); return; }
    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.download = doc.file_name;
    a.target = '_blank';
    a.click();
  }, []);

  // ---- Preview ----
  const handlePreview = useCallback(async (doc: Doc) => {
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 300);
    if (error || !data?.signedUrl) { toast.error('Failed to load preview'); return; }
    setPreviewMime(doc.mime_type);
    setPreviewUrl(data.signedUrl);
  }, []);

  // ---- Filtered docs ----
  const docs = docsQ.data ?? [];
  const filtered = docs.filter(d => {
    if (filter !== 'all' && d.category !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return d.title.toLowerCase().includes(q) || d.file_name.toLowerCase().includes(q) || (d.remarks ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  // ---- Category counts ----
  const counts: Record<string, number> = {};
  for (const d of docs) counts[d.category] = (counts[d.category] ?? 0) + 1;
  counts['all'] = docs.length;

  // ==================== Render ====================
  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FolderOpen className="h-6 w-6 text-amber-500" /> Documents Vault
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Store and manage your important documents securely</p>
        </div>
        <Button onClick={() => setShowUpload(true)} className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white">
          <Plus className="h-4 w-4" /> Upload
        </Button>
      </div>

      {/* Search + Category Filter */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search documents..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-input bg-background text-sm"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(c => (
            <button
              key={c.id}
              onClick={() => setFilter(c.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                filter === c.id
                  ? 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                  : 'border-border hover:bg-muted',
              )}
            >
              <span>{c.emoji}</span> {c.label}
              {(counts[c.id] ?? 0) > 0 && (
                <span className="ml-1 text-[10px] bg-muted rounded-full px-1.5 py-0.5">{counts[c.id]}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Documents Grid */}
      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <FolderOpen className="h-12 w-12 mx-auto text-amber-400 mb-3" />
            <h2 className="text-lg font-semibold mb-1">
              {docs.length === 0 ? 'No documents yet' : 'No matching documents'}
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              {docs.length === 0 ? 'Upload your first document to get started.' : 'Try a different search or category.'}
            </p>
            {docs.length === 0 && (
              <Button onClick={() => setShowUpload(true)} variant="outline">
                <Upload className="h-4 w-4" /> Upload Document
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <AnimatePresence mode="popLayout">
            {filtered.map(doc => (
              <motion.div
                key={doc.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
              >
                <Card className="group hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {/* File icon / thumbnail */}
                      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                        {getFileIcon(doc.mime_type)}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm truncate">{doc.title}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{getCategoryBadge(doc.category)}</Badge>
                          <span className="text-[10px] text-muted-foreground">{formatBytes(doc.size_bytes)}</span>
                        </div>
                        {doc.remarks && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">{doc.remarks}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {new Date(doc.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {doc.mime_type.startsWith('image/') || doc.mime_type.includes('pdf') ? (
                          <button onClick={() => handlePreview(doc)} className="p-1.5 rounded hover:bg-muted" title="Preview">
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          </button>
                        ) : null}
                        <button onClick={() => handleDownload(doc)} className="p-1.5 rounded hover:bg-muted" title="Download">
                          <Download className="h-4 w-4 text-muted-foreground" />
                        </button>
                        <button
                          onClick={() => { if (confirm(`Delete "${doc.title}"?`)) deleteM.mutate(doc); }}
                          className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20" title="Delete"
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Upload Dialog */}
      <UploadDialog
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onUpload={(data) => uploadM.mutate(data)}
        uploading={uploadM.isPending}
      />

      {/* Preview Dialog */}
      <Dialog open={!!previewUrl} onOpenChange={() => setPreviewUrl(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Preview</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center overflow-auto max-h-[70vh]">
            {previewMime.startsWith('image/') ? (
              <img src={previewUrl!} alt="Preview" className="max-w-full max-h-[65vh] rounded-lg object-contain" />
            ) : previewMime.includes('pdf') ? (
              <iframe src={previewUrl!} className="w-full h-[65vh] rounded-lg border" title="PDF Preview" />
            ) : (
              <p className="text-muted-foreground">Preview not available for this file type.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ==================== Upload Dialog ====================
function UploadDialog({ open, onClose, onUpload, uploading }: {
  open: boolean; onClose: () => void;
  onUpload: (data: { title: string; category: string; file: File; remarks: string }) => void;
  uploading: boolean;
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('other');
  const [file, setFile] = useState<File | null>(null);
  const [remarks, setRemarks] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const resetForm = () => {
    setTitle(''); setCategory('other'); setFile(null); setRemarks(''); setDragOver(false);
  };

  const handleFile = (f: File) => {
    if (f.size > MAX_SIZE) { toast.error('File too large (max 10 MB)'); return; }
    const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'];
    if (!allowed.includes(f.type)) { toast.error('Unsupported file type. Use PDF, DOCX, JPG, or PNG.'); return; }
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleSubmit = () => {
    if (!file) { toast.error('Please select a file'); return; }
    if (!title.trim()) { toast.error('Please enter a title'); return; }
    onUpload({ title: title.trim(), category, file, remarks: remarks.trim() });
    resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={() => { onClose(); resetForm(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5 text-amber-500" /> Upload Document</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all',
              dragOver ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20' : 'border-border hover:border-amber-300 hover:bg-muted/50',
              file && 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20',
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            {file ? (
              <div className="flex items-center gap-3 justify-center">
                {getFileIcon(file.type)}
                <div className="text-left">
                  <p className="text-sm font-medium truncate max-w-[200px]">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                </div>
                <button onClick={e => { e.stopPropagation(); setFile(null); }} className="p-1 rounded hover:bg-muted">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <>
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Drag & drop or click to select</p>
                <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, JPG, PNG (max 10 MB)</p>
              </>
            )}
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Aadhaar Card Front" />
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <Label>Category</Label>
            <div className="flex gap-2 flex-wrap">
              {CATEGORIES.filter(c => c.id !== 'all').map(c => (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-all',
                    category === c.id
                      ? 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  <span>{c.emoji}</span> {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Remarks */}
          <div className="space-y-1.5">
            <Label>Remarks <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <textarea
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="Any notes about this document..."
              className="w-full h-16 rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={uploading || !file}
            className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
          >
            {uploading ? 'Uploading...' : '📄 Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
