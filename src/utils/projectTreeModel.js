// Sparse visible-tree index: expanding a folder adds a segment, never an array
// entry for every descendant. A ten-million-file directory remains one segment.
export const PROJECT_CACHE_PAGES = 16;
import { explorerPathKey, parentDirectory } from './explorerPaths';

export class ProjectTreeModel {
  constructor({ root, items = [], source, loading = false, openDirectory, onChange }) {
    this.onChange = onChange;
    this.openDirectory = openDirectory;
    this.pages = new Map();
    this.inFlight = new Set();
    this.wanted = new Map();
    this.failures = new Map();
    this.empties = new Set();
    this.directoryStates = new Map();
    this.frame = null;
    this.disposed = false;
    this.serial = 0;
    this.expansion = 0;
    this.draft = null;
    this.draftSession = null;
    this.draftGeneration = 0;
    this.root = this.node(root, null, -1);
    Object.assign(this.root, { expanded: true, items: source ? null : items, source, total: source?.total ?? items.length, loading });
    if (source?.pages) {
      for (const [page, rows] of source.pages) this.pages.set(this.key(this.root, page), { node: this.root, page, rows });
    }
    this.recount(this.root);
  }

  node(file, parent, index) {
    return { file, parent, index, id: ++this.serial, depth: parent ? parent.depth + 1 : 0,
      expanded: false, branches: [], total: 0, size: 1, loading: false, error: '', disposed: false, source: null, items: null };
  }

  key(node, page) { return `${node.id}:${page}`; }
  get count() { return this.root.size; }

  /** Last expansion error for a path, kept after the node is collapsed. */
  failureOf(path) { return this.failures.get(explorerPathKey(path)) || ''; }

  /** Whether a directory is known to be empty (kept after it is collapsed). */
  isEmpty(path) { return this.empties.has(explorerPathKey(path)); }

  directoryStateOf(file) { return this.directoryStates.get(explorerPathKey(file.path)) || file.directoryState; }

  recount(node) {
    while (node) {
      node.size = 1 + (node.expanded ? (node.error ? 1 : node.loading ? 0
        : node.total + node.branches.reduce((sum, child) => sum + child.size - 1, 0) + (this.draft?.node === node ? 1 : 0)) : 0);
      node = node.parent;
    }
  }

