export const Fragment = Symbol.for("anybox.presentation.fragment");

export function jsx(type, props = {}, key = undefined) {
  return createElement(type, props, key);
}

export function jsxs(type, props = {}, key = undefined) {
  return createElement(type, props, key);
}

function createElement(type, props, key) {
  const children = normalizeChildren(props.children);
  if (typeof type === "function") {
    return type({ ...props, key, children });
  }
  if (type === Fragment) return children;
  return { type, ...props, key, children };
}

function normalizeChildren(children) {
  if (children == null) return [];
  return Array.isArray(children) ? children.flat().filter(Boolean) : [children];
}
