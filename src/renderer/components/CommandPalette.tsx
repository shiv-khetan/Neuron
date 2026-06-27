import { Blocks, Chrome, FileCode2, FolderPlus, Globe, PanelsTopLeft, Settings, Shapes, SquareStack } from 'lucide-react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command';
import { usePlugins } from '../plugins/host';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notes: string[];
  onSelectNote: (note: string) => void;
  onOpenMarketplace: () => void;
  onOpenSettings: () => void;
  onCreate: () => void;
  onCreateSurface: () => void;
  onOpenWebsite: () => void;
  onOpenGallery: () => void;
  onToggleShell: () => void;
  shellActive: boolean;
  onImportChromeLogins: () => void;
}

export default function CommandPalette({ open, onOpenChange, notes, onSelectNote, onOpenMarketplace, onOpenSettings, onCreate, onCreateSurface, onOpenWebsite, onOpenGallery, onToggleShell, shellActive, onImportChromeLogins }: CommandPaletteProps) {
  const { commands, runtimeFor } = usePlugins();
  const close = () => onOpenChange(false);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search notes or run a command…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => { onCreate(); close(); }}><FolderPlus /> Create note or section</CommandItem>
          <CommandItem onSelect={() => { onCreateSurface(); close(); }}><SquareStack /> New block view in current folder</CommandItem>
          <CommandItem onSelect={() => { onToggleShell(); close(); }}><PanelsTopLeft /> {shellActive ? 'Hide workspace layout' : 'Use workspace layout (.neuron/layout.json)'}</CommandItem>
          <CommandItem onSelect={() => { onOpenWebsite(); close(); }}><Globe /> Open website tab</CommandItem>
          <CommandItem onSelect={() => { onImportChromeLogins(); close(); }}><Chrome /> Import Chrome logins</CommandItem>
          <CommandItem onSelect={() => { onOpenMarketplace(); close(); }}><Blocks /> Plugins & integrations</CommandItem>
          <CommandItem onSelect={() => { onOpenGallery(); close(); }}><Shapes /> Component gallery</CommandItem>
          <CommandItem onSelect={() => { onOpenSettings(); close(); }}><Settings /> Open settings</CommandItem>
        </CommandGroup>

        {commands.length > 0 && (
          <CommandGroup heading="Plugin commands">
            {commands.map(({ pluginId, command }) => (
              <CommandItem key={command.id} value={command.title} onSelect={() => { command.run(runtimeFor(pluginId)); close(); }}>
                <Blocks /> {command.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Notes">
          {notes.map((note) => (
            <CommandItem key={note} value={note} onSelect={() => { onSelectNote(note); close(); }}>
              <FileCode2 /> <span className="font-mono text-xs">{note}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
