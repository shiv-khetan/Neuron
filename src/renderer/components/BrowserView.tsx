import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCw } from 'lucide-react';

// Electron's <webview> intrinsic element is already typed by React's DOM lib.

/** An embedded browser tab: an Electron webview plus a navigation bar. */
export default function BrowserView({ url }: { url: string }) {
  const ref = useRef<any>(null);
  const [address, setAddress] = useState(url);

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    const sync = () => { try { setAddress(wv.getURL()); } catch { /* not ready */ } };
    wv.addEventListener('did-navigate', sync);
    wv.addEventListener('did-navigate-in-page', sync);
    return () => {
      wv.removeEventListener('did-navigate', sync);
      wv.removeEventListener('did-navigate-in-page', sync);
    };
  }, []);

  const go = (raw: string) => {
    let u = raw.trim();
    if (!u) return;
    if (!/^https?:\/\//.test(u)) u = `https://${u}`;
    ref.current?.loadURL(u);
  };

  const navBtn = 'interactive grid h-7 w-7 shrink-0 place-items-center rounded text-[var(--ink-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]';

  return (
    <div className="flex h-full w-full flex-col bg-[var(--canvas)]">
      <div className="flex items-center gap-1 border-b divider-color px-2 py-1.5">
        <button className={navBtn} title="Back" aria-label="Back" onClick={() => ref.current?.goBack?.()}><ArrowLeft className="h-4 w-4" /></button>
        <button className={navBtn} title="Forward" aria-label="Forward" onClick={() => ref.current?.goForward?.()}><ArrowRight className="h-4 w-4" /></button>
        <button className={navBtn} title="Reload" aria-label="Reload" onClick={() => ref.current?.reload?.()}><RotateCw className="h-4 w-4" /></button>
        <input
          className="field py-1 font-mono text-xs"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') go(address); }}
          placeholder="Enter a URL and press Enter"
          spellCheck={false}
        />
      </div>
      <div className="min-h-0 flex-1">
        <webview ref={ref} src={url} partition="persist:neuron-browser" style={{ width: '100%', height: '100%', display: 'flex' }} />
      </div>
    </div>
  );
}
