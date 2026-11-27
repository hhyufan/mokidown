import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const DEFAULT_SNAPSHOT_PREFS = Object.freeze({
  backdrop: 'vitality',
  cardTheme: 'auto',
  padding: 40,
  radius: 14,
  shadow: true,
  windowStyle: 'moki',
  showFileName: true,
  showFileType: true,
  showLineNumbers: true,
  showIndentMarkers: false,
  trimIndent: true,
  showIndentRainbow: true,
  showWatermark: true,
  useAppBackground: false,
  cardWidth: 680,
  scale: 2,
});

export const DEFAULT_QUICK_SNAPSHOT_PREFS = Object.freeze({
  ...DEFAULT_SNAPSHOT_PREFS,
  quickAction: 'copy',
});

function pickStudioPrefs(source) {
  const picked = {};
  for (const key of Object.keys(DEFAULT_SNAPSHOT_PREFS)) {
    if (key in (source || {})) picked[key] = source[key];
  }
  return picked;
}

const useSnapshotStore = create(
  persist(
    (set) => ({
      open: false,
      payload: null,
      ...DEFAULT_SNAPSHOT_PREFS,
      quick: { ...DEFAULT_QUICK_SNAPSHOT_PREFS },

      openSnapshot: (payload) =>
        set((state) => ({
          ...pickStudioPrefs(state.quick),
          open: true,
          payload: {
            tabId: payload?.tabId,
            mode: payload?.mode === 'markdown' ? 'markdown' : 'code',
            content: String(payload?.content || ''),
            selectionHtml: String(payload?.selectionHtml || ''),
            language: String(payload?.language || 'plaintext'),
            fileName: String(payload?.fileName || ''),
            documentPath: String(payload?.documentPath || ''),
            startLine: Math.max(1, Number(payload?.startLine) || 1),
            isSelection: Boolean(payload?.isSelection),
          },
        })),

      closeSnapshot: () => set({ open: false, payload: null }),

      setPref: (key, value) =>
        set((state) => (key in DEFAULT_SNAPSHOT_PREFS ? { ...state, [key]: value } : state)),

      resetPrefs: () => set(DEFAULT_SNAPSHOT_PREFS),

      setQuickPref: (key, value) =>
        set((state) =>
          key in DEFAULT_QUICK_SNAPSHOT_PREFS
            ? { ...state, quick: { ...state.quick, [key]: value } }
            : state,
        ),

      resetQuickPrefs: () => set((state) => ({ ...state, quick: { ...DEFAULT_QUICK_SNAPSHOT_PREFS } })),
    }),
    {
      name: 'mokidown-snapshot-prefs',
      partialize: (state) => ({
        quick: state.quick,
      }),
      merge: (persisted, current) => {
        const source = persisted && typeof persisted === 'object' ? persisted : {};
        const quick = source.quick && typeof source.quick === 'object' ? source.quick : {};
        return {
          ...current,
          quick: {
            ...DEFAULT_QUICK_SNAPSHOT_PREFS,
            ...pickStudioPrefs(quick),
            quickAction: quick.quickAction === 'save' ? 'save' : 'copy',
            showIndentMarkers: quick.showIndentMarkers ?? quick.showWhitespace ?? DEFAULT_SNAPSHOT_PREFS.showIndentMarkers,
          },
        };
      },
    },
  ),
);

export default useSnapshotStore;
