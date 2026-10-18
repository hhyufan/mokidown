export interface PluginDocument { id: string; path: string | null; name: string; content: string; checksum: string; language: string }
export interface TextEdit { from: number; to: number; text: string }
export interface StatusAction { id: string; title: string; command: string; args?: unknown; group?: string; disabled?: boolean }
export interface StatusItem { text: string; title?: string; command?: string; icon?: string; tone?: 'info' | 'success' | 'warning' | 'error'; busy?: boolean; actions?: StatusAction[] }
export interface PluginApi {
  apiVersion: 1;
  signal: AbortSignal;
  rpc<T = unknown>(method: string, args?: Record<string, unknown>): Promise<T>;
  context(): Promise<{ endpoint: string; workspace: boolean; workspaceId: string; apiVersion: 1; permissions: string[] }>;
  storage: { get<T = unknown>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<boolean> };
  workspace: {
    list(path?: string): Promise<{ name: string; directory: boolean }[]>;
    read(path: string): Promise<{ content: string | null; checksum: string | null }>;
    write(path: string, content: string, expectedHash?: string | null): Promise<boolean>;
    delete(path: string, expectedHash: string): Promise<boolean>;
  };
  net: { request<T = unknown>(path: string, options?: { method?: 'GET' | 'PUT' | 'POST' | 'DELETE'; body?: unknown }): Promise<{ status: number; data: T }> };
  editor: {
    getActiveDocument(): Promise<PluginDocument | null>;
    applyEdits(documentId: string, expectedChecksum: string, edits: TextEdit[]): Promise<{ documentId: string; checksum: string }>;
    onDidSave(callback: (event: { path: string; name: string }) => void | Promise<void>): () => void;
  };
  styles: { setMarkdown(id: string, css: string): Promise<boolean>; remove(id: string): Promise<boolean> };
  commands: { register(id: string, title: string, callback: (args: unknown) => unknown): Promise<() => void> };
  statusBar: { set(id: string, item: StatusItem): Promise<boolean>; remove(id: string): Promise<boolean> };
  fileIcons: { set(id: string, item: { extensions?: string[]; paths?: string[]; svg: string }): Promise<boolean>; remove(id: string): Promise<boolean> };
  on(name: string, callback: (payload: unknown) => unknown): () => void;
  onDispose(callback: () => void): () => void;
  dispose(): void;
}
export class PluginError extends Error { code: string; constructor(message: string, code?: string) }
export function createPluginClient(port: MessagePort, options?: { timeoutMs?: number }): PluginApi;
export function definePlugin(activate: (api: PluginApi) => void | (() => void) | Promise<void | (() => void)>): void;
