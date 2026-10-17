/**
 * Character-set helpers.
 *
 * Chinese sites in particular still ship GBK/GB18030 responses without a
 * charset in the Content-Type header, so decoding has to be opportunistic:
 * honour the declared charset, otherwise try UTF-8 and fall back to GBK when
 * the UTF-8 attempt produced replacement characters.
 */

const DECLARED = /charset\s*=\s*["']?([\w-]+)/i;

/** Extract the charset declared in a Content-Type header, lower-cased. */
export function charsetFromContentType(contentType) {
  if (!contentType) return null;
  const m = DECLARED.exec(String(contentType));
  return m ? m[1].toLowerCase() : null;
}

function tryDecode(buffer, encoding) {
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return null;
  }
}

/**
 * Decode a response body to a string, guessing the charset when it is not
 * declared. Returns `{ text, charset }`.
 */
export function decodeBuffer(buffer, contentType) {
  const declared = charsetFromContentType(contentType);

  let text = tryDecode(buffer, declared || 'utf-8');
  let charset = declared || 'utf-8';

  if (text === null || text.includes('\uFFFD')) {
    // Retry as GBK — the usual culprit for undecorated Chinese responses.
    const gbk = tryDecode(buffer, 'gbk');
    if (gbk !== null && !gbk.includes('\uFFFD')) {
      return { text: gbk, charset: 'gbk' };
    }
    if (text === null) {
      return { text: buffer.toString('latin1'), charset: 'binary' };
    }
  }

  return { text, charset };
}

/**
 * Cheap binary sniff: a NUL byte in the first block is a strong signal that a
 * body should not be written out as text.
 */
export function looksBinary(buffer) {
  const end = Math.min(buffer.length, 512);
  for (let i = 0; i < end; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

const TEXTUAL_MIME =
  /(^text\/)|json|javascript|ecmascript|xml|x-www-form-urlencoded|html|csv|yaml|graphql/i;

const TEXTUAL_RESOURCE_TYPES = new Set(['Document', 'XHR', 'Fetch', 'Script', 'Stylesheet']);

/** Decide whether a response should get a decoded `.txt` companion file. */
export function isTextual(buffer, { mimeType, contentType, resourceType } = {}) {
  if (!buffer || buffer.length === 0) return false;
  if (looksBinary(buffer)) return false;
  if (TEXTUAL_MIME.test(mimeType || '')) return true;
  if (TEXTUAL_MIME.test(contentType || '')) return true;
  return TEXTUAL_RESOURCE_TYPES.has(resourceType);
}
