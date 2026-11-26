import { useTranslation } from 'react-i18next';
import { Switch } from 'antd';
import useConfigStore from '@store/useConfigStore';
import useThemeStore from '@store/useThemeStore';

/**
 * Moki 主题与人物设置。
 *
 * 主题切换使用紧凑卡片（两列横卡、底色、右侧勾选），不再显示角色插画。
 * 「人物显示」开关只控制主界面形象，不影响这里的主题切换形态。
 */
export default function MokiSettings({ SettingGroup, SettingRow }) {
  const { t } = useTranslation();
  const config = useConfigStore();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const showCharacter = config.mokiDisplay !== 'hidden';

  return (
    <>
      <SettingGroup label={t('moki.settingsTitle')} />
      <div className="moki-theme-cards moki-theme-cards--compact">
        {['light', 'dark'].map((mode) => (
          <button
            key={mode}
            type="button"
            className={[
              'moki-theme-card',
              'moki-theme-card--compact',
              `moki-theme-card--${mode}`,
            ].join(' ')}
            aria-pressed={theme === mode}
            onClick={() => setTheme(mode)}
          >
            <span className="moki-theme-card__meta">
              <strong>{t(`moki.theme.${mode}`)}</strong>
              <small>{t(`moki.theme.${mode}Desc`)}</small>
            </span>
            <span className="moki-theme-card__check" aria-hidden="true">
              {theme === mode ? '✓' : '○'}
            </span>
          </button>
        ))}
      </div>
      <SettingRow label={t('moki.display')} desc={t('moki.displayDesc')}>
        <Switch
          aria-label={t('moki.display')}
          checked={showCharacter}
          onChange={(value) => config.setConfig('mokiDisplay', value ? 'welcome' : 'hidden')}
        />
      </SettingRow>
    </>
  );
}
