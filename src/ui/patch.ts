// Update an element to match new HTML while keeping the existing nodes where
// the structure is the same. Replacing innerHTML on a timer swaps every button
// underneath the pointer, and a click whose press and release land on
// different nodes is lost; patching only changes the text and attributes.

export function patchHTML(el: Element, html: string): void {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  syncChildren(el, tpl.content);
}

function syncChildren(from: Node, to: Node): void {
  const want = Array.from(to.childNodes);
  want.forEach((n, i) => {
    const have = from.childNodes[i];
    if (!have) from.appendChild(n.cloneNode(true));
    else if (have.nodeType !== n.nodeType || have.nodeName !== n.nodeName) from.replaceChild(n.cloneNode(true), have);
    else sync(have, n);
  });
  while (from.childNodes.length > want.length) from.removeChild(from.lastChild!);
}

function sync(from: Node, to: Node): void {
  if (from instanceof Element && to instanceof Element) {
    for (const a of Array.from(from.attributes)) if (!to.hasAttribute(a.name)) from.removeAttribute(a.name);
    for (const a of Array.from(to.attributes)) if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
    syncChildren(from, to);
  } else if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
}
