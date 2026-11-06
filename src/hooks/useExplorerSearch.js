import { useCallback, useEffect, useRef, useState } from 'react';
import { searchExplorerNames } from '@/services/explorerSearch';

export default function useExplorerSearch({ root, recursive, onMatch, version }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [state, setState] = useState({ results: [], index: 0, loading: false, error: '', truncated: false });
  const reveal = useRef(onMatch);
  reveal.current = onMatch;
  const operation = useRef(0);
  const invalidateSelection = useCallback(() => { operation.current++; }, []);
  const select = useCallback(async (item) => {
    const request = ++operation.current;
    try { await reveal.current?.(item, () => request === operation.current); }
    catch (error) { if (request === operation.current) setState((old) => ({ ...old, error: String(error) })); }
  }, []);
  useEffect(() => {
    operation.current++;
    if (!open || !root || !query.trim()) {
      setState({ results: [], index: 0, loading: false, error: '', truncated: false });
      return undefined;
    }
    let active = true, task;
    setState({ results: [], index: 0, loading: true, error: '', truncated: false });
    const timer = setTimeout(() => {
      task = searchExplorerNames(root, query.trim(), { caseSensitive, recursive });
      void task.promise.then((result) => {
        if (!active) return;
        setState({ ...result, index: 0, loading: false, error: '' });
        if (result.results[0]) void select(result.results[0]);
      }).catch((error) => { if (active) setState({ results: [], index: 0, loading: false, error: String(error) }); });
    }, 180);
    return () => { active = false; invalidateSelection(); clearTimeout(timer); task?.cancel(); };
  }, [root, query, open, caseSensitive, recursive, version, select, invalidateSelection]);
  const move = (delta) => {
    if (!state.results.length) return;
    const index = (state.index + delta + state.results.length) % state.results.length;
    setState((old) => ({ ...old, index }));
    void select(state.results[index]);
  };
  return { ...state, open, query, setQuery, caseSensitive, setCaseSensitive, toggle: () => setOpen((value) => !value), move };
}