  changed() {
    if (this.disposed || this.frame != null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (!this.disposed) this.onChange();
    });
  }

  directRow(parent, index) {
    const page = Math.floor(index / (parent.source?.pageSize || 256));
    const file = parent.items ? parent.items[index] : this.pages.get(this.key(parent, page))?.rows[index % parent.source.pageSize];
    return { file, parent, index, depth: parent.depth + 1, node: null };
  }

  get(position, node = this.root) {
    if (position < 0 || position >= node.size) return null;
    if (position === 0) return { file: node.file, node, parent: node.parent, index: node.index, depth: node.depth };
    if (this.draft?.node === node && position === node.size - 1) return { draft: true, node, depth: node.depth + 1 };
    if (node.loading || node.error || !node.total) return { status: node.loading ? 'loading' : node.error ? 'error' : 'empty', node, depth: node.depth + 1 };
    let offset = position - 1;
    let cursor = 0;
    for (const child of node.branches) {
      const preceding = child.index - cursor;
      if (offset < preceding) return this.directRow(node, cursor + offset);
      offset -= preceding;
      if (offset < child.size) return this.get(offset, child);
      offset -= child.size;
      cursor = child.index + 1;
    }
    return this.directRow(node, cursor + offset);
  }

  closeNode(node) {
    if (this.draft?.node === node) this.draft = null;
    if (this.draftSession?.node === node) { this.draftSession = null; this.draftGeneration++; }
    node.disposed = true;
    for (const child of node.branches) this.closeNode(child);
    if (node.source?.owned) void Promise.resolve(node.source.close()).catch(() => {});
    for (const [key, entry] of this.pages) if (entry.node === node) this.pages.delete(key);
    for (const [key, entry] of this.wanted) if (entry.node === node) this.wanted.delete(key);
  }

  collapse(node) {
    this.expansion++;
    if (node === this.root) {
      this.draft = null;
      if (this.draftSession?.node === node) { this.draftSession = null; this.draftGeneration++; }
      for (const child of node.branches) this.closeNode(child);
      node.branches = [];
      node.expanded = false;
    } else {
      this.closeNode(node);
      node.parent.branches = node.parent.branches.filter((child) => child !== node);
    }
    this.recount(node.parent || node);
    this.changed();
  }

  collapseAll() {
    this.expansion++;
    this.draftGeneration++;
    this.draftSession = null;
    for (const child of this.root.branches) this.closeNode(child);
    this.root.branches = [];
    this.draft = null;
    // Collapse the root as well: the tree shows only the root row.
    this.root.expanded = false;
    this.recount(this.root);
    this.changed();
  }

  toggle(row) {
    if (!row?.file?.is_dir || this.disposed) return;
    if (row.node?.expanded) { this.collapse(row.node); return; }
    if (row.node === this.root) {
      this.root.expanded = true;
      this.recount(this.root); this.changed(); return this.root;
    }
    const node = this.node(row.file, row.parent, row.index);
    node.expanded = true; node.loading = true;
    row.parent.branches.push(node);
    row.parent.branches.sort((a, b) => a.index - b.index);
    this.recount(node); this.changed();
    this.load(node);
    return node;
  }

  retry(node) {
    if (node.source?.owned) void Promise.resolve(node.source.close()).catch(() => {});
    node.error = ''; node.loading = true;
    this.recount(node); this.changed();
    return this.load(node);
  }

  load(node) {
    const path = node.file?.path;
    const track = (result) => {
      if (!path) return;
      const key = explorerPathKey(path);
      if (result.total === 0) this.empties.add(key); else this.empties.delete(key);
      this.directoryStates.set(key, result.total ? 'readable' : 'empty');
      this.failures.delete(key);
    };
    try {
      node.source = this.openDirectory(node.file.path);
      node.ready = node.source.ready.then(async (result) => {
        if (this.disposed || node.disposed) return;
        Object.assign(node.source, result);
        // Commit an expansion only after its first children are resident. Empty
        // and pending folders do not insert status/skeleton rows into the tree.
        if (!result.items && result.total > 0) {
          const rows = await node.source.read(0);
          if (this.disposed || node.disposed) return;
          this.pages.set(this.key(node, 0), { node, page: 0, rows });
          while (this.pages.size > PROJECT_CACHE_PAGES) this.pages.delete(this.pages.keys().next().value);
        }
        node.items = result.items || null;
        node.total = result.total;
        node.loading = false;
        track(result);
        this.recount(node); this.changed();
      }).catch((error) => {
        if (this.disposed || node.disposed) return;
        node.loading = false; node.error = String(error);
        if (path) { this.failures.set(explorerPathKey(path), node.error); this.directoryStates.set(explorerPathKey(path), 'unreadable'); }
        this.recount(node); this.changed();
      });
    } catch (error) {
      node.loading = false; node.error = String(error);
      if (path) { this.failures.set(explorerPathKey(path), node.error); this.directoryStates.set(explorerPathKey(path), 'unreadable'); }
      this.recount(node); this.changed();
    }
    return node.ready;
  }

  position(node) {
    if (!node.parent) return 0;
    return this.position(node.parent) + 1 + node.index + node.parent.branches
      .filter((child) => child.index < node.index).reduce((sum, child) => sum + child.size - 1, 0);
  }

  async child(node, path) {
    if (node.loading) await node.ready;
    if (node.error) throw new Error(node.error);
    const key = explorerPathKey(path);
    const index = node.items ? node.items.findIndex((item) => explorerPathKey(item.path) === key) : await node.source.locate(path);
    if (index == null || index < 0 || this.disposed || node.disposed) return null;
    if (!node.items) {
      const page = Math.floor(index / node.source.pageSize);
      const cacheKey = this.key(node, page);
      if (!this.pages.has(cacheKey)) {
        const rows = await node.source.read(page);
        if (this.disposed || node.disposed) return null;
        this.pages.set(cacheKey, { node, page, rows });
        while (this.pages.size > PROJECT_CACHE_PAGES) this.pages.delete(this.pages.keys().next().value);
      }
    }
    const expanded = node.branches.find((item) => item.index === index);
    return expanded ? this.get(0, expanded) : this.directRow(node, index);
  }

  async reveal(file, isCurrent = () => true) {
    const rootKey = explorerPathKey(this.root.file.path);
    if (explorerPathKey(file.path) === rootKey) return 0;
    const paths = file.ancestors ? [...file.ancestors, file.path] : [file.path];
    if (!file.ancestors) {
      let parent = parentDirectory(file.path);
      while (parent && explorerPathKey(parent) !== rootKey) {
        paths.unshift(parent); parent = parentDirectory(parent);
      }
      if (explorerPathKey(parent) !== rootKey) return null;
    }
    if (!this.root.expanded) this.toggle(this.get(0));
    let node = this.root, row;
    for (let index = 0; index < paths.length; index++) {
      if (!isCurrent() || this.disposed) return null;
      row = await this.child(node, paths[index]);
      if (!row?.file || !isCurrent() || this.disposed) return null;
      if (index < paths.length - 1) {
        node = row.node?.expanded ? row.node : this.toggle(row);
        if (!node) return null;
        if (node.loading) await node.ready;
      }
    }
    this.changed();
    return this.position(row.node || { parent: row.parent, index: row.index });
  }

  async refreshDirectory(file) {
    const position = await this.reveal(file);
    if (position == null || this.disposed) return;
    const row = this.get(position);
    if (!row.parent) return;
    const replacement = this.node(row.file, row.parent, row.index);
    replacement.expanded = true; replacement.loading = true;
    await this.load(replacement);
    if (this.disposed || row.parent.disposed) { this.closeNode(replacement); return; }
    if (row.node) this.closeNode(row.node);
    row.parent.branches = row.parent.branches.filter((child) => child.index !== row.index);
    row.parent.branches.push(replacement);
    row.parent.branches.sort((a, b) => a.index - b.index);
    this.recount(row.parent); this.changed();
  }

  async startDraft(file) {
    this.cancelExpansion();
    this.cancelDraft();
    const generation = this.draftGeneration;
    const current = () => !this.disposed && generation === this.draftGeneration;
    const position = await this.reveal(file, current);
    if (position == null || !current()) return null;
    const row = this.get(position);
    const wasExpanded = Boolean(row.node?.expanded);
    const node = row.node?.expanded ? row.node : this.toggle(row);
    if (!node) return null;
    const session = { node, wasExpanded };
    this.draftSession = session;
    try {
      if (node.loading) await node.ready;
      if (!current() || node.disposed) return null;
      if (node.error) throw new Error(node.error);
      this.draft = session;
      this.recount(node);
      const draftPosition = this.draftPosition;
      await this.preload(Math.max(position, draftPosition - 32), draftPosition + 1);
      if (!current() || node.disposed) return null;
      this.changed();
      return this.draftPosition;
    } catch (error) {
      if (current()) this.cancelDraft();
      throw error;
    }
  }

  get draftPosition() { return this.draft ? this.position(this.draft.node) + this.draft.node.size - 1 : -1; }

  cancelDraft({ restore = true } = {}) {
    this.draftGeneration++;
    const session = this.draftSession || this.draft;
    const node = session?.node;
    this.draft = null;
    this.draftSession = null;
    if (!node || node.disposed) return;
    // An empty child temporarily gains children while naming. Cancelling must
    // return it to its empty, closed state; existing expanded folders stay open.
    if (restore && (!session.wasExpanded || (node !== this.root && !node.loading && !node.error && !node.total))) this.collapse(node);
    else { this.recount(node); this.changed(); }
  }

  async preload(start, end) {
    const needed = new Map();
    for (let index = start; index < Math.min(end, this.count); index++) {
      const row = this.get(index);
      if (!row?.parent?.source || row.parent.items || row.status) continue;
      const node = row.parent, page = Math.floor(row.index / node.source.pageSize);
      needed.set(this.key(node, page), { node, page });
    }
    for (const [key, { node, page }] of needed) {
      if (this.disposed || node.disposed) return;
      if (!this.pages.has(key)) {
        const rows = await node.source.read(page);
        if (this.disposed || node.disposed) return;
        this.pages.set(key, { node, page, rows });
        while (this.pages.size > PROJECT_CACHE_PAGES) this.pages.delete(this.pages.keys().next().value);
      }
    }
  }

  async expandDescendants(file) {
    const operation = ++this.expansion;
    const current = () => !this.disposed && operation === this.expansion;
    const position = await this.reveal(file, current);
    if (position == null || !current()) return;
    const row = this.get(position);
    const selected = row.node?.expanded ? row.node : this.toggle(row);
    if (!selected) return;
    const visit = async (node, ancestors = new Set()) => {
      if (node.loading) await node.ready;
      if (!current() || node.disposed || node.error) return;
      const identity = explorerPathKey(node.source?.canonicalPath || node.file.path);
      if (ancestors.has(identity)) {
        node.expanded = false;
        this.recount(node); this.changed();
        return;
      }
      const nextAncestors = new Set(ancestors).add(identity);
      const pageSize = node.source?.pageSize || 256;
      for (let offset = 0; offset < node.total && current(); offset += pageSize) {
        const entries = node.items ? node.items.slice(offset, offset + pageSize)
          : await node.source.read(offset / pageSize);
        if (!current() || node.disposed) return;
        for (let index = 0; index < entries.length && current(); index++) {
          if (!entries[index].is_dir) continue;
          const existing = node.branches.find((child) => child.index === offset + index);
          const child = existing || this.toggle({ file: entries[index], parent: node, index: offset + index });
          if (child) await visit(child, nextAncestors);
        }
        // Yield even for in-memory providers; a deep/large tree must remain
        // interruptible by Collapse all, navigation and mode changes.
        if (current()) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    await visit(selected);
    if (current()) this.changed();
  }

  cancelExpansion() { this.expansion++; }

  ensureRange(start, end, motion) {
    if (this.disposed) return;
    const wanted = new Map();
    const add = (row) => {
      if (!row?.parent?.source || row.parent.items || row.status) return;
      const node = row.parent;
      const page = Math.floor(row.index / node.source.pageSize);
      const key = this.key(node, page);
      if (wanted.size < PROJECT_CACHE_PAGES) wanted.set(key, { node, page });
    };
    const visibleStart = motion?.visibleStart ?? start;
    const visibleEnd = motion?.visibleEnd ?? end;
    // Request actual visible rows before the directional render buffer.
    for (let position = visibleStart; position < Math.min(visibleEnd, visibleStart + 256); position += 1) add(this.get(position));
    for (let position = start; position < Math.min(end, start + 256); position += 1) add(this.get(position));
    const edge = this.get(motion?.direction < 0 ? start : Math.max(start, end - 1));
    if (edge?.parent?.source && !edge.parent.items) {
      const { parent, index } = edge;
      const direction = motion?.direction < 0 ? -1 : 1;
      const page = Math.floor(index / parent.source.pageSize) + direction;
      if (page >= 0 && page * parent.source.pageSize < parent.total && wanted.size < PROJECT_CACHE_PAGES) {
        wanted.set(this.key(parent, page), { node: parent, page });
      }
    }
    this.wanted = wanted;
    this.pump();
  }

  pump() {
    if (this.disposed) return;
    for (const [key, { node, page }] of this.wanted) {
      if (this.inFlight.size >= 2) break;
      if (node.disposed || this.pages.has(key) || this.inFlight.has(key) || node.error) continue;
      this.inFlight.add(key);
      void (async () => {
        try {
          const rows = await node.source.read(page);
          if (this.disposed || node.disposed || !this.wanted.has(key)) return;
          if (!Array.isArray(rows) || !rows.length) throw new Error('Could not read project directory page');
          this.pages.delete(key);
          this.pages.set(key, { node, page, rows });
          for (const candidate of this.pages.keys()) {
            if (this.pages.size <= PROJECT_CACHE_PAGES) break;
            if (!this.wanted.has(candidate)) this.pages.delete(candidate);
          }
          while (this.pages.size > PROJECT_CACHE_PAGES) this.pages.delete(this.pages.keys().next().value);
          this.changed();
        } catch (error) {
          if (this.disposed || node.disposed || !this.wanted.has(key)) return;
          node.error = String(error);
          this.recount(node); this.changed();
        } finally {
          this.inFlight.delete(key); this.pump();
        }
      })();
    }
  }

  dispose() {
    this.expansion++;
    this.draftGeneration++;
    this.draftSession = null;
    this.disposed = true;
    if (this.frame != null) cancelAnimationFrame(this.frame);
    this.closeNode(this.root);
    this.pages.clear(); this.wanted.clear();
  }
}
