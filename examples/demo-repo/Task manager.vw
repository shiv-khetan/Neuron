<h1>Task manager</h1>
<p>A daily task board built entirely in a <code>.vw</code> view — HTML for layout,
Tailwind for styling, view tags for live data. The table below is a database
backed by <code>data/tasks.csv</code>; edit that file and the board updates.</p>

<div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
  <stat label="Sprint" value="July W1" sub="Current cycle" />
  <filecount title="Notes in workspace" glob="*.mdx" />
  <filecount title="Data files" glob="*.csv" />
  <filecount title="Views" glob="*.vw" />
</div>

<h2>Quick checklist</h2>
<card title="Today">
  <task checked="true">Review yesterday's open tasks</task>
  <task checked="true">Triage new items into the CSV</task>
  <task>Pick the top priority and start it</task>
  <task>Update statuses before end of day</task>
</card>

<h2>Task database</h2>
<p>Click any column header to sort. This reads <code>data/tasks.csv</code> directly.</p>
<csvtable title="All tasks" src="data/tasks.csv" />

<h2>Actions</h2>
<div class="flex flex-wrap gap-3">
  <button label="Open tasks.csv in VS Code" action="openInVSCode" />
  <button label="Reveal workspace" action="reveal" />
  <button automation="Build and test" label="Run build" hint="Create a 'Build and test' automation in the Automations panel first." />
</div>
