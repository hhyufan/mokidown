import { Component } from 'react';
import { useTranslation } from 'react-i18next';
import { reportReactError, useRuntimeLogStore } from '@/services/runtimeLogs';

function RuntimeFailure({ retry }) {
  const { t } = useTranslation();
  return <section className="runtime-logs__fallback" role="status">
    <p>{t('runtimeLogs.interrupted')}</p>
    <button type="button" onClick={useRuntimeLogStore.getState().show}>{t('runtimeLogs.view')}</button>
    <button type="button" onClick={retry}>{t('runtimeLogs.retry')}</button>
  </section>;
}

export default class RuntimeErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    reportReactError(error, info);
    if (this.props.root) window.__mokiRuntimeLogs?.ready();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <RuntimeFailure retry={() => {
      if (this.props.root) window.location.reload();
      else this.setState({ failed: false });
    }} />;
  }
}
