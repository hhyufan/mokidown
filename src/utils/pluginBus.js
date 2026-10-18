/**
 * Host ↔ plugin message bus.
 *
 * Running plugins register a sender; editor UI (status bar, commands, file
 * list) can push `command` / `event` messages into the plugin realm so plugins
 * can react to editor activity.
 */
const senders = new Map();
const requests = new Map();

export function registerPluginSender(pluginId, send) {
  senders.set(pluginId, send);
}

export function unregisterPluginSender(pluginId) {
  senders.delete(pluginId);
  for (const [id, request] of requests) if (request.pluginId === pluginId) {
    clearTimeout(request.timer); requests.delete(id); request.reject(new Error('Plugin stopped'));
  }
}

export function executePluginCommand(pluginId, command, args, timeoutMs = 90000) {
  const send = senders.get(pluginId);
  if (!send) return Promise.reject(new Error('Plugin is not running'));
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { requests.delete(requestId); reject(new Error('Plugin command timed out')); }, timeoutMs);
    requests.set(requestId, { pluginId, resolve, reject, timer });
    send({ type: 'command', id: command, args, requestId });
  });
}

export function finishPluginCommand(pluginId, message) {
  const request = requests.get(message.requestId);
  if (!request || request.pluginId !== pluginId) return;
  clearTimeout(request.timer); requests.delete(message.requestId);
  if (message.error) request.reject(new Error(String(message.error))); else request.resolve(message.value);
}

export function sendToPlugin(pluginId, message) {
  senders.get(pluginId)?.(message);
}

export function broadcastToPlugins(message) {
  for (const send of senders.values()) send(message);
}

export default { registerPluginSender, unregisterPluginSender, sendToPlugin, broadcastToPlugins };
