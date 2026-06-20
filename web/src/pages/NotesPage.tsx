import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { TextStyle, FontSize, FontFamily } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, Pin, PinOff, ChevronLeft, Check, Pencil,
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, IndentIncrease, IndentDecrease,
  Quote, Heading1, Heading2, Heading3, Palette, Highlighter,
  StickyNote, MoreVertical,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/Dialog';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/app/useSession';
import { cn } from '@/lib/utils';

// ==================== Types ====================
interface Section { id: string; name: string; color: string; icon: string; sort_order: number; }
interface Page { id: string; section_id: string; title: string; content_json: any; word_count: number; is_pinned: boolean; sort_order: number; updated_at: string; }

// ==================== Constants ====================
const FONTS = ['Inter', 'Calibri', 'Arial', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana'];
const FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '40px', '48px'];
const COLORS = ['#000000', '#374151', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#2563eb', '#7c3aed', '#db2777', '#6366f1'];
const HIGHLIGHT_COLORS = ['transparent', '#fef08a', '#bbf7d0', '#bfdbfe', '#e9d5ff', '#fecdd3', '#fed7aa', '#fde68a'];
const SECTION_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4'];

// ==================== Main Page ====================
export function NotesPage() {
  const { session } = useSession();
  const userId = session?.user.id;
  const qc = useQueryClient();

  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'sections' | 'pages' | 'editor'>('sections');

  // ---- Sections ----
  const sectionsQ = useQuery({
    queryKey: ['note-sections', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from('note_sections').select('*')
        .eq('user_id', userId!).order('sort_order');
      return (data ?? []) as Section[];
    },
  });

  // Auto-select first section
  useEffect(() => {
    if (!selectedSectionId && sectionsQ.data?.length) {
      setSelectedSectionId(sectionsQ.data[0].id);
    }
  }, [sectionsQ.data, selectedSectionId]);

  // ---- Pages ----
  const pagesQ = useQuery({
    queryKey: ['note-pages', userId, selectedSectionId],
    enabled: !!userId && !!selectedSectionId,
    queryFn: async () => {
      const { data } = await supabase.from('note_pages').select('*')
        .eq('user_id', userId!).eq('section_id', selectedSectionId!)
        .order('is_pinned', { ascending: false }).order('sort_order');
      return (data ?? []) as Page[];
    },
  });

  // Auto-select first page
  useEffect(() => {
    if (pagesQ.data?.length && !pagesQ.data.find(p => p.id === selectedPageId)) {
      setSelectedPageId(pagesQ.data[0].id);
    } else if (pagesQ.data && pagesQ.data.length === 0) {
      setSelectedPageId(null);
    }
  }, [pagesQ.data, selectedPageId]);

  const selectedPage = useMemo(() => pagesQ.data?.find(p => p.id === selectedPageId) ?? null, [pagesQ.data, selectedPageId]);

  // ---- CRUD Mutations ----
  const addSection = useMutation({
    mutationFn: async () => {
      const order = (sectionsQ.data?.length ?? 0);
      const color = SECTION_COLORS[order % SECTION_COLORS.length];
      const { data, error } = await supabase.from('note_sections')
        .insert({ user_id: userId!, name: 'New Section', color, icon: '📔', sort_order: order })
        .select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['note-sections', userId] });
      setSelectedSectionId(data.id);
      setMobileView('pages');
    },
  });

  const deleteSection = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('note_sections').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      setSelectedSectionId(null);
      setSelectedPageId(null);
      qc.invalidateQueries({ queryKey: ['note-sections', userId] });
      toast.success('Section deleted');
    },
  });

  const renameSection = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('note_sections').update({ name, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['note-sections', userId] }),
  });

  const addPage = useMutation({
    mutationFn: async () => {
      if (!selectedSectionId) return;
      const order = (pagesQ.data?.length ?? 0);
      const { data, error } = await supabase.from('note_pages')
        .insert({ user_id: userId!, section_id: selectedSectionId, title: 'Untitled', sort_order: order })
        .select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['note-pages', userId, selectedSectionId] });
      if (data) { setSelectedPageId(data.id); setMobileView('editor'); }
    },
  });

  const deletePage = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('note_pages').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      setSelectedPageId(null);
      qc.invalidateQueries({ queryKey: ['note-pages', userId, selectedSectionId] });
      toast.success('Page deleted');
    },
  });

  const togglePin = useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      const { error } = await supabase.from('note_pages').update({ is_pinned: !pinned }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['note-pages', userId, selectedSectionId] }),
  });

  // ==================== Render ====================
  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] max-w-7xl mx-auto">
      <div className="flex items-center gap-2 mb-3">
        <h1 className="text-2xl font-bold">Notes</h1>
      </div>

      {/* Mobile navigation */}
      <div className="flex gap-1 mb-2 sm:hidden">
        {(['sections', 'pages', 'editor'] as const).map(v => (
          <button key={v} onClick={() => setMobileView(v)}
            className={cn('px-3 py-1.5 text-xs font-medium rounded-md capitalize',
              mobileView === v ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
            {v}
          </button>
        ))}
      </div>

      <div className="flex flex-1 gap-0 rounded-xl border overflow-hidden bg-card min-h-0">
        {/* Sections Panel */}
        <div className={cn(
          'w-[200px] border-r flex flex-col bg-muted/30',
          mobileView !== 'sections' && 'hidden sm:flex',
        )}>
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Sections</span>
            <button onClick={() => addSection.mutate()} className="p-1 rounded hover:bg-muted" title="New section">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
            {sectionsQ.data?.map(s => (
              <SectionItem
                key={s.id}
                section={s}
                active={s.id === selectedSectionId}
                onSelect={() => { setSelectedSectionId(s.id); setSelectedPageId(null); setMobileView('pages'); }}
                onRename={(name) => renameSection.mutate({ id: s.id, name })}
                onDelete={() => deleteSection.mutate(s.id)}
              />
            ))}
          </div>
        </div>

        {/* Pages Panel */}
        <div className={cn(
          'w-[220px] border-r flex flex-col',
          mobileView !== 'pages' && 'hidden sm:flex',
        )}>
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pages</span>
            <button onClick={() => addPage.mutate()} className="p-1 rounded hover:bg-muted" title="New page" disabled={!selectedSectionId}>
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
            {pagesQ.data?.map(p => (
              <PageItem
                key={p.id}
                page={p}
                active={p.id === selectedPageId}
                onSelect={() => { setSelectedPageId(p.id); setMobileView('editor'); }}
                onDelete={() => deletePage.mutate(p.id)}
                onTogglePin={() => togglePin.mutate({ id: p.id, pinned: p.is_pinned })}
              />
            ))}
            {pagesQ.data?.length === 0 && selectedSectionId && (
              <p className="text-xs text-muted-foreground text-center py-6">No pages yet</p>
            )}
          </div>
        </div>

        {/* Editor Panel */}
        <div className={cn(
          'flex-1 flex flex-col min-w-0',
          mobileView !== 'editor' && 'hidden sm:flex',
        )}>
          {selectedPage ? (
            <NoteEditor
              key={selectedPage.id}
              page={selectedPage}
              userId={userId!}
              onTitleChange={(title) => {
                qc.setQueryData(['note-pages', userId, selectedSectionId], (old: Page[] | undefined) =>
                  old?.map(p => p.id === selectedPage.id ? { ...p, title } : p)
                );
              }}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center space-y-2">
                <StickyNote className="h-12 w-12 mx-auto opacity-30" />
                <p className="text-sm">Select or create a page to start writing</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== Section Item ====================
function SectionItem({ section, active, onSelect, onRename, onDelete }: {
  section: Section; active: boolean; onSelect: () => void; onRename: (name: string) => void; onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(section.name);
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className={cn(
      'group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer text-sm transition-colors relative',
      active ? 'bg-primary/10 text-foreground font-medium' : 'hover:bg-muted text-muted-foreground hover:text-foreground'
    )} onClick={onSelect}>
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: section.color }} />
      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={() => { setEditing(false); if (name.trim() && name !== section.name) onRename(name.trim()); }}
          onKeyDown={e => { if (e.key === 'Enter') { setEditing(false); if (name.trim()) onRename(name.trim()); } if (e.key === 'Escape') { setEditing(false); setName(section.name); } }}
          onClick={e => e.stopPropagation()}
          className="flex-1 bg-transparent border-b border-primary outline-none text-sm min-w-0"
        />
      ) : (
        <span className="flex-1 truncate">{section.name}</span>
      )}
      <button
        onClick={e => { e.stopPropagation(); setShowMenu(!showMenu); }}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted-foreground/10"
      >
        <MoreVertical className="h-3 w-3" />
      </button>
      {showMenu && (
        <div className="absolute right-1 top-full z-20 mt-1 bg-popover border rounded-lg shadow-lg py-1 min-w-[100px]" onMouseLeave={() => setShowMenu(false)}>
          <button onClick={e => { e.stopPropagation(); setEditing(true); setShowMenu(false); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center gap-2">
            <Pencil className="h-3 w-3" /> Rename
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete(); setShowMenu(false); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted text-destructive flex items-center gap-2">
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ==================== Page Item ====================
function PageItem({ page, active, onSelect, onDelete, onTogglePin }: {
  page: Page; active: boolean; onSelect: () => void; onDelete: () => void; onTogglePin: () => void;
}) {
  return (
    <div className={cn(
      'group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer text-sm transition-colors',
      active ? 'bg-primary/10 text-foreground font-medium' : 'hover:bg-muted text-muted-foreground hover:text-foreground'
    )} onClick={onSelect}>
      {page.is_pinned && <Pin className="h-3 w-3 text-primary shrink-0" />}
      <span className="flex-1 truncate">{page.title || 'Untitled'}</span>
      <div className="opacity-0 group-hover:opacity-100 flex gap-0.5">
        <button onClick={e => { e.stopPropagation(); onTogglePin(); }} className="p-0.5 rounded hover:bg-muted-foreground/10" title={page.is_pinned ? 'Unpin' : 'Pin'}>
          {page.is_pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
        </button>
        <button onClick={e => { e.stopPropagation(); onDelete(); }} className="p-0.5 rounded hover:bg-muted-foreground/10 text-destructive" title="Delete">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ==================== Note Editor ====================
function NoteEditor({ page, userId, onTitleChange }: { page: Page; userId: string; onTitleChange: (title: string) => void; }) {
  const [title, setTitle] = useState(page.title);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextStyle.configure(),
      FontSize.configure({}),
      FontFamily.configure({}),
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      FontFamily,
      Placeholder.configure({ placeholder: 'Start writing...' }),
    ],
    content: page.content_json,
    onUpdate: ({ editor }) => {
      setSaveStatus('idle');
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        saveContent(editor.getJSON());
      }, 1500);
    },
  });

  const saveContent = useCallback(async (json: any) => {
    setSaveStatus('saving');
    const text = editor?.getText() ?? '';
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const { error } = await supabase.from('note_pages').update({
      content_json: json, word_count: wordCount, updated_at: new Date().toISOString(),
    }).eq('id', page.id);
    setSaveStatus(error ? 'idle' : 'saved');
  }, [page.id, editor]);

  // Save on unmount
  useEffect(() => {
    return () => {
      if (saveTimeout.current) {
        clearTimeout(saveTimeout.current);
        if (editor) {
          const json = editor.getJSON();
          const text = editor.getText();
          const wordCount = text.split(/\s+/).filter(Boolean).length;
          supabase.from('note_pages').update({
            content_json: json, word_count: wordCount, updated_at: new Date().toISOString(),
          }).eq('id', page.id);
        }
      }
    };
  }, [page.id, editor]);

  // Title auto-save
  const handleTitleChange = (value: string) => {
    setTitle(value);
    onTitleChange(value);
    if (titleTimeout.current) clearTimeout(titleTimeout.current);
    titleTimeout.current = setTimeout(async () => {
      await supabase.from('note_pages').update({ title: value || 'Untitled', updated_at: new Date().toISOString() }).eq('id', page.id);
    }, 800);
  };

  if (!editor) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <NotesToolbar editor={editor} saveStatus={saveStatus} />

      {/* Title */}
      <div className="px-6 pt-4 pb-1">
        <input
          value={title}
          onChange={e => handleTitleChange(e.target.value)}
          className="w-full text-2xl font-bold bg-transparent outline-none placeholder:text-muted-foreground/40"
          placeholder="Page title..."
        />
      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <EditorContent editor={editor} className="tiptap-editor min-h-[300px]" />
      </div>
    </div>
  );
}

// ==================== Toolbar ====================
function NotesToolbar({ editor, saveStatus }: { editor: any; saveStatus: string }) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);

  const ToolBtn = ({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'p-1.5 rounded-md transition-colors',
        active ? 'bg-primary/15 text-primary' : 'hover:bg-muted text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-3 py-1.5 border-b bg-muted/20 min-h-[42px]">
      {/* Font Family */}
      <select
        value={editor.getAttributes('textStyle').fontFamily || 'Inter'}
        onChange={e => editor.chain().focus().setFontFamily(e.target.value).run()}
        className="h-7 text-xs rounded border bg-background px-1.5 max-w-[100px]"
        title="Font family"
      >
        {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
      </select>

      {/* Font Size */}
      <select
        value={editor.getAttributes('textStyle').fontSize || '16px'}
        onChange={e => editor.chain().focus().setFontSize(e.target.value).run()}
        className="h-7 text-xs rounded border bg-background px-1.5 w-[60px]"
        title="Font size"
      >
        {FONT_SIZES.map(s => <option key={s} value={s}>{parseInt(s)}</option>)}
      </select>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Text Formatting */}
      <ToolBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
        <Bold className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
        <Italic className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
        <UnderlineIcon className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolBtn>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Colors */}
      <div className="relative">
        <ToolBtn active={showColorPicker} onClick={() => { setShowColorPicker(!showColorPicker); setShowHighlightPicker(false); }} title="Text color">
          <Palette className="h-3.5 w-3.5" />
        </ToolBtn>
        {showColorPicker && (
          <div className="absolute top-full left-0 mt-1 z-30 bg-popover border rounded-lg shadow-lg p-2 grid grid-cols-5 gap-1" onMouseLeave={() => setShowColorPicker(false)}>
            {COLORS.map(c => (
              <button key={c} onClick={() => { editor.chain().focus().setColor(c).run(); setShowColorPicker(false); }}
                className="w-5 h-5 rounded-full border border-border hover:scale-125 transition-transform" style={{ backgroundColor: c }} />
            ))}
          </div>
        )}
      </div>
      <div className="relative">
        <ToolBtn active={showHighlightPicker} onClick={() => { setShowHighlightPicker(!showHighlightPicker); setShowColorPicker(false); }} title="Highlight">
          <Highlighter className="h-3.5 w-3.5" />
        </ToolBtn>
        {showHighlightPicker && (
          <div className="absolute top-full left-0 mt-1 z-30 bg-popover border rounded-lg shadow-lg p-2 grid grid-cols-4 gap-1" onMouseLeave={() => setShowHighlightPicker(false)}>
            {HIGHLIGHT_COLORS.map(c => (
              <button key={c} onClick={() => { if (c === 'transparent') editor.chain().focus().unsetHighlight().run(); else editor.chain().focus().toggleHighlight({ color: c }).run(); setShowHighlightPicker(false); }}
                className={cn('w-5 h-5 rounded border border-border hover:scale-125 transition-transform', c === 'transparent' && 'bg-background relative after:absolute after:inset-0 after:border-t after:border-destructive after:rotate-45 after:origin-center')}
                style={c !== 'transparent' ? { backgroundColor: c } : undefined} />
            ))}
          </div>
        )}
      </div>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Alignment */}
      <ToolBtn active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="Align left">
        <AlignLeft className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Align center">
        <AlignCenter className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} title="Align right">
        <AlignRight className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()} title="Justify">
        <AlignJustify className="h-3.5 w-3.5" />
      </ToolBtn>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Lists & Indent */}
      <ToolBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
        <List className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Ordered list">
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn active={false} onClick={() => editor.chain().focus().sinkListItem('listItem').run()} title="Increase indent">
        <IndentIncrease className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn active={false} onClick={() => editor.chain().focus().liftListItem('listItem').run()} title="Decrease indent">
        <IndentDecrease className="h-3.5 w-3.5" />
      </ToolBtn>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Headings & Block */}
      <ToolBtn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">
        <Heading1 className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
        <Heading2 className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">
        <Heading3 className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">
        <Quote className="h-3.5 w-3.5" />
      </ToolBtn>

      {/* Save Status */}
      <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
        {saveStatus === 'saving' && <span className="animate-pulse">Saving...</span>}
        {saveStatus === 'saved' && <><Check className="h-3 w-3 text-green-500" /><span>Saved</span></>}
      </div>
    </div>
  );
}
