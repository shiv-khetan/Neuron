<header class="flex flex-wrap items-end justify-between gap-4 border-b pb-4">
  <div>
    <h1 class="text-3xl font-semibold tracking-tight">Mission control</h1>
    <p class="text-sm">Custom HTML + Tailwind over the same CSVs as "Dashboard (default)".</p>
  </div>
  <div class="flex gap-2">
    <button label="Default version" action="open" path="Dashboard (default).vw" />
    <button label="New scratch note" action="createFile" path="daily/scratch.md" content="# Scratch" />
  </div>
</header>

<div class="grid grid-cols-2 lg:grid-cols-12 gap-4">
  <div class="col-span-2 lg:col-span-4 lg:row-span-2 rounded-xl bg-[var(--surface)] p-6 flex flex-col justify-between gap-6">
    <div>
      <p class="text-xs font-medium text-[var(--ink-muted)]">This week's focus</p>
      <p class="mt-2 text-4xl font-semibold tracking-tight text-[var(--ink)]">Ship 1.1</p>
      <p class="mt-2 text-sm">Dashboards, databases, and the canvas — demo-ready and documented.</p>
    </div>
    <div class="flex gap-3">
      <div class="flex-1 rounded-lg bg-[var(--canvas)] p-3">
        <p class="text-xs text-[var(--ink-muted)]">Risk</p>
        <p class="text-lg font-semibold text-[var(--ink)]">Low</p>
      </div>
      <div class="flex-1 rounded-lg bg-[var(--canvas)] p-3">
        <p class="text-xs text-[var(--ink-muted)]">Mood</p>
        <p class="text-lg font-semibold text-[var(--ink)]">Calm</p>
      </div>
    </div>
  </div>

  <areachart class="col-span-2 lg:col-span-8" title="Habit momentum — data/habits.csv" src="data/habits.csv" x="date" y="count" />

  <heatmap class="col-span-2 lg:col-span-5" title="18-week consistency" src="data/habits.csv" date="date" value="count" />
  <bookmark class="col-span-2 lg:col-span-3" url="https://jsoncanvas.org" title="JSON Canvas spec" description="The format behind Idea board.canvas" />

  <card class="col-span-2 lg:col-span-9" title="Task board — edits save to data/tasks.csv">
    <csvtable src="data/tasks.csv" />
  </card>
  <div class="col-span-2 lg:col-span-3 rounded-xl bg-[var(--surface)] p-4">
    <p class="text-xs font-medium text-[var(--ink-muted)]">Today</p>
    <div class="mt-1">
      <task checked>Review the dashboard pair</task>
      <task>Log habits for the day</task>
      <task>Groom the task CSV</task>
    </div>
  </div>
</div>
