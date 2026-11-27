// Prism language components are plain scripts that address the global Prism
// object. Keep the runtime on globalThis before any lazy editor chunk loads,
// so code-split chunks cannot execute a grammar before the core module.
import Prism from 'prismjs';

globalThis.Prism = Prism;

export default Prism;
