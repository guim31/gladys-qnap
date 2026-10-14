// -----------------------------------------------------------------------------
// A small XML reader for the answers of the QTS CGI API, written for them and
// nothing else: no dependency, no DTD, no namespace.
//
// The QTS answers are plain trees under `<QDocRoot>`: elements, CDATA
// sections (sometimes padded with white space when pretty-printed), a few
// entities, no meaningful attribute and no mixed content. They become plain
// objects:
//
//   <a><b><![CDATA[1]]></b><c>x</c><c>y</c><d/></a>  ->  { b: '1', c: ['x', 'y'], d: '' }
//
// A leaf is its trimmed text; an element with children is an object; a name
// seen twice under the same parent becomes an array. Attributes are dropped.
// Use `list()` where QTS repeats an element (`<entry>`, `<volume>`, `<item>`):
// a single occurrence is not an array.
// -----------------------------------------------------------------------------

export class XmlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XmlError';
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

// QTS answers a few tens of kB; a deeper or wider tree is not one of its answers.
const MAX_DEPTH = 64;

/**
 * @param {string} source an XML document
 * @returns {Record<string, unknown>} the root element as an object (`{ QDocRoot: ... }` unwrapped
 *   by the caller), the root name in `name`
 */
export function parseXml(source) {
  if (typeof source !== 'string') {
    throw new XmlError('not a text');
  }
  let at = 0;
  const length = source.length;
  // Each open element: { name, children: Map<string, unknown[]>, text: string[] }
  const stack = [];
  let root = null;

  const finish = (node) => {
    if (node.children.size === 0) {
      return node.text.join('').trim();
    }
    const object = {};
    for (const [name, values] of node.children) {
      object[name] = values.length === 1 ? values[0] : values;
    }
    return object;
  };

  const attach = (name, value) => {
    const parent = stack[stack.length - 1];
    if (!parent) {
      if (root !== null) {
        throw new XmlError('several root elements');
      }
      root = { name, value };
      return;
    }
    if (!parent.children.has(name)) {
      parent.children.set(name, []);
    }
    parent.children.get(name).push(value);
  };

  while (at < length) {
    const open = source.indexOf('<', at);
    if (open === -1) {
      if (stack.length) {
        stack[stack.length - 1].text.push(decode(source.slice(at)));
      }
      break;
    }
    if (open > at && stack.length) {
      stack[stack.length - 1].text.push(decode(source.slice(at, open)));
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open + 9);
      if (end === -1) {
        throw new XmlError('unterminated CDATA');
      }
      if (stack.length) {
        stack[stack.length - 1].text.push(source.slice(open + 9, end));
      }
      at = end + 3;
      continue;
    }
    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      if (end === -1) {
        throw new XmlError('unterminated comment');
      }
      at = end + 3;
      continue;
    }
    if (source.startsWith('<?', open) || source.startsWith('<!', open)) {
      const end = source.indexOf('>', open);
      if (end === -1) {
        throw new XmlError('unterminated declaration');
      }
      at = end + 1;
      continue;
    }
    const close = source.indexOf('>', open);
    if (close === -1) {
      throw new XmlError('unterminated tag');
    }
    const tag = source.slice(open + 1, close);
    at = close + 1;
    if (tag[0] === '/') {
      const name = tag.slice(1).trim();
      const node = stack.pop();
      if (!node || node.name !== name) {
        throw new XmlError(`unexpected </${name}>`);
      }
      attach(name, finish(node));
      continue;
    }
    const selfClosing = tag.endsWith('/');
    const name = (selfClosing ? tag.slice(0, -1) : tag).trim().split(/\s/)[0];
    if (!/^[A-Za-z_][\w.:-]*$/.test(name)) {
      throw new XmlError('bad tag name');
    }
    if (selfClosing) {
      attach(name, '');
      continue;
    }
    if (stack.length >= MAX_DEPTH) {
      throw new XmlError('too deep');
    }
    stack.push({ name, children: new Map(), text: [] });
  }
  if (stack.length) {
    throw new XmlError(`unclosed <${stack[stack.length - 1].name}>`);
  }
  if (root === null) {
    throw new XmlError('no element');
  }
  return { name: root.name, value: root.value };
}

/** A QTS answer: the content of its `<QDocRoot>`. */
export function parseQDoc(source) {
  const { name, value } = parseXml(source);
  if (name !== 'QDocRoot' || !value || typeof value !== 'object') {
    throw new XmlError('not a QTS answer');
  }
  return value;
}

/** The value as an array: [] when absent, [value] when QTS sent it once. */
export function list(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/** The object at a path, or {} (never throws on a missing level). */
export function at(value, ...path) {
  let node = value;
  for (const key of path) {
    node = node && typeof node === 'object' && !Array.isArray(node) ? node[key] : undefined;
  }
  return node && typeof node === 'object' && !Array.isArray(node) ? node : {};
}

/** The text at a path, trimmed, or null when absent, empty or not a leaf. */
export function text(value, ...path) {
  let node = value;
  for (const key of path) {
    node = node && typeof node === 'object' && !Array.isArray(node) ? node[key] : undefined;
  }
  if (Array.isArray(node)) {
    node = node[0];
  }
  return typeof node === 'string' && node.trim() !== '' ? node.trim() : null;
}
