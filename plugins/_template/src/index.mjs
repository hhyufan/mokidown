import { definePlugin } from '@mokidown/sdk';

definePlugin(async (sdk) => {
  await sdk.commands.register('example.inspect', 'Inspect active document', async () => {
    const doc = await sdk.editor.getActiveDocument();
    await sdk.statusBar.set('example.status', { text: doc?.name || 'No document', tone: 'info' });
  });
  // Return a cleanup function or register one with sdk.onDispose().
  return () => {};
});
