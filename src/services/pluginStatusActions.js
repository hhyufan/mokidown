const validId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9.-]{1,80}$/i.test(value);

export function validateStatusActions(actions = []) {
  if (!Array.isArray(actions) || actions.length > 256) throw new Error('A status item supports up to 256 actions');
  const ids = new Set();
  let bytes = 0;
  return actions.map((action) => {
    if (!validId(action.id) || ids.has(action.id) || !validId(action.command) || typeof action.title !== 'string' || !action.title.trim() || action.title.length > 80 || action.group !== undefined && (typeof action.group !== 'string' || action.group.length > 240)) throw new Error('Invalid status action');
    ids.add(action.id);
    const args = action.args === undefined ? undefined : JSON.stringify(action.args);
    bytes += new TextEncoder().encode(args || '').length;
    if (bytes > 128 * 1024) throw new Error('Status action arguments exceed 128 KiB');
    return { id: action.id, command: action.command, title: action.title, group: action.group || '', disabled: action.disabled === true, args: args === undefined ? undefined : JSON.parse(args) };
  });
}
