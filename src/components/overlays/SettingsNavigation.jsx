import { useEffect, useRef } from 'react';
import { Input, Tooltip } from 'antd';
import { CloseOutlined, SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { ExplorerIcon } from '@components/layout/sidebar/explorer/ExplorerNavigation';
import SearchHighlight from '@components/ui/SearchHighlight';

/**
 * 设置导航。指示块在圆形图标按钮之间滑动。
 *
 * @param {object} props 组件属性。
 * @returns {JSX.Element} 设置导航。
 */
export default function SettingsNavigation({
  items,
  active,
  onSelect,
  searching,
  onSearch,
  onCloseSearch,
  query,
  onQuery,
  onSearchKeys,
  matchIndex,
  matchCount,
  onMoveMatch,
  results = [],
  onSelectResult,
}) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const searchButton = useRef(null);
  const wasSearching = useRef(false);
  const selected = items.findIndex(({ key }) => key === active) + 1;
  const indicator = searching ? 0 : selected;

  useEffect(() => {
    if (searching) inputRef.current?.focus();
    else if (wasSearching.current) searchButton.current?.focus();
    wasSearching.current = searching;
  }, [searching]);

  return (
    <nav
      className={`settings-nav${searching ? ' settings-nav--searching' : ''}`}
      data-searching={searching}
      aria-label={t('settings.navigation')}
    >
      <div
        className="settings-nav__buttons"
        style={{ '--settings-nav-slot-count': items.length + 1, '--settings-nav-slot-index': indicator }}
        inert={searching ? '' : undefined}
        aria-hidden={searching || undefined}
      >
        <span className="settings-nav__indicator" aria-hidden="true" />
        <Tooltip title={t('settings.search')} placement="bottom" mouseEnterDelay={0.35}>
          <button
            ref={searchButton}
            type="button"
            className="settings-nav__button settings-nav__button--search"
            aria-label={t('settings.search')}
            aria-expanded={searching}
            data-highlighted={indicator === 0}
            onClick={onSearch}
          >
            <SearchOutlined />
          </button>
        </Tooltip>
        {items.map(({ key, label, icon, tooltip }) => (
          <Tooltip key={key} title={tooltip || label} placement="bottom" mouseEnterDelay={0.35}>
            <button
              type="button"
              className="settings-nav__button"
              aria-label={label}
              aria-pressed={key === active}
              data-highlighted={!searching && active === key}
              onClick={() => onSelect(key)}
            >
              {icon}
            </button>
          </Tooltip>
        ))}
      </div>
      <div
        className="settings-nav__search"
        inert={searching ? undefined : ''}
        aria-hidden={!searching || undefined}
      >
        <Input
          ref={inputRef}
          variant="borderless"
          aria-label={t('settings.search')}
          placeholder={t('settings.search')}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
              event.stopPropagation();
              onCloseSearch();
            } else onSearchKeys(event);
          }}
        />
        <span
          className="settings-nav__count"
          role="status"
          aria-live="polite"
          aria-label={query.trim() && !matchCount ? t('settings.noSearchResults') : undefined}
        >
          {query.trim() ? `${matchIndex + 1}/${matchCount}` : ''}
        </span>
        {[
          ['previous', -1],
          ['next', 1],
        ].map(([name, step]) => {
          const title = t(`sidebar.project.${name}Match`);
          return (
            <Tooltip key={name} title={title} placement="bottom" mouseEnterDelay={0.3}>
              <button
                type="button"
                className="settings-nav__icon-button"
                aria-label={title}
                disabled={!matchCount}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onMoveMatch(step)}
              >
                <ExplorerIcon name={name} />
              </button>
            </Tooltip>
          );
        })}
        <Tooltip title={t('settings.closeSearch')} placement="bottom" mouseEnterDelay={0.3}>
          <button
            type="button"
            className="settings-nav__icon-button"
            aria-label={t('settings.closeSearch')}
            onClick={onCloseSearch}
          >
            <CloseOutlined aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
      {searching && results.length > 0 && (
        <div className="settings-nav__results" role="listbox">
          {results.slice(0, 8).map((item, index) => (
            <button
              key={item.key || `${item.section}-${index}`}
              type="button"
              role="option"
              aria-selected={index === matchIndex}
              className="settings-nav__result"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelectResult?.(index)}
            >
              <span>
                <SearchHighlight text={item.label} query={query} />
              </span>
              <small>{t(`settings.nav.${item.section}`)}</small>
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
