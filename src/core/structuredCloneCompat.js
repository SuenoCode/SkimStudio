// Older Android System WebViews do not expose structuredClone. The caption
// workflow only needs to copy plain app state, so provide a small compatible
// fallback while preserving structured cloning where the browser supports it.
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = function cloneValue(value) {
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (ArrayBuffer.isView(value)) return new value.constructor(value);
    if (Array.isArray(value)) return value.map(cloneValue);
    const copy = Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype);
    for (const [key, item] of Object.entries(value)) copy[key] = cloneValue(item);
    return copy;
  };
}

// Object.hasOwn is newer than the WebView JavaScript engines supported by
// some Android devices. Transformers uses it during model initialization.
if (typeof Object.hasOwn !== 'function') {
  Object.defineProperty(Object, 'hasOwn', {
    configurable: true,
    writable: true,
    value(object, property) {
      if (object == null) throw new TypeError('Object.hasOwn called on null or undefined');
      return Object.prototype.hasOwnProperty.call(Object(object), property);
    }
  });
}
