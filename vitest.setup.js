import '@testing-library/jest-dom/vitest';

// jsdom 没有 ResizeObserver；组件里的尺寸监听需要它。
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
