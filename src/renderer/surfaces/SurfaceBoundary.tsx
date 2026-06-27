import * as React from 'react';

// A crashed surface (bad view file, renderer bug) must not take down the app
// shell — the user can still switch to Source mode and fix the file.
export class SurfaceBoundary extends React.Component<{ resetKey: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-[var(--ink-muted)]">
        This view crashed while rendering. Switch to Source mode to inspect and fix the file.
      </div>
    );
  }
}
