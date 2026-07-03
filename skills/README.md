# Agent skills

Drop-in skills that teach AI agents how to work with Neuron.

| Skill | Teaches |
| --- | --- |
| [neuron-mini-apps](neuron-mini-apps/SKILL.md) | Building mini apps from `.vw` views, CSV-backed databases, and action buttons |

## Injecting into an agent

- **Claude Code**: copy the skill folder into `~/.claude/skills/` (global) or `<project>/.claude/skills/` (per-project).
- **Any other agent**: paste `SKILL.md` into the system prompt or context; it is self-contained.
