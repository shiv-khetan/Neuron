import { Blocks, FileCode2, FolderPlus, Network, Settings } from 'lucide-react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command';
import { usePlugins } from '../plugins/host';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notes: string[];
  onSelectNote: (note: string) => void;
  onOpenGraph: () => void;
  onOpenMarketplace: () => void;
  onOpenSettings: () => void;
  onCreate: () => void;
}

export default function CommandPalette({ open, onOpenChange, notes, onSelectNote, onOpenGraph, onOpenMarketplace, onOpenSettings, onCreate }: CommandPaletteProps) {
  const { commands, runtimeFor } = usePlugins();
  const close = () => onOpenChange(false);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search notes or run a command…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => { onCreate(); close(); }}><FolderPlus /> Create note or section</CommandItem>
          <CommandItem onSelect={() => { onOpenGraph(); close(); }}><Network /> Open knowledge graph</CommandItem>
          <CommandItem onSelect={() => { onOpenMarketplace(); close(); }}><Blocks /> Plugins & integrations</CommandItem>
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
