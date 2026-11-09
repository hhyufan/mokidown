import React, { lazy, Suspense, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { StyleProvider } from '@ant-design/cssinjs';
import ThemedConfigProvider from '@/antd/ThemedConfigProvider';
import { preloadMonacoEditor } from '@utils/monacoRuntimeBoot';
import { announceMainWindowReady } from '@utils/startupHandover';
import { installTooltipHygiene } from '@utils/tooltipHygiene';
import { installWebThemeBridge } from '@utils/webThemeBridge';
import './i18n';
import '@styles/index.scss';
import NativeTitleTooltips from '@components/ui/NativeTitleTooltips';
import RuntimeLogHost from '@components/overlays/RuntimeLogDialog';
import RuntimeErrorBoundary from '@components/overlays/RuntimeErrorBoundary';
import { installRuntimeLogging } from '@/services/runtimeLogs';
import '@styles/prism-theme.scss';
import '@styles/antd-overrides.scss';

installWebThemeBridge();
const stopRuntimeLogging = installRuntimeLogging();
if (import.meta.hot) import.meta.hot.dispose(stopRuntimeLogging);
void preloadMonacoEditor().catch((error) => console.error('[Monaco] Startup preload failed:', error));
installTooltipHygiene();

const Root = import.meta.env.DEV ? React.StrictMode : React.Fragment;
const App = lazy(() => import('./App'));

function SplashHandover({ children }) {
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return undefined;
    return announceMainWindowReady(Promise.all([
      preloadMonacoEditor(),
      import('@/services/editorSession').then(({ restoreEditorSession }) => restoreEditorSession()),
    ]));
  }, []);
  return children;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <Root>
    <StyleProvider hashPriority="high">
      <ThemedConfigProvider>
        <NativeTitleTooltips />
        <RuntimeLogHost />
        <RuntimeErrorBoundary root>
          <Suspense fallback={null}>
            <SplashHandover><App skipCliArgs={new URLSearchParams(location.search).has('editor')} /></SplashHandover>
          </Suspense>
        </RuntimeErrorBoundary>
      </ThemedConfigProvider>
    </StyleProvider>
  </Root>
);
