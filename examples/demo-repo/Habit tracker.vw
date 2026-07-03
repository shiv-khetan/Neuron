<h1>Habit tracker</h1>
<p>A dashboard-style view built from <code>.vw</code> tags — progress, stats, charts,
and a contribution heatmap, all reading <code>data/habits.csv</code> (a
<code>date,count</code> log). Edit the log below and every visual updates.</p>

<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
  <stat label="Current streak" value="6 days" delta="+1 vs yesterday" sub="Days with ≥1 habit" />
  <stat label="This week" value="21" delta="+3 vs last week" sub="Habits completed" />
  <stat label="Completion" value="74%" delta="+5%" sub="Last 30 days" />
  <stat label="Best day" value="5" delta="0 vs record" sub="Habits in one day" />
</div>

<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
  <progress label="Today's habits" value="3" max="5" />
  <progress label="Weekly goal" value="21" max="35" />
</div>

<h2>Activity</h2>
<heatmap title="Daily habit streak" src="data/habits.csv" date="date" value="count" />

<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
  <areachart title="Completion trend" src="data/habits.csv" x="date" y="count" />
  <barchart title="Habits by weekday" data='[{"name":"Mon","value":4},{"name":"Tue","value":5},{"name":"Wed","value":3},{"name":"Thu","value":4},{"name":"Fri","value":5},{"name":"Sat","value":2},{"name":"Sun","value":1}]' />
</div>

<h2>Daily log</h2>
<p>The source of truth — edit a cell, add a row, and the charts above follow.</p>
<csvtable title="habits.csv" src="data/habits.csv" />
