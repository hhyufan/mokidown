import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Channel, invoke } from '@tauri-apps/api/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import useThemeStore from '@store/useThemeStore';
import { openExternal } from '@utils/tauriApi';
import '@xterm/xterm/css/xterm.css';

const ansi = {
  light: {
    black: '#343840', red: '#b52a37', green: '#27602c', yellow: '#765014',
    blue: '#2654a5', magenta: '#793989', cyan: '#146775', white: '#4b5260',
    brightBlack: '#626b78', brightRed: '#b63046', brightGreen: '#2e6b34', brightYellow: '#8a5900',
    brightBlue: '#325bb2', brightMagenta: '#853691', brightCyan: '#1b6878', brightWhite: '#2c2c2e',
  },
  dark: {
    black: '#7b8290', red: '#e77581', green: '#9bcf79', yellow: '#e6be79',
    blue: '#79abef', magenta: '#d098e1', cyan: '#70c2d0', white: '#d4d8df',
    brightBlack: '#a1a8b5', brightRed: '#ff96a5', brightGreen: '#b5e795', brightYellow: '#ffd787',
    brightBlue: '#9cc6ff', brightMagenta: '#e9b2f6', brightCyan: '#9addec', brightWhite: '#f5f5f7',
  },
};

function terminalTheme(element) {
  const style = getComputedStyle(element);
  const mode = element.ownerDocument.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  return {
    ...ansi[mode],
    // xterm uses the RGB channels for contrast correction even at zero alpha.
    background: mode === 'dark' ? '#18181800' : '#ffffff00',
    foreground: style.color,
    cursor: style.getPropertyValue('--code-caret').trim() || style.color,
    cursorAccent: style.getPropertyValue('--surface').trim(),
    selectionBackground: style.getPropertyValue('--selection-bg').trim() || '#4091ff54',
  };
}

