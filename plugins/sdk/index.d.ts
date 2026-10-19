export type Tone = 'info' | 'success' | 'warning' | 'error';
export interface PluginDocument { id: string; path: string | null; name: string; content: string; checksum: string; language: string }
export interface TextEdit { from: number; to: number; text: string }
export interface StatusAction { id: string; title: string; command: string; args?: unknown; group?: string; disabled?: boolean }
export interface StatusItem { text: string; title?: string; command?: string; icon?: string; tone?: Tone; busy?: boolean; actions?: StatusAction[]; documentId?: string; args?: unknown }
export interface DocumentInfo { id: string; path: string | null; name: string; relativePath: string | null; active: boolean; modified: boolean }
export interface FileDecoration { extensions?: string[]; paths?: string[]; svg: string; title?: string }
export interface VersionItem { id: string; label: string; meta?: string; rev?: number; content?: string; actionLabel?: string }
export interface VersionSource { path: string; title?: string; emptyText?: string; items: VersionItem[] }
export interface PluginContext { endpoint: string; workspace: boolean; workspaceId: string; apiVersion: 1; sdkVersion: string; capabilities: string[]; permissions: string[]; theme: 'light' | 'dark'; development: boolean }
export interface PluginSelection { documentId: string; from: number; to: number; text: string; checksum: string }
export interface PluginApi {
  apiVersion: 1;
  sdkVersion: string;
  signal: AbortSignal;
  rpc<T = unknown>(method: string, args?: Record<string, unknown>): Promise<T>;
  context(): Promise<PluginContext>;
  capabilities: { get(): Promise<string[]>; has(name: string): Promise<boolean> };
  configuration: { get<T = Record<string, unknown>>(): Promise<T> };
  theme: { get(): Promise<'light' | 'dark'>; onDidChange(callback: (theme: 'light' | 'dark') => unknown): () => void };
  notifications: { show(message: string, options?: { tone?: Tone; duration?: number }): Promise<boolean> };
  storage: { get<T = unknown>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<boolean>; keys(): Promise<string[]>; delete(key: string): Promise<boolean> };
  workspace: {
    list(path?: string): Promise<{ name: string; directory: boolean }[]>;
    read(path: string): Promise<{ content: string | null; checksum: string | null }>;
    write(path: string, content: string, expectedHash?: string | null): Promise<boolean>;
    delete(path: string, expectedHash: string): Promise<boolean>;
  };
  net: { request<T = unknown>(path: string, options?: { method?: 'GET' | 'PUT' | 'POST' | 'DELETE'; body?: unknown }): Promise<{ status: number; data: T }> };
  editor: {
    getActiveDocument(): Promise<PluginDocument | null>;
    getDocument(documentId: string): Promise<PluginDocument | null>;
    listDocuments(): Promise<DocumentInfo[]>;
    focusDocument(documentId: string): Promise<boolean>;
    getSelection(documentId?: string): Promise<PluginSelection | null>;
    setSelection(documentId: string, expectedChecksum: string, from: number, to?: number): Promise<boolean>;
    showDiff(options: { path?: string; content: string; label?: string; rev?: number; actions?: StatusAction[]; actionLabel?: string }): Promise<boolean>;
    showVersions(options: { path?: string; title?: string; items: VersionItem[] }): Promise<boolean>;
    reloadDocument(documentId: string): Promise<boolean>;
    applyEdits(documentId: string, expectedChecksum: string, edits: TextEdit[]): Promise<{ documentId: string; checksum: string }>;
    onDidSave(callback: (event: { path: string; name: string }) => unknown): () => void;
    onDidChangeDocuments(callback: (documents: DocumentInfo[]) => unknown): () => void;
    onDidChangeContent(callback: (event: { documentIds: string[] }) => unknown): () => void;
  };
  versions: { set(source: VersionSource): Promise<boolean>; remove(path: string): Promise<boolean>; onDidSelect(callback: (event: { rev: number; path?: string }) => unknown): () => void; onDidRequestRefresh(callback: (event: unknown) => unknown): () => void };
  styles: { setMarkdown(id: string, css: string): Promise<boolean>; remove(id: string): Promise<boolean> };
  commands: { register(id: string, title: string, callback: (args: unknown) => unknown): Promise<() => void> };
  statusBar: { set(id: string, item: StatusItem): Promise<boolean>; remove(id: string): Promise<boolean> };
  fileIcons: { set(id: string, item: FileDecoration): Promise<boolean>; remove(id: string): Promise<boolean> };
  fileBadges: { set(id: string, item: FileDecoration): Promise<boolean>; remove(id: string): Promise<boolean> };
  tasks: { set(id: string, task: { title: string; status?: string; tone?: Tone; command?: string; args?: unknown; progress?: number; reveal?: boolean }): Promise<boolean>; remove(id: string): Promise<boolean> };
  on(name: string, callback: (payload: unknown) => unknown): () => void;
  onDispose(callback: () => void): () => void;
  dispose(): void;
}
export const SDK_VERSION: string;
export class PluginError extends Error { code: string; constructor(message: string, code?: string) }
export function createPluginClient(port: MessagePort, options?: { timeoutMs?: number }): PluginApi;
export function definePlugin(activate: (api: PluginApi) => void | (() => void) | Promise<void | (() => void)>): void;
