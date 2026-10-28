import AppDialog from './AppDialog';
import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Select, Switch, Tooltip, message } from 'antd';
import { ArrowLeftOutlined, CheckOutlined, CloudDownloadOutlined, PlusOutlined, ReloadOutlined,
  SearchOutlined, StopOutlined, DeleteOutlined, GlobalOutlined, LinkOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import useLspStore, { availablePlugins, selectLanguagePlugin } from '@store/useLspStore';
import useExtensionStore, { OFFICIAL_EXTENSIONS } from '@store/useExtensionStore';
import { openExternal } from '@utils/tauriApi';
import { getMaterialIcons, loadMaterialIcons } from '@utils/materialIcons';
import TaskRing from '@components/ui/TaskRing';
import ExtensionSettings from './ExtensionSettings';
import PluginDeveloperTools from './PluginDeveloperTools';
// JavaScript / TypeScript 使用网上获取的官方品牌图标（devicon，MIT License）：
// https://github.com/devicons/devicon
import javascriptLogo from '@/assets/devicon/javascript-original.svg';
import typescriptLogo from '@/assets/devicon/typescript-original.svg';
import './language-services.scss';

const BUSY = new Set(['preparing', 'downloading', 'extracting', 'installing', 'uninstalling']);
const example = JSON.stringify({ id: 'community.bash', name: 'Bash Language Server', publisher: 'Community',
  version: 'latest', description: 'Language intelligence for shell scripts', languages: ['shell'], extensions: { sh: 'shell' },
  args: ['start'], install: { kind: 'npm', packages: ['bash-language-server'], executable: 'bash-language-server' } }, null, 2);
const localize = (plugin, field, language) => language.startsWith('zh') && plugin[`${field}Zh`] ? plugin[`${field}Zh`] : plugin[field];

// 语言标识 → react-material-vscode-icons 组件的映射。自定义插件声明的语言
// 命中映射时同样使用品牌图标；未命中则回退到原有的字母徽标。
const LANGUAGE_ICONS = {
  javascript: 'Javascript', typescript: 'Typescript', html: 'Html', css: 'Css', scss: 'Sass', less: 'Less',
  python: 'Python', csharp: 'Csharp', kotlin: 'Kotlin', java: 'Java', rust: 'Rust', go: 'Go', ruby: 'Ruby',
  php: 'Php', c: 'C', cpp: 'Cpp', swift: 'Swift', lua: 'Lua', json: 'Json', yaml: 'Yaml', xml: 'Xml',
  sql: 'Database', markdown: 'Markdown', vue: 'Vue', svelte: 'Svelte', zig: 'Zig', dart: 'Dart', scala: 'Scala',
  r: 'R', powershell: 'Powershell', shell: 'Console', ini: 'Settings', toml: 'Toml', dockerfile: 'Docker',
};
// JavaScript 与 TypeScript 没有单独的联合图标，采用官方品牌图标各占一半、
// 并排等大（JS 居左、TS 居右），共同代表二者。
const TS_JS = 'TS_JS';


/**
 * 解析插件应使用的图标组件名。
 *
 * @param {object} plugin 插件清单。
 * @returns {string|null} 图标组件名，或 TS_JS 联合图标标记；无匹配时返回 null。
 */
function iconName(plugin) {
  const languages = plugin.languages || [];
  if (plugin.id === 'mde.typescript' || (languages.includes('javascript') && languages.includes('typescript'))) {
    return TS_JS;
  }
  const mapped = languages.find((language) => LANGUAGE_ICONS[language]);
  return mapped ? LANGUAGE_ICONS[mapped] : null;
}


export default function LanguageServices() {
  const { t, i18n } = useTranslation();
  const state = useLspStore();
  const extState = useExtensionStore();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [selectedExtId, setSelectedExtId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState('source');
  const [source, setSource] = useState('');
  const [manifestText, setManifestText] = useState(example);
  const [addBusy, setAddBusy] = useState(false);
  const [showAccelerator, setShowAccelerator] = useState(false);
  const [error, setError] = useState('');
  const [iconModule, setIconModule] = useState(() => getMaterialIcons());
  const desktop = Boolean(window.__TAURI_INTERNALS__) && !window.AndroidBridge;
  const plugins = useMemo(() => availablePlugins(state), [state]);
  const installedIds = new Set(state.installed.map((plugin) => plugin.manifest.id));
  const filtered = plugins.filter((plugin) => {
    const text = `${plugin.name} ${plugin.publisher} ${plugin.languages.join(' ')} ${plugin.description} ${plugin.descriptionZh || ''}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });
  const selected = plugins.find((plugin) => plugin.id === selectedId);
  const officialIds = new Set(OFFICIAL_EXTENSIONS.map((entry) => entry.id));
  const extensionCards = [
    ...OFFICIAL_EXTENSIONS.map((descriptor) => ({
      descriptor,
      entry: extState.installed.find((entry) => entry.package.id === descriptor.id)
        || { package: descriptor, enabled: false, settings: {} },
      official: true,
    })),
    ...extState.installed
      .filter((entry) => !officialIds.has(entry.package.id))
      .map((entry) => ({ descriptor: entry.package, entry, official: false })),
    ...extState.catalog
      .filter((item) => !officialIds.has(item.id) && !extState.installed.some((entry) => entry.package.id === item.id))
      .map((item) => ({ descriptor: item, entry: null, official: false, catalogItem: true })),
  ].filter((card) => {
    const text = `${card.descriptor.name} ${card.descriptor.description || ''} ${card.descriptor.descriptionZh || ''}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });
  const selectedExt = extensionCards.find((card) => card.descriptor.id === selectedExtId);
  useEffect(() => { useLspStore.getState().refresh(); }, []);
  useEffect(() => {
    // 品牌图标模块与文件树共用同一个缓存加载器，加载完成前回退字母徽标。
    if (getMaterialIcons()) return undefined;
    let active = true;
    loadMaterialIcons().then((module) => { if (active) setIconModule(module); });
    return () => { active = false; };
  }, []);
  async function act(action) {
    setError('');
    try { await action(); } catch (error) { setError(String(error?.message || error)); }
  }
  async function add() {
    setAddBusy(true); setError('');
    try {
      if (addMode === 'source') await state.addCatalog(source.trim());
      else state.addManifest(JSON.parse(manifestText));
      setAdding(false);
    } catch (error) { setError(String(error?.message || error)); }
    finally { setAddBusy(false); }
  }
  function actions(plugin, detail = false) {
    const installed = state.installed.find((entry) => entry.manifest.id === plugin.id);
    const operation = state.operations[plugin.id];
    if (BUSY.has(operation?.phase)) return <div className="language-services__actions">
      <span className="language-services__working">
        <TaskRing progress={operation.percent ?? undefined} />
        {t(`languageServices.phase.${operation.phase}`)}
        {operation.percent != null && ` ${operation.percent}%`}</span>
      {operation.phase !== 'uninstalling' && <Button size="small" type="text" onClick={() => act(() => state.cancelInstall(plugin.id))}>{t('languageServices.cancel')}</Button>}
    </div>;
    if (!installed) return <Button size="small" icon={<CloudDownloadOutlined />} disabled={!desktop}
      onClick={() => state.install(plugin)}>{t(operation?.phase === 'error' ? 'languageServices.retry' : 'languageServices.install')}</Button>;
    return <div className="language-services__actions">
      <Button size="small" icon={installed.enabled ? <StopOutlined /> : <CheckOutlined />} disabled={!desktop}
        onClick={() => act(() => state.togglePlugin(plugin.id, !installed.enabled))}>
        {t(installed.enabled ? 'languageServices.disable' : 'languageServices.enable')}
      </Button>
      {detail && <Button size="small" danger icon={<DeleteOutlined />} onClick={() => state.uninstall(plugin.id)} disabled={!desktop}>{t('languageServices.uninstall')}</Button>}
    </div>;
  }
  function icon(plugin, large = false) {
    const cls = `language-services__icon${large ? ' language-services__icon--large' : ''}`;
    const name = iconName(plugin);
    // JavaScript 与 TypeScript 各占一半、并排等大：JS 居左、TS 居右，使用
    // 网上获取的官方品牌图标，不依赖惰性图标模块，加载即显示。
    if (name === TS_JS) {
      return <span className={`${cls} language-services__icon--combo`} aria-hidden="true">
        <img src={javascriptLogo} width={large ? 19 : 15} height={large ? 19 : 15} alt="" draggable={false} />
        <img src={typescriptLogo} width={large ? 19 : 15} height={large ? 19 : 15} alt="" draggable={false} />
      </span>;
    }
    if (iconModule && name) {
      const IconComponent = iconModule[name];
      return <span className={`${cls} language-services__icon--brand`} aria-hidden="true">
        <IconComponent width={large ? 30 : 22} height={large ? 30 : 22} />
      </span>;
    }
    return <span className={cls}
      style={{ '--plugin-color': plugin.color || 'var(--accent)' }} aria-hidden="true">{plugin.icon || plugin.name.slice(0, 2)}</span>;
  }
  function status(plugin) {
    const installed = state.installed.find((entry) => entry.manifest.id === plugin.id);
    if (!installed) return null;
    const running = state.statuses[plugin.id];
    return <span className={`language-services__status ${running?.status === 'error' ? 'is-error' : installed.enabled ? 'is-enabled' : ''}`}>
      <i />{t(!installed.enabled ? 'languageServices.disabled' : running?.status === 'ready' ? 'languageServices.connected'
        : running?.status === 'error' ? 'languageServices.connectionError' : 'languageServices.installed')}
    </span>;
  }
  return <section className="language-services" aria-label={t('settings.nav.languages')}>
    {!selectedExt && (
      <div className="language-services__heading">
        <div><h3>{t('languageServices.title')}</h3><p>{t('languageServices.subtitle')}</p></div>
        <Switch size="small" checked={state.enabled} onChange={state.setEnabled} aria-label={t('languageServices.enabled')} />
      </div>
    )}
    {!desktop && <div className="language-services__notice">{t('languageServices.desktopOnly')}</div>}
    {(error || state.loadError) && !adding && <div role="alert" className="language-services__error">{error || state.loadError}</div>}
    {selectedExt ? <div className="language-services__detail">
      <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => setSelectedExtId(null)}>{t('languageServices.back')}</Button>
      <div className="language-services__detail-heading">
        <span className="language-services__icon language-services__icon--large" aria-hidden="true">{(selectedExt.descriptor.name || '?').slice(0, 2)}</span>
        <div><h4>{selectedExt.descriptor.name}</h4>
          <p>{t('extensions.servicePluginLabel')} · v{selectedExt.entry?.package?.version || selectedExt.descriptor.version || '1.0.0'}</p></div>
      </div>
      <p className="language-services__detail-description">{(() => {
        // Description comes from the installed plugin package first; the
        // catalog entry is only a fallback for the pre-install view.
        const pkg = selectedExt.entry?.package || selectedExt.descriptor;
        return i18n.language.startsWith('zh')
          ? pkg.descriptionZh || pkg.description
          : pkg.description || pkg.descriptionZh;
      })()}</p>
      {selectedExt.catalogItem
        ? <Button disabled={!desktop} onClick={() => act(() => extState.installFromCatalog(selectedExt.descriptor))}>{t('extensions.install')}</Button>
        : <>
          <div className="language-services__detail-actions">
            <span>{t(selectedExt.entry?.enabled ? 'extensions.enabled' : 'extensions.disabled')}</span>
            <Switch disabled={!desktop} checked={Boolean(selectedExt.entry?.enabled)} onChange={(value) => act(async () => {
              if (value) await extState.ensureInstalled(selectedExt.descriptor.id);
              extState.toggle(selectedExt.descriptor.id, value);
            })} />
            {!selectedExt.official && <Button size="small" danger disabled={!desktop} onClick={() => act(() => extState.uninstall(selectedExt.descriptor.id))}>{t('extensions.uninstall')}</Button>}
          </div>
          <ExtensionSettings key={selectedExt.descriptor.id} entry={selectedExt.entry} act={act} />
          {extState.runtimeErrors[selectedExt.descriptor.id] && <p role="alert">{extState.runtimeErrors[selectedExt.descriptor.id]}</p>}
        </>}
      {(extState.error || error) && <p className="language-services__error" role="alert">{extState.error || error}</p>}
    </div> : !selected ? <>
      <div className="language-services__search">
        <Input prefix={<SearchOutlined />} allowClear placeholder={t('languageServices.search')} value={query}
          onChange={(event) => setQuery(event.target.value)} aria-label={t('languageServices.search')} />
        <Tooltip title={t('languageServices.addPlugin')} placement="top" mouseEnterDelay={0.3}>
          <Button icon={<PlusOutlined />} aria-label={t('languageServices.addPlugin')}
            onClick={() => { setError(''); setAdding(true); }} disabled={!desktop} />
        </Tooltip>
        <Tooltip title={t('languageServices.refresh')} placement="top" mouseEnterDelay={0.3}>
          <Button icon={<ReloadOutlined />} aria-label={t('languageServices.refresh')}
            loading={state.loading} disabled={!desktop} onClick={() => act(async () => {
              for (const url of state.sources) await state.addCatalog(url);
              await state.refresh();
            })} />
        </Tooltip>
        <Tooltip title={t('extensions.checkUpdates')} placement="top" mouseEnterDelay={0.3}>
          <Button icon={<CloudDownloadOutlined />} aria-label={t('extensions.checkUpdates')} disabled={!desktop}
            onClick={async () => {
              const updates = await extState.checkUpdates();
              if (!updates.length) message.success(t('extensions.upToDate'));
            }} />
        </Tooltip>
        <Tooltip title={t('languageServices.accelerator')} placement="top" mouseEnterDelay={0.3}>
          <Button icon={<LinkOutlined />} aria-label={t('languageServices.accelerator')}
            className={state.githubAccelerator ? 'is-active' : ''} disabled={!desktop}
            onClick={() => setShowAccelerator((visible) => !visible)} />
        </Tooltip>
      </div>
      {showAccelerator && (
        <div className="language-services__accelerator">
          <Input allowClear value={state.githubAccelerator}
            placeholder={t('languageServices.acceleratorPlaceholder')}
            aria-label={t('languageServices.accelerator')}
            onChange={(event) => state.setGithubAccelerator(event.target.value)} />
          <p>{t('languageServices.acceleratorHint')}</p>
        </div>
      )}
      <PluginDeveloperTools desktop={desktop} />
      <div className="language-services__list">
        {filtered.map((plugin) => <article key={plugin.id} className="language-services__card">
          <button className="language-services__summary" type="button" onClick={() => setSelectedId(plugin.id)}>
            {icon(plugin)}<span className="language-services__summary-content">
              <strong>{plugin.name}</strong><span className="language-services__description">{localize(plugin, 'description', i18n.language)}</span>
              <span className="language-services__meta">{plugin.publisher}{status(plugin)}</span>
            </span>
          </button>
          <div className="language-services__card-bottom"><span className="language-services__languages">{plugin.languages.join(' · ')}</span>{actions(plugin)}</div>
          {state.operations[plugin.id]?.phase === 'error' && <p className="language-services__error" role="alert">{state.operations[plugin.id].text}</p>}
        </article>)}
        {extensionCards.map(({ descriptor, entry, catalogItem }) => <article key={descriptor.id} className="language-services__card">
          <button className="language-services__summary" type="button" onClick={() => setSelectedExtId(descriptor.id)}>
            <span className="language-services__icon" aria-hidden="true">{(descriptor.name || '?').slice(0, 2)}</span>
            <span className="language-services__summary-content">
              <strong>{descriptor.name}</strong>
              <span className="language-services__description">{i18n.language.startsWith('zh') ? descriptor.descriptionZh || descriptor.description : descriptor.description || descriptor.descriptionZh}</span>
              <span className="language-services__meta">{t('extensions.servicePluginLabel')}{entry?.package?.version ? ` · v${entry.package.version}` : ''}</span>
            </span>
          </button>
          <div className="language-services__card-bottom">
            <span className="language-services__languages">{catalogItem ? t('extensions.notInstalled') : t('extensions.servicePluginLabel')}</span>
            {catalogItem
              ? <Button size="small" icon={<CloudDownloadOutlined />} disabled={!desktop} onClick={() => act(() => extState.installFromCatalog(descriptor))}>{t('extensions.install')}</Button>
              : <Button size="small" icon={entry?.enabled ? <StopOutlined /> : <CheckOutlined />} disabled={!desktop} onClick={() => act(async () => {
                const next = !entry?.enabled;
                if (next) await extState.ensureInstalled(descriptor.id);
                extState.toggle(descriptor.id, next);
              })}>{t(entry?.enabled ? 'languageServices.disable' : 'languageServices.enable')}</Button>}
          </div>
        </article>)}
        {!filtered.length && !extensionCards.length && <div className="language-services__empty"><SearchOutlined /><p>{t(query ? 'languageServices.noResults' : 'languageServices.noInstalled')}</p></div>}
      </div>
    </> : <div className="language-services__detail">
      <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => setSelectedId(null)}>{t('languageServices.back')}</Button>
      <div className="language-services__detail-heading">{icon(selected, true)}<div><h4>{selected.name}</h4><p>{selected.publisher}</p>{status(selected)}</div></div>
      <div className="language-services__detail-actions">{actions(selected, true)}
        {installedIds.has(selected.id) && <Button type="text" size="small" icon={<ReloadOutlined />} onClick={state.restart}>{t('languageServices.restart')}</Button>}
      </div>
      <p className="language-services__detail-description">{localize(selected, 'description', i18n.language)}</p>
      <dl>
        <div><dt>{t('languageServices.languages')}</dt><dd>{selected.languages.join(', ')}</dd></div>
        <div><dt>{t('languageServices.version')}</dt><dd>{state.installed.find((plugin) => plugin.manifest.id === selected.id)?.installedVersion || selected.version}</dd></div>
        <div><dt>{t('languageServices.requires')}</dt><dd>{localize(selected, 'requirements', i18n.language) || '—'}</dd></div>
      </dl>
      {selected.homepage && <Button type="link" size="small" icon={<LinkOutlined />} onClick={() => act(() => openExternal(selected.homepage))}>{t('languageServices.homepage')}</Button>}
      {state.installed.find((plugin) => plugin.manifest.id === selected.id)?.enabled && selected.languages.map((language) => {
        const candidates = state.installed.filter((plugin) => plugin.enabled && plugin.manifest.languages.includes(language));
        if (candidates.length < 2) return null;
        return <div className="language-services__provider" key={language}><label>{language}</label>
          <Select value={selectLanguagePlugin(state, language)?.manifest.id} options={candidates.map((plugin) => ({ value: plugin.manifest.id, label: plugin.manifest.name }))}
            onChange={(id) => state.setPreferred(language, id)} aria-label={t('languageServices.provider', { language })} /></div>;
      })}
      {(state.operations[selected.id]?.text || state.statuses[selected.id]?.message) && <pre className="language-services__log" role="status">
        {state.operations[selected.id]?.text || state.statuses[selected.id]?.message}
      </pre>}
    </div>}
    <AppDialog open={adding} title={t('languageServices.addPlugin')} onCancel={() => setAdding(false)}
      onOk={add} okText={t('languageServices.addPlugin')} cancelText={t('languageServices.cancel')} confirmLoading={addBusy} width={560}>
      <div className="language-services__add">
        <Select value={addMode} onChange={setAddMode} options={[
          { value: 'source', label: t('languageServices.source') }, { value: 'manifest', label: t('languageServices.manifest') },
        ]} />
        {addMode === 'source' ? <><p>{t('languageServices.sourceHint')}</p><Input prefix={<GlobalOutlined />} value={source}
          onChange={(event) => setSource(event.target.value)} placeholder="https://…/catalog.json" aria-label={t('languageServices.source')} /></>
          : <><p>{t('languageServices.manifestHint')}</p><Input.TextArea value={manifestText} onChange={(event) => setManifestText(event.target.value)} rows={12} aria-label={t('languageServices.manifest')} /></>}
        {error && <p className="language-services__error" role="alert">{error}</p>}
      </div>
    </AppDialog>
  </section>;
}
