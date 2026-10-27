import { useEffect, useMemo, useState } from 'react';
import useEditorStore from '@store/useEditorStore';
import { getBuffer, subscribe } from '@utils/editorBuffer';
import { readFileContent } from '@utils/tauriApi';
import { resolveMarkdownAssetPath } from '@utils/markdownAssets';
import { companionTreePaths, markdownFences, treeReference } from '@utils/knowledgeTree';

export function useKnowledgeTrees(documentPath, source, enabled = true, includeCompanion = true) {
  const tabs = useEditorStore((s) => s.tabs);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState({ key: '', trees: [] });
  useEffect(() => {
    if (!enabled) return undefined;
    const refresh = () => setRevision((n) => n + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [enabled]);
  useEffect(() => subscribe((ids) => {
    if (tabs.some((tab) => /\.mgtree$/i.test(tab.path || '') && ids.has(tab.id))) setRevision((n) => n + 1);
  }), [tabs]);
  const descriptors = useMemo(() => {
    if (!enabled) return [];
    const inline = markdownFences(source).filter((block) => ['tree', 'mgtree'].includes(block.language)).map((block) => {
      const ref = treeReference(block.source);
      return ref ? { key: `ref-${block.line}`, path: resolveMarkdownAssetPath(ref, documentPath), explicit: true }
        : { key: `inline-${block.line}`, source: block.source };
    });
    return [...inline, ...(includeCompanion ? companionTreePaths(documentPath, source).map((path) => ({ key: path, path })) : [])];
  }, [documentPath, source, enabled, includeCompanion]);
  const key = JSON.stringify(descriptors);
  const request = useMemo(() => JSON.parse(key), [key]);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const trees = [];
      const seen = new Set();
      let companionFound = false;
      for (const entry of request) {
        if (entry.path && (seen.has(entry.path) || (!entry.explicit && companionFound))) continue;
        try {
          let actualPath = entry.path;
          const tab = tabs.find((item) => item.path === entry.path);
          let result = entry.path && !tab ? await readFileContent(entry.path) : null;
          // Legacy @tree(name) references also search the sibling trees folder.
          if (entry.explicit && !tab && !result?.success && !/[\\/]trees[\\/]/i.test(entry.path)) {
            const fallback = entry.path.replace(/([^\\/]+)$/, 'trees/$1');
            const fallbackTab = tabs.find((item) => item.path.replace(/\\/g, '/') === fallback.replace(/\\/g, '/'));
            result = fallbackTab ? { success: true, content: getBuffer(fallbackTab.id, fallbackTab.content || '') } : await readFileContent(fallback);
            if (result?.success) actualPath = fallback;
          }
          if (cancelled) return;
          const content = entry.path ? (tab ? getBuffer(tab.id, tab.content || '') : result?.success ? result.content : '') : entry.source;
          if (!content?.trim()) continue;
          if (actualPath && seen.has(actualPath)) continue;
          trees.push({ ...entry, path: actualPath, source: content });
          if (actualPath) seen.add(actualPath);
          if (entry.path && !entry.explicit) companionFound = true;
        } catch { /* Missing companion files are expected. */ }
      }
      if (!cancelled) setLoaded({ key, trees });
    }
    load();
    return () => { cancelled = true; };
  }, [request, key, tabs, revision]);
  return loaded.key === key ? loaded.trees : [];
}
