import { beforeEach, describe, expect, it } from 'vitest';
import {
  formatSnapshotFileName,
  trimCommonIndent,
} from './snapshotCapture';
import {
  SNAPSHOT_BACKDROPS,
  backdropCssGradient,
  computeIndentRainbowWidths,
  formatLanguageLabel,
  normalizeSnapshotLanguage,
} from './snapshotExport';
import useSnapshotStore, {
  DEFAULT_QUICK_SNAPSHOT_PREFS,
  DEFAULT_SNAPSHOT_PREFS,
} from '@store/useSnapshotStore';

describe('snapshotCapture helpers', () => {
  beforeEach(() => {
    useSnapshotStore.setState({
      open: false,
      payload: null,
      ...DEFAULT_SNAPSHOT_PREFS,
      quick: { ...DEFAULT_QUICK_SNAPSHOT_PREFS },
    });
  });

  it('trims shared leading indentation while preserving relative nesting', () => {
    const input = '    function hello() {\n      return 42;\n    }';
    expect(trimCommonIndent(input)).toBe('function hello() {\n  return 42;\n}');
  });

  it('keeps lines untouched when any non-empty line starts at column 0', () => {
    const input = 'const a = 1;\n  const b = 2;';
    expect(trimCommonIndent(input)).toBe(input);
  });

  it('computes indent rainbow widths including blank-line propagation', () => {
    const widths = computeIndentRainbowWidths(
      ['function test() {', '  if (ok) {', '', '    return 1;', '  }', '}'],
      2,
    );
    expect(widths).toEqual([0, 2, 4, 4, 2, 0]);
  });

  it('generates clean PNG filenames from document names', () => {
    expect(formatSnapshotFileName('C:\\repo\\src\\App.jsx')).toBe('App-snapshot.png');
    expect(formatSnapshotFileName('notes/my:doc?.md')).toBe('my-doc-snapshot.png');
    expect(formatSnapshotFileName('')).toBe('mokidown-snapshot.png');
  });

  it('normalizes language aliases and display names', () => {
    expect(normalizeSnapshotLanguage('js')).toBe('javascript');
    expect(normalizeSnapshotLanguage('tsx')).toBe('typescript');
    expect(formatLanguageLabel('py')).toBe('Python');
    expect(formatLanguageLabel('md')).toBe('Markdown');
  });

  it('builds gradients for colored backdrops', () => {
    for (const preset of SNAPSHOT_BACKDROPS) {
      const light = backdropCssGradient(preset.id, false);
      const dark = backdropCssGradient(preset.id, true);
      if (preset.id === 'transparent' || preset.id === 'none') {
        expect(light).toBe('none');
        expect(dark).toBe('none');
      } else {
        expect(light).toMatch(/^linear-gradient\(/);
        expect(dark).toMatch(/^linear-gradient\(/);
      }
    }
  });

  it('stores snapshot payload, studio prefs, and quick snapshot prefs independently', () => {
    useSnapshotStore.getState().openSnapshot({
      mode: 'code',
      content: 'const x = 1;',
      language: 'javascript',
      fileName: 'demo.js',
      startLine: 12,
      isSelection: true,
    });
    const state = useSnapshotStore.getState();
    expect(state.open).toBe(true);
    expect(state.payload).toMatchObject({
      mode: 'code',
      content: 'const x = 1;',
      language: 'javascript',
      fileName: 'demo.js',
      startLine: 12,
      isSelection: true,
    });
    state.setPref('backdrop', 'starlight');
    state.setPref('showFileName', false);
    state.setPref('showFileType', false);
    state.setPref('showIndentRainbow', false);
    state.setPref('useAppBackground', true);
    state.setPref('scale', 3);
    expect(useSnapshotStore.getState().backdrop).toBe('starlight');
    expect(useSnapshotStore.getState().showFileName).toBe(false);
    expect(useSnapshotStore.getState().showFileType).toBe(false);
    expect(useSnapshotStore.getState().showIndentRainbow).toBe(false);
    expect(useSnapshotStore.getState().useAppBackground).toBe(true);
    expect(useSnapshotStore.getState().scale).toBe(3);

    // Quick snapshot preferences stay independent from Studio preferences.
    expect(useSnapshotStore.getState().quick.backdrop).toBe('vitality');
    state.setQuickPref('backdrop', 'mint');
    state.setQuickPref('quickAction', 'save');
    state.setQuickPref('useAppBackground', true);
    expect(useSnapshotStore.getState().quick.backdrop).toBe('mint');
    expect(useSnapshotStore.getState().quick.quickAction).toBe('save');
    expect(useSnapshotStore.getState().quick.useAppBackground).toBe(true);

    state.resetPrefs();
    expect(useSnapshotStore.getState().backdrop).toBe(DEFAULT_SNAPSHOT_PREFS.backdrop);
    expect(useSnapshotStore.getState().quick.backdrop).toBe('mint');

    state.setQuickPref('showIndentMarkers', true);
    state.closeSnapshot();
    state.openSnapshot({ content: '\tconst x = 1;' });
    expect(useSnapshotStore.getState().backdrop).toBe('mint');
    expect(useSnapshotStore.getState().showIndentMarkers).toBe(true);
    state.setPref('showIndentRainbow', false);
    expect(useSnapshotStore.getState().showIndentMarkers).toBe(true);

    state.resetQuickPrefs();
    expect(useSnapshotStore.getState().quick).toEqual(DEFAULT_QUICK_SNAPSHOT_PREFS);

    state.closeSnapshot();
    expect(useSnapshotStore.getState().open).toBe(false);
  });
});
