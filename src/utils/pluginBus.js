/**
 * Host ↔ plugin message bus.
 *
 * Running plugins register a sender; editor UI (status bar, commands, file
 * list) can push `command` / `event` messages into the plugin realm so plugins
 * can react to editor activity.
 */
const senders = new Map();

export function registerPluginSender(pluginId, send) {
  senders.set(pluginId, send);
}

export function unregisterPluginSender(pluginId) {
  senders.delete(pluginId);
}

export function sendToPlugin(pluginId, message) {
  senders.get(pluginId)?.(message);
}

export function broadcastToPlugins(message) {
  for (const send of senders.values()) send(message);
}

export default { registerPluginSender, unregisterPluginSender, sendToPlugin, broadcastToPlugins };
