<div class="flex flex-wrap items-end justify-between gap-4">
  <div>
    <h1>Workspace view</h1>
    <p>A block-based <code>.vw</code> view. Put <code>class="lg:col-span-…"</code>
    on any tag to place it on a grid — the whole page is one 12-column bento.</p>
  </div>
  <div class="flex gap-2">
    <button label="Open in VS Code" action="openInVSCode" />
    <button label="Reveal workspace" action="reveal" />
  </div>
</div>

<div class="grid grid-cols-2 lg:grid-cols-12 gap-4">
  <metric class="lg:col-span-4" title="Release lane" value="Test" hint="Use before promoting a build." />
  <filecount class="lg:col-span-4" title="MDX notes" glob="*.mdx" />
  <filecount class="lg:col-span-4" title="View files" glob="*.vw" />

  <filegraph class="col-span-2 lg:col-span-7" title="Workspace files by type" />
  <div class="col-span-2 lg:col-span-5 flex flex-col gap-4">
    <listview title="Notes" glob="*.mdx" limit="6" />
    <bookmark url="https://tailwindcss.com" title="Tailwind CSS" description="The classes used to lay out these views." />
  </div>

  <card class="col-span-2 lg:col-span-8" title="Tasks — a Notion-style table saved to data/tasks.csv">
    <csvtable src="data/tasks.csv" />
  </card>
  <div class="col-span-2 lg:col-span-4 flex flex-col gap-4">
    <folderview title="Daily notes" path="daily" />
    <card title="Shortcuts">
      <div class="flex flex-col gap-2">
        <button label="Open getting started" action="open" path="getting-started.mdx" />
        <button label="New scratchpad note" action="createFile" path="scratch.md" content="# Scratch" />
      </div>
    </card>
  </div>

  <filetable class="col-span-2 lg:col-span-12" title="All workspace files" limit="12" />
</div>
