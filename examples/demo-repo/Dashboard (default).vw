<div class="flex flex-wrap items-end justify-between gap-4">
  <div>
    <h1>Dashboard</h1>
    <p>Standard blocks on a 12-column bento grid. Same data as the custom version — <code>data/tasks.csv</code> and <code>data/habits.csv</code>.</p>
  </div>
  <div class="flex gap-2">
    <button label="Custom version" action="open" path="Dashboard (custom).vw" />
    <button label="Reveal data" action="reveal" path="data" />
  </div>
</div>

<div class="grid grid-cols-2 lg:grid-cols-12 gap-4">
  <filecount class="lg:col-span-3" title="Notes" glob="*.mdx" />
  <filecount class="lg:col-span-3" title="Views" glob="*.vw" />
  <stat class="lg:col-span-3" label="Habit streak" value="18" delta="+3" sub="days logged" />
  <metric class="lg:col-span-3" title="Sprint" value="July W1" hint="Hand-curated value." />

  <barchart class="col-span-2 lg:col-span-8" title="Daily habit count" src="data/habits.csv" x="date" y="count" />
  <div class="col-span-2 lg:col-span-4 flex flex-col gap-4">
    <progress label="Sprint scope" value="7" max="12" />
    <heatmap title="Consistency" src="data/habits.csv" date="date" value="count" />
  </div>

  <card class="col-span-2 lg:col-span-8" title="Tasks — edits save to data/tasks.csv">
    <csvtable src="data/tasks.csv" />
  </card>
  <div class="col-span-2 lg:col-span-4 flex flex-col gap-4">
    <card title="Today">
      <task checked>Review the dashboard pair</task>
      <task>Log habits for the day</task>
      <task>Groom the task CSV</task>
    </card>
    <listview title="Recent views" glob="*.vw" limit="5" />
  </div>
</div>
