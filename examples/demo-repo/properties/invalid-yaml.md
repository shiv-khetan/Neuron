---
title: "unterminated
tags: [a, b
status: broken
---

# Invalid frontmatter

The YAML above is intentionally broken. Neuron shows a non-destructive error
banner instead of a properties panel, offers **Edit as YAML**, and keeps this
body fully readable. Nothing is overwritten until you fix the YAML yourself.
