import { useEffect, useState } from 'react';
import { FilePlus2, FolderPlus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Input } from './ui/input';
import { Button } from './ui/button';

interface CreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing section (folder) paths, e.g. "projects" or "projects/active". */
  sections: string[];
  /** Section pre-selected when the dialog opens (folder path or ''). */
  initialSection?: string;
  /** Tab shown when the dialog opens (note by default). */
  initialTab?: 'note' | 'section';
  onCreateNote: (relativePath: string) => Promise<boolean>;
  onCreateSection: (path: string, firstNoteName?: string) => Promise<boolean>;
}

function slugSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '-').toLowerCase();
}

export default function CreateModal({ open, onOpenChange, sections, initialSection = '', initialTab = 'note', onCreateNote, onCreateSection }: CreateModalProps) {
  const [noteName, setNoteName] = useState('');
  const [noteSection, setNoteSection] = useState(initialSection);
  const [sectionName, setSectionName] = useState('');
  const [firstNote, setFirstNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setNoteName('');
      setSectionName('');
      setFirstNote('');
      setNoteSection(initialSection);
    }
  }, [open, initialSection]);

  const submitNote = async () => {
    const base = noteName.trim();
    if (!base) return;
    let file = base;
    if (!/\.(md|mdx)$/.test(file)) file += '.mdx';
    const relative = noteSection ? `${noteSection}/${file}` : file;
    setBusy(true);
    const ok = await onCreateNote(relative);
    setBusy(false);
    if (ok) onOpenChange(false);
  };

  const submitSection = async () => {
    const folder = slugSegment(sectionName);
    if (!folder) return;
    const base = noteSection ? `${noteSection}/${folder}` : folder;
    setBusy(true);
    const ok = await onCreateSection(base, firstNote.trim() || undefined);
    setBusy(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create</DialogTitle>
          <DialogDescription>Add a new note, or a section (folder) to group notes.</DialogDescription>
        </DialogHeader>

        <Tabs key={`${open}-${initialTab}`} defaultValue={initialTab}>
          <TabsList>
            <TabsTrigger value="note"><FilePlus2 className="h-3.5 w-3.5" /> Note</TabsTrigger>
            <TabsTrigger value="section"><FolderPlus className="h-3.5 w-3.5" /> Section</TabsTrigger>
          </TabsList>

          <TabsContent value="note" className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-[var(--ink-secondary)]" htmlFor="note-name">Note name</label>
              <Input id="note-name" autoFocus value={noteName} placeholder="meeting-notes" onChange={(e) => setNoteName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitNote()} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-[var(--ink-secondary)]" htmlFor="note-section">Section</label>
              <select id="note-section" className="field h-9 px-2.5 text-sm" value={noteSection} onChange={(e) => setNoteSection(e.target.value)}>
                <option value="">Workspace root</option>
                {sections.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <DialogFooter className="mt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={submitNote} disabled={busy || !noteName.trim()}>{busy ? 'Creating…' : 'Create note'}</Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="section" className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-[var(--ink-secondary)]" htmlFor="section-name">Section name</label>
              <Input id="section-name" autoFocus value={sectionName} placeholder="projects" onChange={(e) => setSectionName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitSection()} />
              {sectionName && <p className="font-mono text-[10px] text-[var(--ink-muted)]">Creates {noteSection ? `${noteSection}/` : ''}{slugSegment(sectionName)}/</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-[var(--ink-secondary)]" htmlFor="section-parent">Parent section</label>
              <select id="section-parent" className="field h-9 px-2.5 text-sm" value={noteSection} onChange={(e) => setNoteSection(e.target.value)}>
                <option value="">Workspace root</option>
                {sections.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-[var(--ink-secondary)]" htmlFor="first-note">First note <span className="text-[var(--ink-muted)]">(optional)</span></label>
              <Input id="first-note" value={firstNote} placeholder="overview" onChange={(e) => setFirstNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitSection()} />
            </div>
            <DialogFooter className="mt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={submitSection} disabled={busy || !sectionName.trim()}>{busy ? 'Creating…' : 'Create section'}</Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