export default function TerminalPane({ active, directory }) {
  const { t } = useTranslation();
  const theme = useThemeStore((state) => state.theme);
  const hostRef = useRef(null);
  const engineRef = useRef(null);
  const [status, setStatus] = useState({ state: 'starting' });

  useEffect(() => {
    const host = hostRef.current;
    const win = host.ownerDocument.defaultView;
    const term = new Terminal({
      allowTransparency: true, cursorBlink: true, cursorStyle: 'bar', cursorWidth: 2, disableStdin: true, scrollback: 4000,
      minimumContrastRatio: 4.5,
      fontSize: 13, lineHeight: 1.25, fontFamily: getComputedStyle(host).fontFamily,
      theme: terminalTheme(host),
      ...(/Windows/i.test(navigator.userAgent) ? { windowsPty: { backend: 'conpty' } } : {}),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // 终端输出中的 URL 可点击，交给系统浏览器打开。
    const links = new WebLinksAddon((event, uri) => {
      event.preventDefault?.();
      void openExternal(uri).catch(() => {});
    });
    term.loadAddon(links);
    term.open(host);

    let current;
    let frame = 0;
    let disposed = false;
    let started = false;
    const isCurrent = (session) => !disposed && current === session;
    const dimensions = () => ({ cols: term.cols, rows: term.rows });
    const close = (session) => invoke('terminal_close', { id: session.id });
    const fail = (error, state = 'error') => setStatus({ state, error: String(error?.message || error) });

    const sendSize = async (session) => {
      if (!session.ready || session.resizing || session.stopping || !isCurrent(session)) return;
      const { cols, rows } = dimensions();
      const key = `${cols}:${rows}`;
      if (session.size === key) return;
      session.size = key;
      session.resizing = true;
      try { await invoke('terminal_resize', { id: session.id, cols, rows }); }
      catch { /* The shell may exit while the window is resizing. */ }
      finally {
        session.resizing = false;
        void sendSize(session);
      }
    };
    const fitToHost = () => {
      if (!host.clientHeight || !host.clientWidth) return;
      fit.fit();
      if (current) void sendSize(current);
    };

    const start = () => {
      if (disposed || current) return;
      started = true;
      fitToHost();
      term.reset();
      const { cols, rows } = dimensions();
      const session = { id: crypto.randomUUID(), size: `${cols}:${rows}`, input: '' };
      current = session;
      // ConPTY may query the cursor before the start request returns. Let xterm
      // answer and hold that data until the native input pipe is ready.
      term.options.disableStdin = false;
      setStatus({ state: 'starting' });
      const events = new Channel();
      events.onmessage = (event) => {
        if (!isCurrent(session)) return;
        if (event.kind === 'data') term.write(Uint8Array.from(event.bytes));
        if (event.kind === 'exit') {
          current = null;
          term.options.disableStdin = true;
          setStatus({ state: 'exited', code: event.code });
        }
      };
      invoke('terminal_start', { id: session.id, cwd: directory, cols, rows, events }).then(() => {
        if (!isCurrent(session)) { void close(session).catch(() => {}); return; }
        session.ready = true;
        setStatus({ state: 'running' });
        void sendSize(session);
        void write(session);
      }, (error) => {
        if (!isCurrent(session)) return;
        current = null;
        term.options.disableStdin = true;
        fail(error);
      });
    };

    const write = async (session) => {
      if (session.writing || session.stopping || !session.ready || !isCurrent(session) || !session.input) return;
      session.writing = true;
      const data = session.input;
      session.input = '';
      try { await invoke('terminal_write', { id: session.id, data }); }
      catch (error) { if (isCurrent(session) && !session.stopping) fail(error, 'running'); }
      finally { session.writing = false; void write(session); }
    };
    const inputs = term.onData((data) => {
      if (!current || current.stopping) return;
      current.input += data;
      void write(current);
    });
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !(event.ctrlKey || event.metaKey) || event.altKey) return true;
      const key = event.key.toLowerCase();
      if (key === 'c' && (event.shiftKey || term.hasSelection())) {
        event.preventDefault();
        if (term.hasSelection()) void navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
        return false;
      }
      if (key === 'v' && event.shiftKey && navigator.clipboard) {
        event.preventDefault();
        void navigator.clipboard.readText().then((text) => term.paste(text), () => {});
        return false;
      }
      return true;
    });

    const schedule = () => {
      if (!frame) frame = win.requestAnimationFrame(() => {
        frame = 0;
        fitToHost();
      });
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(host);
    engineRef.current = {
      activate() { if (!started) start(); fitToHost(); term.focus(); },
      theme() { term.options.theme = terminalTheme(host); },
      start() { start(); term.focus(); },
      clear() { term.clear(); term.focus(); },
      stop() {
        const session = current;
        if (!session?.ready || session.stopping) return;
        session.stopping = true;
        term.options.disableStdin = true;
        setStatus({ state: 'stopping' });
        void close(session).catch((error) => {
          if (!isCurrent(session)) return;
          session.stopping = false;
          term.options.disableStdin = false;
          fail(error, 'running');
        });
      },
    };
    return () => {
      disposed = true;
      if (current?.ready) void close(current).catch(() => {});
      if (frame) win.cancelAnimationFrame(frame);
      resize.disconnect();
      inputs.dispose();
      links.dispose();
      term.dispose();
      engineRef.current = null;
    };
  }, [directory]);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => engineRef.current?.activate());
    return () => cancelAnimationFrame(frame);
  }, [active]);
  useEffect(() => { engineRef.current?.theme(); }, [theme]);

  const canStart = status.state === 'exited' || status.state === 'error';
  return <div className="integrated-terminal" id={active ? 'terminal-panel' : undefined} role="tabpanel" aria-labelledby="terminal-tab" hidden={!active}>
    <div className="integrated-terminal__host" ref={hostRef} />
    <footer className="integrated-terminal__tools">
      <span role="status" title={status.error || directory}>{status.error || t(`terminal.${status.state}`, { code: status.code ?? '—' })}</span>
      <button type="button" onClick={() => engineRef.current?.clear()}>{t('console.clear')}</button>
      {canStart ? <button type="button" onClick={() => engineRef.current?.start()}>{t('terminal.new')}</button>
        : <button type="button" disabled={status.state !== 'running'} onClick={() => engineRef.current?.stop()}>{t('terminal.stop')}</button>}
    </footer>
  </div>;
}
