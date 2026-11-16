// markdown-render-speed-02 v4 — single-pass index scanner, direct-to-HTML, no token tree.
// Written from the prose spec in one recorded session. Byte-identical to marked 18.1.3 (GFM on).

// ---------- helpers ----------
const ASCII_PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
function isSpaceCh(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f'; }
// Unicode whitespace (for flanking only): NBSP and Unicode space separators
// count as whitespace next to a delimiter, but NOT as a link-dest separator.
function isSpaceUni(c) {
  if (isSpaceCh(c)) return true;
  const n = c.charCodeAt(0);
  return n === 0xA0 || (n >= 0x2000 && n <= 0x200A) || n === 0x202F || n === 0x205F || n === 0x3000;
}
function isAsciiPunctCh(c) { const n = c.charCodeAt(0); return (n >= 33 && n <= 47) || (n >= 58 && n <= 64) || (n >= 91 && n <= 96) || (n >= 123 && n <= 126); }
const UNICODE_PUNCT_RE = /[\p{P}\p{S}]/u;
function isPunctCh(c) {
  if (c === '') return false;
  const n = c.charCodeAt(0);
  if (n < 128) return isAsciiPunctCh(c);
  return UNICODE_PUNCT_RE.test(c);
}
function isHexCh(c) { const n = c.charCodeAt(0); return (n >= 48 && n <= 57) || (n >= 65 && n <= 70) || (n >= 97 && n <= 102); }
function isDigitCh(c) { const n = c.charCodeAt(0); return n >= 48 && n <= 57; }
function isAlphaCh(c) { const n = c.charCodeAt(0); return (n >= 65 && n <= 90) || (n >= 97 && n <= 122); }
function isAlnumCh(c) { const n = c.charCodeAt(0); return (n >= 48 && n <= 57) || (n >= 65 && n <= 90) || (n >= 97 && n <= 122); }

// Escape HTML text (& < > " ').
function esc(s) {
  let out = '', start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let rep = null;
    if (c === 38) rep = '&amp;';
    else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    if (rep !== null) { out += s.slice(start, i) + rep; start = i + 1; }
  }
  return start === 0 ? s : out + s.slice(start);
}
// Escape code text (& < > " ').
function escPlain(s) {
  let out = '', start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let rep = null;
    if (c === 38) rep = '&amp;';
    else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    if (rep !== null) { out += s.slice(start, i) + rep; start = i + 1; }
  }
  return start === 0 ? s : out + s.slice(start);
}
// Entity at s[i] === '&'. Returns {len, literal, cp} or null.
// Named: &[A-Za-z0-9_]+; -> preserved as-is (cp -1).
// Numeric: &#[0-9]+; / &#[xX][0-9a-fA-F]+; -> cp (code point) if 0<=cp<=0x10FFFF,
// else null (out of range / malformed). Bare & (no ;) -> null.
function entityAt(s, i) {
  if (s[i + 1] === '#') {
    let j = i + 2, hex = false;
    if (s[j] === 'x' || s[j] === 'X') { hex = true; j++; }
    let k = j;
    while (k < s.length && (hex ? isHexCh(s[k]) : isDigitCh(s[k]))) k++;
    if (k > j && s[k] === ';') {
      const cp = parseInt(s.slice(j, k), hex ? 16 : 10);
      if (cp > 0x10FFFF) return null;
      return { len: k + 1 - i, literal: s.slice(i, k + 1), cp };
    }
    return null;
  }
  let k = i + 1;
  while (k < s.length && (isAlnumCh(s[k]) || s[k] === '_')) k++;
  if (k > i + 1 && s[k] === ';') return { len: k + 1 - i, literal: s.slice(i, k + 1), cp: -1 };
  return null;
}
// Escape HTML text with entity awareness: named entities preserved as-is,
// numeric entities decoded to the char (0 / surrogates -> U+FFFD), then escaped.
// Bare & -> &amp;.
function escText(s) {
  if (s.indexOf('&') < 0 && s.indexOf('<') < 0 && s.indexOf('>') < 0 && s.indexOf('"') < 0 && s.indexOf("'") < 0) return s;
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '&') {
      const e = entityAt(s, i);
      if (e) {
        if (e.cp >= 0) {
          const ch = (e.cp === 0 || (e.cp >= 0xD800 && e.cp <= 0xDFFF)) ? '\uFFFD' : String.fromCodePoint(e.cp);
          out += esc(ch);
        } else out += e.literal;
        i += e.len; continue;
      }
      out += '&amp;'; i++; continue;
    }
    if (c === '<') { out += '&lt;'; i++; continue; }
    if (c === '>') { out += '&gt;'; i++; continue; }
    if (c === '"') { out += '&quot;'; i++; continue; }
    if (c === "'") { out += '&#39;'; i++; continue; }
    let j = i + 1;
    while (j < n) {
      const d = s[j];
      if (d === '&' || d === '<' || d === '>' || d === '"' || d === "'") break;
      j++;
    }
    out += s.slice(i, j);
    i = j;
  }
  return out;
}
// Escape an attribute value with entity awareness: valid entities (named and
// numeric) preserved as-is; bare & -> &amp;; < > " ' escaped.
function escAttr(s) {
  if (s.indexOf('&') < 0 && s.indexOf('<') < 0 && s.indexOf('>') < 0 && s.indexOf('"') < 0 && s.indexOf("'") < 0) return s;
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '&') {
      const e = entityAt(s, i);
      if (e) { out += e.literal; i += e.len; continue; }
      out += '&amp;'; i++; continue;
    }
    if (c === '<') { out += '&lt;'; i++; continue; }
    if (c === '>') { out += '&gt;'; i++; continue; }
    if (c === '"') { out += '&quot;'; i++; continue; }
    if (c === "'") { out += '&#39;'; i++; continue; }
    let j = i + 1;
    while (j < n) {
      const d = s[j];
      if (d === '&' || d === '<' || d === '>' || d === '"' || d === "'") break;
      j++;
    }
    out += s.slice(i, j);
    i = j;
  }
  return out;
}
// Escape an href attribute value: percent-encode (encodeURI) then escAttr.
// Percent-encode like encodeURI, but preserve an already-valid %XX escape.
function encodeHref(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const code = s.charCodeAt(i);
    if (c === '%') { out += c; continue; }
    if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
        c === ';' || c === ',' || c === '/' || c === '?' || c === ':' || c === '@' || c === '&' ||
        c === '=' || c === '+' || c === '$' || c === '-' || c === '_' || c === '.' || c === '!' ||
        c === '~' || c === '*' || c === "'" || c === '(' || c === ')' || c === '#') {
      out += c; continue;
    }
    if (code < 128) {
      out += '%' + code.toString(16).toUpperCase().padStart(2, '0');
    } else {
      out += encodeURIComponent(c);
    }
  }
  return out;
}
function escHref(s) {
  let enc;
  try { enc = encodeHref(s); } catch (e) { enc = s; }
  return escAttr(enc);
}
// Resolve backslash escapes of ASCII punctuation (and backslash-newline -> newline kept).
function resolveEscapes(s) {
  if (s.indexOf('\\') < 0) return s;
  let out = '', start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 92 && i + 1 < s.length && isAsciiPunctCh(s[i + 1])) {
      out += s.slice(start, i) + s[i + 1];
      i++; start = i + 1;
    }
  }
  return start === 0 ? s : out + s.slice(start);
}
// Normalize a link label: trim, collapse whitespace runs to one space, case fold (ß/ẞ -> ss).
function normalizeLabel(s) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/\u00df/g, 'ss').replace(/\u1e9e/g, 'ss');
}


// ---------- label / destination / title scanning ----------
// Scan a link label starting at s[i] === '['. Returns {end, content} or null.
// Content is raw (no escape resolution). Max 999 chars of content.
function scanLabel(s, i) {
  let depth = 1, j = i + 1;
  const start = j;
  let btLiteral = false; // set once a backtick run is rescued as literal
  while (j < s.length) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length) { j += 2; continue; }
    if (c === '`') {
      let k = j; while (k < s.length && s[k] === '`') k++;
      if (btLiteral) { j = k; continue; }
      const len = k - j;
      // Find the closing run of the same length. Runs of a different
      // length are skipped (they are code-span content). A ']' that would
      // close this label before any closer means the code span is
      // unterminated: the label is invalid UNLESS a different-length run
      // was already seen (rescue: the opener is literal text, e.g. doc-06
      // `[add ``fixes`](...)`). If the code span's content holds a run
      // shorter than the opener and the closing run is NOT immediately
      // followed by the label's ']' (text after the code span in the
      // label), the label is invalid (`` `` a ` b `` y ``).
      let m = k, found = -1, sawOther = false, hasShorter = false;
      let d = depth;
      while (m < s.length) {
        if (s[m] === '\\' && m + 1 < s.length) { m += 2; continue; }
        if (s[m] === '`') {
          let n = m; while (n < s.length && s[n] === '`') n++;
          if (n - m === len) { found = n; break; }
          sawOther = true;
          if (n - m < len) hasShorter = true;
          m = n; continue;
        }
        if (s[m] === '[') { d++; m++; continue; }
        if (s[m] === ']') {
          d--;
          if (d === 0) {
            // Unterminated code span at the label end: invalid, unless a
            // different-length run rescued the opener as literal.
            if (!sawOther) return null;
            btLiteral = true;
            j = k; found = -2; break;
          }
          m++; continue;
        }
        m++;
      }
      if (found === -2) continue; // rescued as literal
      if (found < 0) {
        // No closer and no label-']' reached: end of string, no label.
        return null;
      }
      if (hasShorter && !(s[found] === ']' && depth === 1)) return null;
      j = found; continue;
    }
    if (c === '[') { depth++; j++; continue; }
    if (c === ']') {
      depth--;
      if (depth === 0) {
        const content = s.slice(start, j);
        if (content.length > 999) return null;
        return { end: j + 1, content };
      }
      j++; continue;
    }
    j++;
    if (j - start > 999) return null;
  }
  return null;
}
// Lenient label scan for masking only: finds the ']' that closes the
// label, tracking brackets and skipping code spans by the simple
// same-length rule, WITHOUT the validity rules of scanLabel. Used when a
// link attempt fails on an invalid label but a valid dest follows: the
// label content is then literal text (emphasis inside does not form),
// though code spans inside still render.
function scanLabelLenient(s, i) {
  let depth = 1, j = i + 1;
  const start = j;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length) { j += 2; continue; }
    if (c === '`') {
      let k = j; while (k < s.length && s[k] === '`') k++;
      const len = k - j;
      let m = k, found = -1;
      while (m < s.length) {
        if (s[m] === '\\' && m + 1 < s.length) { m += 2; continue; }
        if (s[m] === '`') {
          let n = m; while (n < s.length && s[n] === '`') n++;
          if (n - m === len) { found = n; break; }
          m = n; continue;
        }
        m++;
      }
      if (found >= 0) { j = found; continue; }
      j = k; continue;
    }
    if (c === '[') { depth++; j++; continue; }
    if (c === ']') {
      depth--;
      if (depth === 0) {
        const content = s.slice(start, j);
        if (content.length > 999) return null;
        return { end: j + 1, content };
      }
      j++; continue;
    }
    j++;
    if (j - start > 999) return null;
  }
  return null;
}
// Scan a link title at s[i] ('"' or '\'' or '('). Returns {end, title} or null.
function scanTitle(s, i) {
  const q = s[i];
  if (q === '"' || q === "'") {
    let j = i + 1;
    while (j < s.length) {
      if (s[j] === '\\' && j + 1 < s.length && isAsciiPunctCh(s[j + 1])) { j += 2; continue; }
      if (s[j] === q) return { end: j + 1, title: resolveEscapes(s.slice(i + 1, j)) };
      j++;
    }
    return null;
  }
  if (q === '(') {
    let j = i + 1;
    while (j < s.length) {
      if (s[j] === '\\' && j + 1 < s.length && isAsciiPunctCh(s[j + 1])) { j += 2; continue; }
      if (s[j] === '(') return null;
      if (s[j] === ')') return { end: j + 1, title: resolveEscapes(s.slice(i + 1, j)) };
      j++;
    }
    return null;
  }
  return null;
}
// Scan an inline link destination+title starting at s[i] === '('.
// Returns {end, dest, title} or null. end is just past the closing ')'.
function scanInlineDest(s, i) {
  let j = i + 1;
  while (j < s.length && isSpaceCh(s[j])) j++;
  if (j >= s.length) return null;
  let dest;
  if (s[j] === '<') {
    let k = j + 1;
    while (k < s.length && s[k] !== '>' && s[k] !== '\n') {
      if (s[k] === '\\' && k + 1 < s.length && isAsciiPunctCh(s[k + 1])) { k += 2; continue; }
      if (s[k] === '<') return null;
      k++;
    }
    if (s[k] !== '>') return null;
    dest = resolveEscapes(s.slice(j + 1, k));
    j = k + 1;
  } else {
    let depth = 0, k = j;
    while (k < s.length) {
      const c = s[k];
      if (isSpaceCh(c) || c.charCodeAt(0) < 32) break;
      if (c === '\\' && k + 1 < s.length && isAsciiPunctCh(s[k + 1])) { k += 2; continue; }
      if (c === '(') { depth++; k++; continue; }
      if (c === ')') { if (depth === 0) break; depth--; k++; continue; }
      k++;
    }
    dest = resolveEscapes(s.slice(j, k));
    j = k;
  }
  let title = null;
  let k = j;
  while (k < s.length && isSpaceCh(s[k])) k++;
  if (k > j && k < s.length && (s[k] === '"' || s[k] === "'" || s[k] === '(')) {
    const t = scanTitle(s, k);
    if (!t) return null;
    title = t.title; j = t.end;
    k = j;
    while (k < s.length && isSpaceCh(s[k])) k++;
  }
  if (s[k] !== ')') return null;
  return { end: k + 1, dest, title };
}

// ---------- HTML tag scanning ----------
// If s[i] === '<' starts a valid inline HTML tag, return the index just past it, else -1.
function scanHtmlTag(s, i) {
  const n = s.length;
  if (s[i] !== '<' || i + 1 >= n) return -1;
  let j = i + 1;
  // comment
  if (s.startsWith('<!--', i)) {
    if (s.startsWith('<!-->', i)) return i + 5;
    if (s.startsWith('<!--->', i)) return i + 6;
    const end = s.indexOf('-->', i + 4);
    if (end < 0) return -1;
    return end + 3;
  }
  // CDATA (must precede the '!' declaration branch: '<![' is not a letter)
  if (s.startsWith('<![CDATA[', i)) {
    const end = s.indexOf(']]>', i + 9);
    if (end < 0) return -1;
    return end + 3;
  }
  // processing instruction
  if (s[j] === '?') {
    const end = s.indexOf('?>', j + 1);
    if (end < 0) return -1;
    return end + 2;
  }
  // declaration <!A...>
  if (s[j] === '!') {
    if (j + 1 < n && isAlphaCh(s[j + 1])) {
      const end = s.indexOf('>', j + 2);
      if (end < 0) return -1;
      return end + 1;
    }
    return -1;
  }
  // close tag
  const isClose = s[j] === '/';
  if (isClose) j++;
  if (j >= n || !isAlphaCh(s[j])) return -1;
  while (j < n && (isAlnumCh(s[j]) || s[j] === '-')) j++;
  if (isClose) {
    // A close tag takes no attributes: only whitespace then '>'.
    while (j < n && isSpaceCh(s[j])) j++;
    if (j < n && s[j] === '>') return j + 1;
    return -1;
  }
  // attributes (whitespace is required before each attribute)
  while (j < n) {
    const wsStart = j;
    while (j < n && isSpaceCh(s[j])) j++;
    if (j >= n) return -1;
    if (s[j] === '>') return j + 1;
    if (s[j] === '/' && s[j + 1] === '>') return j + 2;
    if (j === wsStart) return -1; // no whitespace before this attribute
    if (!isAlphaCh(s[j]) && s[j] !== '_' && s[j] !== ':') return -1;
    while (j < n && (isAlnumCh(s[j]) || s[j] === '_' || s[j] === ':' || s[j] === '.' || s[j] === '-')) j++;
    // Peek for '=' (skipping whitespace). Only consume the whitespace when
    // a value follows; otherwise it separates this attribute from the next.
    let k = j;
    while (k < n && isSpaceCh(s[k])) k++;
    if (k < n && s[k] === '=') {
      j = k + 1;
      while (j < n && isSpaceCh(s[j])) j++;
      if (s[j] === '"' || s[j] === "'") {
        const q = s[j]; j++;
        while (j < n && s[j] !== q) j++;
        if (j >= n) return -1;
        j++;
      } else {
        let k2 = j;
        while (k2 < n && !isSpaceCh(s[k2]) && s[k2] !== '"' && s[k2] !== "'" && s[k2] !== '=' && s[k2] !== '<' && s[k2] !== '>' && s[k2] !== '`') k2++;
        if (k2 === j) return -1;
        j = k2;
      }
    }
  }
  return -1;
}

// ---------- masking ----------
// Category-preserving placeholder for a char inside a masked span.
function maskChar(c) {
  if (isSpaceUni(c)) return ' ';
  if (isPunctCh(c)) return '+';
  return 'a';
}
// True if s contains a link/image that would actually form (a link cannot
// contain another link, so a candidate whose label contains a link is not one).
// Recurses only on strictly smaller label strings, so it terminates.
function labelHasLinkLight(s, refs) {
  const n = s.length;
  for (let i = 0; i < n; i++) {
    if (s[i] !== '[' && !(s[i] === '!' && s[i + 1] === '[')) continue;
    const lbStart = s[i] === '!' ? i + 1 : i;
    const lb = scanLabel(s, lbStart);
    if (!lb) continue;
    const after = lb.end;
    let forms = false;
    if (after < n && s[after] === '(') {
      if (scanInlineDest(s, after)) forms = true;
    } else if (after < n && s[after] === '[') {
      const ref = scanLabel(s, after);
      if (ref && refs && refs.has(normalizeLabel(ref.content === '' ? lb.content : ref.content))) forms = true;
    } else if (refs && refs.has(normalizeLabel(lb.content))) {
      forms = true;
    }
    if (forms && !labelHasLinkLight(lb.content, refs)) return true;
  }
  return false;
}
// Build the length-preserving masked copy of an inline text: delimiter runs inside
// code spans, link/image labels that form a link, link destinations/titles, and HTML
// tags are hidden (replaced by category-preserving placeholders).
function buildMasked(s, refs) {
  const n = s.length;
  const a = s.split('');
  const maskRange = (from, to) => { for (let p = from; p < to; p++) a[p] = maskChar(s[p]); };
  // A backtick preceded by an odd number of backslashes is escaped: it
  // cannot open or close a code span.
  const isEscapedBt = (p) => {
    let c = 0;
    for (let q = p - 1; q >= 0 && s[q] === '\\'; q--) c++;
    return (c % 2) === 1;
  };
  // 1. code spans
  let i = 0;
  while (i < n) {
    if (s[i] === '`' && !isEscapedBt(i)) {
      let j = i; while (j < n && s[j] === '`') j++;
      const len = j - i;
      let k = j, found = -1;
      while (k < n) {
        if (s[k] === '`' && !isEscapedBt(k)) {
          let m = k; while (m < n && s[m] === '`') m++;
          if (m - k === len) { found = m; break; }
          k = m;
        } else k++;
      }
      if (found >= 0) { maskRange(j, found - len); i = found; }
      else i = j;
    } else i++;
  }
  // 1b. backslash escapes: an escaped punct char is not a delimiter.
  i = 0;
  while (i < n) {
    if (s[i] === '\\' && i + 1 < n && isAsciiPunctCh(s[i + 1])) { a[i + 1] = maskChar(s[i + 1]); i += 2; continue; }
    i++;
  }
  // 2. HTML tags + links + autolinks
  i = 0;
  while (i < n) {
    if (s[i] === '<') {
      const end = scanHtmlTag(s, i);
      if (end > 0) { maskRange(i + 1, end - 1); i = end; continue; }
      const al = tryAutolink(s, i);
      if (al) { maskRange(i + 1, al.end - 1); i = al.end; continue; }
      i++; continue;
    }
    if (s[i] === '[' || (s[i] === '!' && s[i + 1] === '[')) {
      const bang = s[i] === '!';
      const lb = scanLabel(s, bang ? i + 1 : i);
      if (!lb) {
        // Strict label invalid, but a link attempt may still have been
        // made: if a lenient label ends here and a valid inline dest
        // follows, the label content is literal text (its emphasis does
        // not form), so mask it.
        const ll = scanLabelLenient(s, bang ? i + 1 : i);
        if (ll) {
          const after = ll.end;
          if (after < n && s[after] === '(') {
            const d = scanInlineDest(s, after);
            if (d) { maskRange((bang ? i + 1 : i) + 1, ll.end - 1); maskRange(after + 1, d.end - 1); i = d.end; continue; }
          }
        }
        i++; continue;
      }
      // A link whose label contains a link cannot form: do not mask it, so
      // delimiters inside its label (e.g. emphasis) stay visible.
      if (labelHasLinkLight(lb.content, refs)) { i++; continue; }
      const after = lb.end;
      if (after < n && s[after] === '(') {
        const d = scanInlineDest(s, after);
        if (d) { maskRange((bang ? i + 1 : i) + 1, lb.end - 1); maskRange(after + 1, d.end - 1); i = d.end; continue; }
      } else if (after < n && s[after] === '[') {
        const ref = scanLabel(s, after);
        if (ref && refs && refs.has(normalizeLabel(ref.content))) {
          maskRange((bang ? i + 1 : i) + 1, lb.end - 1); maskRange(after + 1, ref.end - 1); i = ref.end; continue;
        }
      } else {
        if (refs && refs.has(normalizeLabel(lb.content))) {
          maskRange((bang ? i + 1 : i) + 1, lb.end - 1); i = lb.end; continue;
        }
      }
      i++;
      continue;
    }
    i++;
  }
  return a.join('');
}
// Last-possible-closer index for delimiter char ch in the masked text, or -1.
function lastCloserIndex(masked, ch) {
  let v = -1;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === ch) {
      let j = i; while (j < masked.length && masked[j] === ch) j++;
      const before = i === 0 ? '' : masked[i - 1];
      if (before === '' || !isSpaceUni(before)) v = i;
      i = j - 1;
    }
  }
  return v;
}

// ---------- flanking ----------
function flanking(masked, j, b) {
  const before = j === 0 ? '' : masked[j - 1];
  const after = j + b < masked.length ? masked[j + b] : '';
  const beforeIsWS = before === '' || isSpaceUni(before);
  const beforeIsPunct = before !== '' && isPunctCh(before);
  const afterIsWS = after === '' || isSpaceUni(after);
  const afterIsPunct = after !== '' && isPunctCh(after);
  const left = !afterIsWS && (!afterIsPunct || beforeIsWS || beforeIsPunct);
  const right = !beforeIsWS && (!beforeIsPunct || afterIsWS || afterIsPunct);
  return { before, after, beforeIsWS, beforeIsPunct, afterIsWS, afterIsPunct, left, right };
}
function canOpenDelim(fl, ch) {
  if (!fl.left) return false;
  if (ch === '_') {
    if (fl.right && !fl.beforeIsPunct) return false;
  }
  return true;
}
function canCloseDelim(fl, ch) {
  if (!fl.right) return false;
  if (ch === '_') {
    if (fl.left && !fl.afterIsPunct) return false;
  }
  return true;
}
// Classify a delimiter run: 'opener' | 'both' | 'closer' | 'neither'.
function classifyRun(masked, j, b, ch) {
  const fl = flanking(masked, j, b);
  const co = canOpenDelim(fl, ch);
  const cc = canCloseDelim(fl, ch);
  if (co && cc) return 'both';
  if (co) return 'opener';
  if (cc) return 'closer';
  return 'neither';
}
// Cross-delimiter scoping: is the candidate closer at candPos (delimiter dChar) inside a
// matched pair of the OTHER delimiter? An other-opener between the D-opener and the
// candidate, whose closer lies after the candidate (and which is not already closed
// before the candidate), makes the candidate unavailable.
function insideOtherPair(masked, openerPos, candPos, candLen, dChar) {
  const others = dChar === '~' ? ['*', '_'] : [dChar === '*' ? '_' : '*'];
  const n = masked.length;
  for (const oChar of others) {
    for (let p = openerPos + 1; p < candPos;) {
      if (masked[p] !== oChar) { p++; continue; }
      if (p > openerPos + 1 && masked[p - 1] === oChar) { p++; continue; }
      let q = p; while (q < n && masked[q] === oChar) q++;
      const b = q - p;
      const kind = classifyRun(masked, p, b, oChar);
      // The inner pair blocks the candidate closer only when its opener run
      // is LONGER than the closer run (cm-469: _ len 1 does not block * len 1;
      // cm-470: __ len 2 blocks * len 1).
      if (b <= candLen) { p = q; continue; }
      if (kind === 'opener' || kind === 'both') {
        let closedBefore = false;
        for (let r = q; r < candPos;) {
          if (masked[r] !== oChar) { r++; continue; }
          if (r > q && masked[r - 1] === oChar) { r++; continue; }
          let s2 = r; while (s2 < n && masked[s2] === oChar) s2++;
          const k2 = classifyRun(masked, r, s2 - r, oChar);
          if (k2 === 'closer' || k2 === 'both') { closedBefore = true; break; }
          r = s2;
        }
        if (!closedBefore) {
          for (let r = candPos + 1; r < n;) {
            if (masked[r] !== oChar) { r++; continue; }
            if (r > candPos + 1 && masked[r - 1] === oChar) { r++; continue; }
            let s2 = r; while (s2 < n && masked[s2] === oChar) s2++;
            const k2 = classifyRun(masked, r, s2 - r, oChar);
            if (k2 === 'closer' || k2 === 'both') return true;
            r = s2;
          }
        }
      }
      p = q;
    }
  }
  return false;
}

// ---------- emStrong ----------
// Try to match em/strong starting at the delimiter run at pos (original text s).
// masked is the masked copy, v the last-possible-closer index for ch.
// Returns {end, tag, inner} or null. end is just past the consumed closer chars.
function matchEmStrong(s, masked, pos, ch, v) {
  const n = s.length;
  const i = pos;
  let k = 0;
  while (pos + k < n && s[pos + k] === ch) k++;
  const after = pos + k < n ? s[pos + k] : '';
  if (after === '' || isSpaceUni(after)) return null;
  let l = i;
  while (l > 0 && masked[l - 1] === ch) l--;
  const p = l === 0 ? '' : masked[l - 1];
  const h = p === '*' || p === '_' || (p !== '' && isPunctCh(p));
  const prev = i === 0 ? '' : s[i - 1];
  const beforeIsWS = p === '' || isSpaceUni(p);
  const beforeIsPunct = p !== '' && isPunctCh(p);
  const afterIsWS = after === '' || isSpaceUni(after);
  const afterIsPunct = after !== '' && isPunctCh(after);
  const left = !afterIsWS && (!afterIsPunct || beforeIsWS || beforeIsPunct);
  const right = !beforeIsWS && (!beforeIsPunct || afterIsWS || afterIsPunct);
  if (!left) return null;
  if (ch === '_' && right && !beforeIsPunct) return null;
  const d = afterIsPunct ? after : '';
  let m = k, f = 0;
  const y = (i - l) + k;
  const o = prev === ch;
  const R = p !== '' && !isSpaceUni(p) && (d !== '' || (ch === '*' && !h));
  const Q = i + k;
  if (v < Q) return null;
  const ee = v - Q;
  const end = Math.min(n, Q + ee);
  let j = Q;
  while (j <= end) {
    if (masked[j] !== ch) { j++; continue; }
    let b = 0;
    while (j + b < n && masked[j + b] === ch) b++;
    if (insideOtherPair(masked, i, j, b, ch)) { j += b; continue; }
    const fl = flanking(masked, j, b);
    const co = canOpenDelim(fl, ch);
    const cc = canCloseDelim(fl, ch);
    if (!co && !cc) { j += b; continue; }
    if (co && !cc) { m += b; j += b; continue; }
    const both = co && cc;
    if (both || R) {
      if (o && both) return null;
      if (y % 3 !== 0 && (y + b) % 3 === 0) { f += b; j += b; continue; }
    }
    m -= b;
    if (m > 0) { j += b; continue; }
    const bp = Math.min(b, b + m + f);
    const rawEnd = j + bp;
    const raw = s.slice(i, rawEnd);
    const use = Math.min(k, bp);
    let tag, inner;
    if (use % 2 === 1) { tag = 'em'; inner = raw.slice(1, raw.length - 1); }
    else { tag = 'strong'; inner = raw.slice(2, raw.length - 2); }
    return { end: rawEnd, tag, inner };
  }
  return null;
}

// ---------- del (strikethrough) ----------
// Opener is a run of 1-2 '~' (o = run length, capped at 2). Closer must be exactly length o.
function matchDel(s, masked, pos, v) {
  const n = s.length;
  const i = pos;
  let k = 0;
  while (pos + k < n && s[pos + k] === '~') k++;
  const o = Math.min(k, 2);
  const before = i === 0 ? '' : s[i - 1];
  const after = i + o < n ? s[i + o] : '';
  const beforeIsWS = before === '' || isSpaceUni(before);
  const beforeIsPunct = before !== '' && isPunctCh(before);
  const afterIsWS = after === '' || isSpaceUni(after);
  const afterIsPunct = after !== '' && isPunctCh(after);
  const left = !afterIsWS && (!afterIsPunct || beforeIsWS || beforeIsPunct);
  if (!left) return null;
  const Q = i + o;
  if (v < Q) return null;
  const ee = v - Q;
  const end = Math.min(n, Q + ee);
  let m = o;
  let j = Q;
  while (j <= end) {
    if (masked[j] !== '~') { j++; continue; }
    let b = 0;
    while (j + b < n && masked[j + b] === '~') b++;
    if (b !== o) {
      const fl = flanking(masked, j, b);
      const co = canOpenDelim(fl, '~');
      const cc = canCloseDelim(fl, '~');
      if (co && !cc) { m += b; j += b; continue; }
      j += b; continue;
    }
    if (insideOtherPair(masked, i, j, b, '~')) { j += b; continue; }
    const fl = flanking(masked, j, b);
    const co = canOpenDelim(fl, '~');
    const cc = canCloseDelim(fl, '~');
    if (!co && !cc) { j += b; continue; }
    if (co && !cc) { m += b; j += b; continue; }
    m -= b;
    if (m > 0) { j += b; continue; }
    const rawEnd = j + o;
    const raw = s.slice(i, rawEnd);
    const inner = raw.slice(o, raw.length - o);
    return { end: rawEnd, tag: 'del', inner };
  }
  return null;
}

// ---------- code span ----------
function tryCodeSpan(s, i) {
  const n = s.length;
  let j = i;
  while (j < n && s[j] === '`') j++;
  const len = j - i;
  let k = j, found = -1;
  while (k < n) {
    if (s[k] === '`') {
      let m = k; while (m < n && s[m] === '`') m++;
      if (m - k === len) { found = m; break; }
      k = m;
    } else k++;
  }
  if (found < 0) return null;
  const content = codeSpanContent(s.slice(j, found - len));
  return { end: found, html: '<code>' + escPlain(content) + '</code>' };
}
// The strip above is subtle; implement it exactly:
function codeSpanContent(raw) {
  let content = raw.replace(/\n/g, ' ');
  if (content.length > 0 && content[0] === ' ' && content[content.length - 1] === ' ') {
    // strip one leading and one trailing space only if not all spaces
    if (/[^ ]/.test(content)) content = content.slice(1, -1);
  }
  return content;
}

// ---------- autolink <...> ----------
function tryAutolink(s, i) {
  const n = s.length;
  if (s[i] !== '<') return null;
  // <scheme:...>
  let j = i + 1;
  if (j < n && isAlphaCh(s[j])) {
    let k = j + 1;
    while (k < n && (isAlnumCh(s[k]) || s[k] === '+' || s[k] === '.' || s[k] === '-')) k++;
    const schemeLen = k - j;
    if (schemeLen >= 2 && schemeLen <= 32 && s[k] === ':') {
      let m = k + 1;
      while (m < n && s[m] !== '>' && s[m] !== ' ' && s[m] !== '\n' && s[m] !== '<') m++;
      if (m < n && s[m] === '>' && m > k + 1) {
        const text = s.slice(i + 1, m);
        return { end: m + 1, html: '<a href="' + escHref(text) + '">' + escText(text) + '</a>' };
      }
    }
  }
  // <email>
  let m = i + 1;
  while (m < n && s[m] !== '>' && s[m] !== ' ' && s[m] !== '\n' && s[m] !== '<') m++;
  if (m < n && s[m] === '>') {
    const email = s.slice(i + 1, m);
    if (/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(email)) {
      return { end: m + 1, html: '<a href="mailto:' + escHref(email) + '">' + escText(email) + '</a>' };
    }
  }
  return null;
}

// ---------- extended autolinks (GFM) ----------
const EXT_PUNCT = '?!.,:;*_\'"~';
function backpedalUrl(url) {
  // strip trailing punctuation and unmatched ')'
  let end = url.length;
  while (end > 0) {
    const c = url[end - 1];
    if (c === ';') {
      // If it ends an entity reference, strip back to the '&'.
      const amp = url.lastIndexOf('&', end - 1);
      if (amp >= 0 && /^&[A-Za-z0-9#]+;$/.test(url.slice(amp, end))) { end = amp; continue; }
    }
    if (EXT_PUNCT.indexOf(c) >= 0) { end--; continue; }
    if (c === ')') {
      // A trailing ')' is kept iff it closes an open paren: scan the
      // URL before it, tracking depth ('(' opens, ')' closes only when
      // depth > 0). An unmatched ')' in the middle does not count
      // against the trailing one.
      let depth = 0;
      for (let i = 0; i < end - 1; i++) {
        if (url[i] === '(') depth++;
        else if (url[i] === ')' && depth > 0) depth--;
      }
      if (depth === 0) { end--; continue; }
    }
    break;
  }
  return url.slice(0, end);
}
function isDomainChar(c) { return isAlnumCh(c) || c === '-'; }
// True if the paren group starting at s[p] === '(' contains a space
// before its matching ')'. Used to tell a titled link dest apart from a
// title-less one.
function hasSpaceInParens(s, p) {
  let depth = 0;
  for (let q = p; q < s.length; q++) {
    const c = s[q];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return false; }
    else if (c === ' ' || c === '\t' || c === '\n') return true;
    if (c === '\n') return false;
  }
  return false;
}
function tryExtAutolink(s, i, inLink) {
  if (inLink) return null;
  const n = s.length;
  // boundary: previous char must be start, whitespace, or punctuation (not alnum)
  if (i > 0) {
    const prev = s[i - 1];
    if (isAlnumCh(prev)) return null;
  }
  // www. ...
  if (s.startsWith('www.', i)) {
    let j = i + 4;
    // domain: labels of alnum/hyphen separated by '.', must contain at least one '.' with a valid TLD
    let k = j, labels = 0, lastDot = -1, ok = false;
    while (k < n) {
      const c = s[k];
      if (isDomainChar(c)) { k++; continue; }
      if (c === '.') {
        if (k === j || s[k - 1] === '.' || s[k - 1] === '-') { k++; continue; }
        if (k + 1 >= n || !isDomainChar(s[k + 1])) break; // trailing dot
        labels++; lastDot = k; k++; continue;
      }
      break;
    }
    if (lastDot > j && k > lastDot + 1) {
      // TLD: the last label must be letters (at least 2?) — GFM requires a valid domain; check last label is all letters
      const tld = s.slice(lastDot + 1, k);
      if (/^[A-Za-z]+$/.test(tld) && labels >= 1) ok = true;
    }
    if (ok) {
      // rest: non-space chars
      let m = k;
      while (m < n && !isSpaceCh(s[m]) && s[m].charCodeAt(0) >= 32 && s[m] !== '<') m++;
      let url = s.slice(i, m);
      // A '](' ends the URL (the ']' is kept, the '(' and after are not)
      // — but ONLY when the '(...)' holds a space before its closing
      // paren (a dest with a title): a bare URL never swallows a
      // following titled link destination. A title-less dest stays part
      // of the autolink.
      const bp = url.indexOf('](');
      if (bp >= 0 && hasSpaceInParens(s, i + bp + 1)) url = url.slice(0, bp + 1);
      url = backpedalUrl(url);
      if (url.length > 4) {
        return { end: i + url.length, html: '<a href="http://' + escHref(url) + '">' + escText(url) + '</a>' };
      }
    }
    return null;
  }
  // scheme:... (letter + 1-31 alnum/+/./- then ':')
  if (isAlphaCh(s[i])) {
    let k = i + 1;
    while (k < n && (isAlnumCh(s[k]) || s[k] === '+' || s[k] === '.' || s[k] === '-')) k++;
    const schemeLen = k - i;
    if (schemeLen >= 2 && schemeLen <= 32 && s[k] === ':') {
      let m = k + 1;
      while (m < n && !isSpaceCh(s[m]) && s[m].charCodeAt(0) >= 32 && s[m] !== '<') m++;
      if (m > k + 1) {
        let url = s.slice(i, m);
        // A '](' ends the URL (the ']' is kept, the '(' and after are not)
        // — but ONLY when the '(...)' holds a space before its closing
        // paren (a dest with a title): a bare URL never swallows a
        // following titled link destination. A title-less dest stays part
        // of the autolink.
        const bp = url.indexOf('](');
        if (bp >= 0 && hasSpaceInParens(s, i + bp + 1)) url = url.slice(0, bp + 1);
        // An email-like target whose domain ends in '-' or '_' is not an
        // autolink (checked BEFORE backpedaling strips the trailing char).
        {
          const schemeEnd0 = url.indexOf(':') + 1;
          const atIdx = url.lastIndexOf('@');
          if (atIdx > schemeEnd0) {
            const domEnd = url.indexOf('/', atIdx);
            const domain = url.slice(atIdx + 1, domEnd < 0 ? url.length : domEnd);
            if (domain.endsWith('-') || domain.endsWith('_')) return null;
          }
        }
        url = backpedalUrl(url);
        // A user@domain authority (no '//') allows at most one path segment;
        // a trailing '/' with no segment is dropped.
        const schemeEnd = url.indexOf(':') + 1;
        const rest = url.slice(schemeEnd);
        const firstSlash = rest.indexOf('/');
        if (firstSlash >= 0 && rest.slice(0, firstSlash).indexOf('@') >= 0) {
          const secondSlash = rest.indexOf('/', firstSlash + 1);
          if (secondSlash >= 0) url = url.slice(0, schemeEnd + secondSlash);
          if (url.endsWith('/')) url = url.slice(0, -1);
        }
        // The rest after ':' must contain at least one alphanumeric char;
        // a lone '\' (hard-break marker) is not a URL.
        {
          const r = url.slice(schemeLen + 1);
          let hasAlnum = false;
          for (let q = 0; q < r.length; q++) if (isAlnumCh(r[q])) { hasAlnum = true; break; }
          if (!hasAlnum) return null;
        }
        if (url.length > schemeLen + 1) {
          return { end: i + url.length, html: '<a href="' + escHref(url) + '">' + escText(url) + '</a>' };
        }
      }
    }
  }
  return null;
}
// Bare email: try at position i (start of a local part). Returns autolink or null.
function tryEmailAutolink(s, i, inLink) {
  if (inLink) return null;
  const n = s.length;
  if (i > 0) {
    const prev = s[i - 1];
    if (isAlnumCh(prev) || '.!#$%&\'*+-/=?^_`{|}~'.indexOf(prev) >= 0) return null;
  }
  if (!isAlnumCh(s[i])) return null;
  // local part
  let j = i;
  while (j < n && (isAlnumCh(s[j]) || '.!#$%&\'*+-/=?^_`{|}~'.indexOf(s[j]) >= 0)) j++;
  if (j >= n || s[j] !== '@') return null;
  // domain
  let k = j + 1;
  let labels = 0, lastDot = -1;
  while (k < n) {
    const c = s[k];
    if (isAlnumCh(c) || c === '-') { k++; continue; }
    if (c === '.') {
      if (k + 1 >= n || !(isAlnumCh(s[k + 1]) || s[k + 1] === '-')) break; // trailing dot
      labels++; lastDot = k; k++; continue;
    }
    break;
  }
  if (lastDot < 0 || k <= lastDot + 1) return null;
  const tld = s.slice(lastDot + 1, k);
  if (!/^[A-Za-z]+$/.test(tld)) return null;
  // not followed by a word char, '-' or '_'
  if (k < n && (isAlnumCh(s[k]) || s[k] === '-' || s[k] === '_')) return null;
  const email = s.slice(i, k);
  return { end: k, html: '<a href="mailto:' + escHref(email) + '">' + escText(email) + '</a>' };
}

// ---------- links ----------
// Be check: a link whose label contains a '<' starting a tag/autolink that runs past
// the label's end fails.
function beCheckFails(s, labelStart, labelEnd) {
  for (let p = labelStart; p < labelEnd; p++) {
    if (s[p] !== '<') continue;
    const tagEnd = scanHtmlTag(s, p);
    if (tagEnd > 0) { if (tagEnd > labelEnd) return true; continue; }
    const al = tryAutolink(s, p);
    if (al && al.end > labelEnd) return true;
  }
  return false;
}
// Plain-text rendering of inline content (for image alt text): tags stripped,
// entities resolved, escapes resolved.
function inlineText(s, refs) {
  let out = '', i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '\\' && i + 1 < n && isAsciiPunctCh(s[i + 1])) { out += s[i + 1]; i += 2; continue; }
    if (c === '`') {
      let j = i; while (j < n && s[j] === '`') j++;
      const len = j - i;
      let k = j, found = -1;
      while (k < n) {
        if (s[k] === '`') {
          let m = k; while (m < n && s[m] === '`') m++;
          if (m - k === len) { found = m; break; }
          k = m;
        } else k++;
      }
      if (found >= 0) { out += codeSpanContent(s.slice(j, found - len)); i = found; continue; }
      out += s.slice(i, j); i = j; continue;
    }
    if (c === '<') {
      const tagEnd = scanHtmlTag(s, i);
      if (tagEnd > 0) { i = tagEnd; continue; }
      const al = tryAutolink(s, i);
      if (al) { out += s.slice(i + 1, al.end - 1); i = al.end; continue; }
      out += c; i++; continue;
    }
    if (c === '[' || (c === '!' && s[i + 1] === '[')) {
      const isImage = c === '!';
      const lbStart = isImage ? i + 1 : i;
      const lb = scanLabel(s, lbStart);
      if (lb && !labelHasLink(lb.content, refs)) {
        const after = lb.end;
        if (after < n && s[after] === '(') {
          const d = scanInlineDest(s, after);
          if (d) { out += inlineText(lb.content, refs); i = d.end; continue; }
        } else if (after < n && s[after] === '[') {
          const ref = scanLabel(s, after);
          if (ref && refs.has(normalizeLabel(ref.content === '' ? lb.content : ref.content))) {
            out += inlineText(lb.content, refs); i = ref.end; continue;
          }
        } else if (refs.has(normalizeLabel(lb.content))) {
          out += inlineText(lb.content, refs); i = lb.end; continue;
        }
      }
      out += c; i++; continue;
    }
    if (c === '*' || c === '_') {
      const masked = buildMasked(s, refs);
      const v = lastCloserIndex(masked, c);
      const m = matchEmStrong(s, masked, i, c, v);
      if (m) { out += inlineText(m.inner, refs); i = m.end; continue; }
      out += c; i++; continue;
    }
    if (c === '~') {
      const masked = buildMasked(s, refs);
      const v = lastCloserIndex(masked, '~');
      const m = matchDel(s, masked, i, v);
      if (m) { out += inlineText(m.inner, refs); i = m.end; continue; }
      out += c; i++; continue;
    }
    out += c; i++;
  }
  return escAttr(out);
}
// True if parsing s as inline would emit a link or image (a link cannot
// contain another link/image, so an outer link whose label contains one fails).
// Only EXPLICIT links/images count: autolinks (bare email / www / scheme)
// inside a label are plain text, not nested links.
function labelHasLink(s, refs) {
  const st = { inLink: false, inRawBlock: false, linkEmitted: false };
  const html = inlineParse(s, refs, st);
  return st.linkEmitted || html.indexOf('<img ') >= 0;
}
function finishLink(s, i, lb, dest, title, isImage, refs, state, end) {
  const labelStart = (isImage ? i + 1 : i) + 1;
  if (beCheckFails(s, labelStart, lb.end - 1)) return null;
  const label = lb.content;
  const titleAttr = (title !== null && title !== undefined) ? ' title="' + escAttr(title) + '"' : '';
  if (isImage) {
    const alt = inlineText(label, refs);
    return { end, html: '<img src="' + escHref(dest) + '" alt="' + alt + '"' + titleAttr + '>' };
  }
  if (state.inLink) return null;
  const child = { inLink: false, inRawBlock: false, linkEmitted: false, noExtAutolink: true };
  const text = inlineParse(label, refs, child);
  if (child.linkEmitted) return null;
  state.linkEmitted = true;
  return { end, html: '<a href="' + escHref(dest) + '"' + titleAttr + '>' + text + '</a>' };
}
function tryLink(s, i, refs, state) {
  const n = s.length;
  const isImage = s[i] === '!';
  const lbStart = isImage ? i + 1 : i;
  if (s[lbStart] !== '[') return null;
  const lb = scanLabel(s, lbStart);
  if (!lb) return null;
  const label = lb.content;
  const after = lb.end;
  if (after < n && s[after] === '(') {
    const d = scanInlineDest(s, after);
    if (d) return finishLink(s, i, lb, d.dest, d.title, isImage, refs, state, d.end);
    // Inline destination failed: fall back to a shortcut reference link.
    const r0 = refs.get(normalizeLabel(label));
    if (r0) return finishLink(s, i, lb, r0.dest, r0.title, isImage, refs, state, lb.end);
    return null;
  }
  if (after < n && s[after] === '[') {
    const ref = scanLabel(s, after);
    if (ref) {
      const key = normalizeLabel(ref.content === '' ? label : ref.content);
      const r = refs.get(key);
      if (r) return finishLink(s, i, lb, r.dest, r.title, isImage, refs, state, ref.end);
    }
    return null;
  }
  const r = refs.get(normalizeLabel(label));
  if (r) return finishLink(s, i, lb, r.dest, r.title, isImage, refs, state, lb.end);
  return null;
}

// ---------- plain text run ----------
// Consume a run of plain text starting at i, stopping at the next tokenizer boundary
// (special char, hard break, or a validated autolink start). Returns {end, html}.
function textRun(s, i, refs, state) {
  const n = s.length;
  let j = i;
  let end = n;
  while (j < n) {
    const c = s[j];
    if (c === '`' || c === '\\' || c === '<' || c === '[' || c === '*' || c === '_' || c === '~') { end = j; break; }
    if (c === '!' && s[j + 1] === '[') { end = j; break; }
    if (c === ' ' || c === '\t') {
      let k = j;
      while (k < n && (s[k] === ' ' || s[k] === '\t')) k++;
      if (k < n && s[k] === '\n' && k - j >= 2 && k + 1 < n) { end = j; break; }
      j = k; continue;
    }
    if (!state.inLink && !state.noExtAutolink) {
      if (c === 'w' && s.startsWith('www.', j)) {
        const prev = j === 0 ? '' : s[j - 1];
        if ((prev === '' || !isAlnumCh(prev)) && tryExtAutolink(s, j, false)) { end = j; break; }
      }
      if (isAlphaCh(c) && (j === 0 || !isAlnumCh(s[j - 1]))) {
        if (tryExtAutolink(s, j, false)) { end = j; break; }
        if (tryEmailAutolink(s, j, false)) { end = j; break; }
      }
      if (c === '@') {
        let e = j - 1;
        while (e >= i && (isAlnumCh(s[e]) || '.!#$%&\'*+-/=?^_`{|}~'.indexOf(s[e]) >= 0)) e--;
        e++;
        if (e >= i && tryEmailAutolink(s, e, false)) { end = e; break; }
      }
    }
    j++;
  }
  const html = escText(s.slice(i, end));
  return { end, html };
}

// ---------- inline parser ----------
// state: {inLink, inRawBlock, rawTag, linkEmitted}. Mutates linkEmitted.
function inlineParse(s, refs, state) {
  if (s === '') return '';
  if (!state) state = { inLink: false, inRawBlock: false, rawTag: '', linkEmitted: false };
  const masked = buildMasked(s, refs);
  const vStar = lastCloserIndex(masked, '*');
  const vUnder = lastCloserIndex(masked, '_');
  const vTilde = lastCloserIndex(masked, '~');
  const out = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (state.inRawBlock) {
      const lower = s.toLowerCase();
      const needle = '</' + state.rawTag;
      let k = lower.indexOf(needle, i);
      let found = -1;
      while (k >= 0) {
        let m = k + needle.length;
        while (m < n && isSpaceCh(s[m])) m++;
        if (s[m] === '>') { found = k; break; }
        k = lower.indexOf(needle, m);
      }
      if (found < 0) { out.push(s.slice(i)); i = n; break; }
      out.push(s.slice(i, found));
      let m = found + needle.length;
      while (m < n && isSpaceCh(s[m])) m++;
      out.push(s.slice(found, m + 1));
      i = m + 1;
      state.inRawBlock = false;
      state.rawTag = null;
      continue;
    }
    if (c === '\\') {
      if (i + 1 < n && s[i + 1] === '\n') {
        if (i + 2 < n) {
          out.push('<br>');
          i += 2;
          while (i < n && (s[i] === ' ' || s[i] === '\t')) i++;
          continue;
        }
        out.push('\\'); i++; continue;
      }
      if (i + 1 < n && isAsciiPunctCh(s[i + 1])) { out.push(esc(s[i + 1])); i += 2; continue; }
      out.push('\\'); i++; continue;
    }
    if (c === '<') {
      const tagEnd = scanHtmlTag(s, i);
      if (tagEnd > 0) {
        const tag = s.slice(i, tagEnd);
        out.push(tag);
        const tm = /^<\/?([A-Za-z][A-Za-z0-9-]*)/.exec(tag);
        if (tm) {
          const name = tm[1].toLowerCase();
          const isClose = tag[1] === '/';
          if (!isClose && (name === 'pre' || name === 'script' || name === 'style')) {
            state.inRawBlock = true; state.rawTag = name;
          } else if (isClose && (name === 'pre' || name === 'script' || name === 'style')) {
            state.inRawBlock = false; state.rawTag = null;
          }
          if (!isClose && name === 'a') state.inLink = true;
          if (isClose && name === 'a') state.inLink = false;
        }
        i = tagEnd; continue;
      }
      const al = tryAutolink(s, i);
      if (al) { out.push(al.html); i = al.end; continue; }
      out.push('&lt;'); i++; continue;
    }
    if (c === '[' || (c === '!' && s[i + 1] === '[')) {
      const lk = tryLink(s, i, refs, state);
      if (lk) { out.push(lk.html); i = lk.end; continue; }
      out.push(c === '!' ? '!' : '[');
      i++;
      continue;
    }
    if (c === '*' || c === '_') {
      const v = c === '*' ? vStar : vUnder;
      const m = matchEmStrong(s, masked, i, c, v);
      if (m) {
        const child = { inLink: state.inLink, inRawBlock: false, linkEmitted: false, noExtAutolink: state.noExtAutolink };
        const inner = inlineParse(m.inner, refs, child);
        if (child.linkEmitted) state.linkEmitted = true;
        out.push('<' + m.tag + '>' + inner + '</' + m.tag + '>');
        i = m.end;
        continue;
      }
      out.push(c); i++; continue;
    }
    if (c === '`') {
      const cs = tryCodeSpan(s, i);
      if (cs) { out.push(cs.html); i = cs.end; continue; }
      // No closing run of this length: the whole run is literal (never a
      // shorter run inside it).
      let j = i; while (j < n && s[j] === '`') j++;
      out.push(s.slice(i, j)); i = j; continue;
    }
    if (c === '~') {
      const m = matchDel(s, masked, i, vTilde);
      if (m) {
        const child = { inLink: state.inLink, inRawBlock: false, linkEmitted: false, noExtAutolink: state.noExtAutolink };
        const inner = inlineParse(m.inner, refs, child);
        if (child.linkEmitted) state.linkEmitted = true;
        out.push('<del>' + inner + '</del>');
        i = m.end;
        continue;
      }
      out.push('~'); i++; continue;
    }
    if (c === ' ' || c === '\t') {
      let j = i;
      while (j < n && (s[j] === ' ' || s[j] === '\t')) j++;
      if (j < n && s[j] === '\n' && j - i >= 2 && j + 1 < n) {
        out.push('<br>');
        i = j + 1;
        while (i < n && (s[i] === ' ' || s[i] === '\t')) i++;
        continue;
      }
    }
    if (!state.inLink && !state.noExtAutolink && isAlphaCh(c)) {
      const ea = tryExtAutolink(s, i, false);
      if (ea) { out.push(ea.html); i = ea.end; continue; }
      const em = tryEmailAutolink(s, i, false);
      if (em) { out.push(em.html); i = em.end; continue; }
    }
    const run = textRun(s, i, refs, state);
    out.push(run.html);
    i = run.end;
  }
  return out.join('');
}

// ---------- block parsing ----------
function isBlank(line) { return /^[ \t]*$/.test(line); }
function indentCols(line) {
  let col = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === ' ') col++;
    else if (line[i] === '\t') col += 4 - (col % 4);
    else break;
  }
  return col;
}
function stripCols(line, cols) {
  let col = 0, i = 0;
  while (i < line.length && col < cols) {
    if (line[i] === ' ') { col++; i++; }
    else if (line[i] === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= cols) { col += w; i++; }
      else return ' '.repeat(w - (cols - col)) + line.slice(i + 1);
    } else break;
  }
  return line.slice(i);
}
// Fenced-code content stripping: a tab overlapping the stripped region is
// removed entirely (no partial-space remainder), unlike stripCols.
function stripFenceCols(line, cols) {
  let col = 0, i = 0;
  while (i < line.length && col < cols) {
    if (line[i] === ' ') { col++; i++; }
    else if (line[i] === '\t') { col += 4 - (col % 4); i++; }
    else break;
  }
  return line.slice(i);
}
// Fenced code: returns {marker, len, info} or null.
function matchFence(line) {
  const ind = indentCols(line);
  if (ind > 3) return null;
  const rest = stripCols(line, ind);
  const m = /^(`{3,}|~{3,})/.exec(rest);
  if (!m) return null;
  const marker = m[1][0], len = m[1].length;
  const info = rest.slice(len).trim();
  if (marker === '`' && info.indexOf('`') >= 0) return null;
  return { marker, len, info };
}
// ATX heading: returns {level, text} or null.
function matchATX(line) {
  const ind = indentCols(line);
  if (ind > 3) return null;
  const rest = stripCols(line, ind);
  const m = /^(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/.exec(rest);
  if (!m) return null;
  let text = m[2] === undefined ? '' : m[2].trim();
  text = text.replace(/[ \t]+#+$/, '');
  if (/^#+$/.test(text)) text = '';
  return { level: m[1].length, text };
}
// Thematic break.
function matchHR(line) {
  const ind = indentCols(line);
  if (ind > 3) return null;
  const rest = stripCols(line, ind).replace(/[ \t]/g, '');
  if (rest.length < 3) return null;
  const c = rest[0];
  if (c !== '-' && c !== '_' && c !== '*') return null;
  for (let i = 0; i < rest.length; i++) if (rest[i] !== c) return null;
  return { ch: c };
}
// Blockquote marker: returns content after '>' (+ optional one space) or null.
function matchBlockquote(line) {
  const ind = indentCols(line);
  if (ind > 3) return null;
  const rest = stripCols(line, ind);
  if (rest[0] !== '>') return null;
  // '>' is at column ind; the optional single space after it is 1 column.
  const content = stripAndExpand(rest.slice(1), 1, ind + 1);
  return { content };
}
// List marker: returns info or null.
function matchListMarker(line) {
  const ind = indentCols(line);
  if (ind > 3) return null;
  const rest = stripCols(line, ind);
  let m = /^([*+-])(?:[ \t]+|$)/.exec(rest);
  if (m) {
    const after = rest.slice(1);
    let sp = 0, k = 0, col = ind + 1;
    while (k < after.length && (after[k] === ' ' || after[k] === '\t')) {
      if (after[k] === ' ') { sp++; col++; k++; }
      else { const w = 4 - (col % 4); sp += w; col += w; k++; }
    }
    const empty = after.trim() === '';
    const contentIndent = (empty || sp >= 5) ? ind + 2 : ind + 1 + sp;
    return { ordered: false, start: null, contentIndent, bullet: m[1], indent: ind };
  }
  m = /^(\d{1,9})([.)])(?:[ \t]+|$)/.exec(rest);
  if (m) {
    const markerLen = m[1].length + 1;
    const after = rest.slice(markerLen);
    let sp = 0, k = 0, col = ind + markerLen;
    while (k < after.length && (after[k] === ' ' || after[k] === '\t')) {
      if (after[k] === ' ') { sp++; col++; k++; }
      else { const w = 4 - (col % 4); sp += w; col += w; k++; }
    }
    const empty = after.trim() === '';
    const contentIndent = (empty || sp >= 5) ? ind + markerLen + 1 : ind + markerLen + sp;
    return { ordered: true, start: parseInt(m[1], 10), contentIndent, delim: m[2], indent: ind };
  }
  return null;
}
// HTML block start type (1-7) or 0. Type 7 cannot interrupt a paragraph.
// Block-level tag names (CommonMark). pre/script/style/textarea are type 1.
const BLOCK_TAGS = /^(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)$/;
const TYPE1_TAGS = /^(?:script|pre|style|textarea)$/;
function htmlBlockType(line) {
  const ind = indentCols(line);
  if (ind > 3) return 0;
  const rest = stripCols(line, ind);
  if (/^<(?:script|pre|style|textarea)(?:[ \t>]|$)/i.test(rest)) return 1;
  if (/^<!--/.test(rest)) return 2;
  if (/^<\?/.test(rest)) return 3;
  if (/^<![A-Za-z]/.test(rest)) return 4;
  if (/^<!\[CDATA\[/.test(rest)) return 5;
  // A tag start: <name or </name, name followed by whitespace, >, /, or EOL.
  const tm = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[ \t/>]|$)/.exec(rest);
  if (tm) {
    const name = tm[1].toLowerCase();
    const isClose = rest[1] === '/';
    // The whole line is a single complete tag (with attributes) and nothing else.
    // A closing tag takes no attributes.
    const completeTag = isClose
      ? /^<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>$/.test(rest.trim())
      : /^<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ \t"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>$/.test(rest.trim());
    if (!isClose && TYPE1_TAGS.test(name)) return 1;
    if (BLOCK_TAGS.test(name)) {
      // A closing tag of a type-1 element, alone on its line, is type 7.
      if (isClose && TYPE1_TAGS.test(name) && completeTag) return 7;
      return 6;
    }
    // Non-block tag: a complete tag alone on its line is type 7.
    if (completeTag) return 7;
    return 0;
  }
  return 0;
}
function htmlBlockEnds(type, line) {
  if (type === 1) return /<\/(?:script|pre|style|textarea)>/i.test(line);
  if (type === 2) return /-->/.test(line);
  if (type === 3) return /\?>/.test(line);
  if (type === 4) return />/.test(line);
  if (type === 5) return /\]\]>/.test(line);
  return false; // types 6, 7 end at a blank line
}
// Table delimiter row: returns alignments array ('l','c','r',null) or null.
function tableDelim(line) {
  const ind = indentCols(line);
  if (ind > 3) return null;
  const rest = stripCols(line, ind).trim();
  if (rest.indexOf('|') < 0 && rest.indexOf('-') < 0) return null;
  let s = rest;
  if (s[0] === '|') s = s.slice(1);
  if (s[s.length - 1] === '|') s = s.slice(0, -1);
  const cells = s.split('|');
  if (cells.length === 0) return null;
  const aligns = [];
  for (const cell of cells) {
    const t = cell.trim();
    if (!/^:?-+:?$/.test(t)) return null;
    if (t[0] === ':' && t[t.length - 1] === ':') aligns.push('c');
    else if (t[t.length - 1] === ':') aligns.push('r');
    else if (t[0] === ':') aligns.push('l');
    else aligns.push(null);
  }
  return aligns;
}
// Split a table row into cells (handles escaped pipes and code spans).
function splitTableRow(line) {
  let s = line.trim();
  if (s[0] === '|') s = s.slice(1);
  if (s[s.length - 1] === '|' && s[s.length - 2] !== '\\') s = s.slice(0, -1);
  const cells = [];
  let cur = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && s[i + 1] === '|') { cur += '|'; i += 2; continue; }
    if (c === '`') {
      let j = i; while (j < s.length && s[j] === '`') j++;
      const len = j - i;
      let k = j, found = -1;
      while (k < s.length) {
        if (s[k] === '`') {
          let m = k; while (m < s.length && s[m] === '`') m++;
          if (m - k === len) { found = m; break; }
          k = m;
        } else k++;
      }
      if (found >= 0) { cur += s.slice(i, found).replace(/\\\|/g, '|'); i = found; continue; }
      cur += c; i++; continue;
    }
    if (c === '|') { cells.push(cur); cur = ''; i++; continue; }
    cur += c; i++;
  }
  cells.push(cur);
  return cells.map(x => x.trim());
}
// A line that starts a block which can interrupt a paragraph (for lazy continuation).
function isBlockStart(line) {
  if (matchFence(line)) return true;
  if (matchATX(line)) return true;
  if (matchHR(line)) return true;
  if (matchBlockquote(line)) return true;
  if (matchListMarker(line)) return true;
  if (htmlBlockType(line) > 0) return true;
  return false;
}

// ---------- link reference definitions ----------
// Scan a refdef label: it ends at the FIRST ']' (no bracket nesting), and
// must be non-empty after label normalisation.
function scanRefdefLabel(text, i) {
  let j = i + 1;
  const start = j;
  while (j < text.length) {
    const c = text[j];
    if (c === '\\' && j + 1 < text.length) { j += 2; continue; }
    if (c === '`') {
      let k = j; while (k < text.length && text[k] === '`') k++;
      const len = k - j;
      let m = k, found = -1;
      while (m < text.length) {
        if (text[m] === '`') {
          let n2 = m; while (n2 < text.length && text[n2] === '`') n2++;
          if (n2 - m === len) { found = n2; break; }
          m = n2;
        } else m++;
      }
      if (found < 0) return null;
      j = found; continue;
    }
    if (c === ']') {
      const content = text.slice(start, j);
      if (content.length > 999) return null;
      return { end: j + 1, content };
    }
    j++;
    if (j - start > 999) return null;
  }
  return null;
}
function tryParseRefdef(text, pos) {
  let i = pos, spaces = 0;
  while (i < text.length && text[i] === ' ' && spaces < 3) { i++; spaces++; }
  if (text[i] !== '[') return null;
  const lb = scanRefdefLabel(text, i);
  if (!lb || text[lb.end] !== ':' || normalizeLabel(lb.content) === '' || lb.content.replace(/\\./g, '').indexOf('[') >= 0) return null;
  let j = lb.end + 1;
  // skip whitespace incl. at most one newline before the dest
  let k = j, nl = 0;
  while (k < text.length && isSpaceCh(text[k])) {
    if (text[k] === '\n') { nl++; if (nl > 1) return null; }
    k++;
  }
  if (k >= text.length) return null;
  let dest;
  if (text[k] === '<') {
    let m = k + 1;
    while (m < text.length && text[m] !== '>' && text[m] !== '\n') { if (text[m] === '<') return null; m++; }
    if (text[m] !== '>') return null;
    dest = resolveEscapes(text.slice(k + 1, m));
    j = m + 1;
  } else {
    let m = k, depth = 0;
    while (m < text.length) {
      const c = text[m];
      if (isSpaceCh(c) || c.charCodeAt(0) < 32) break;
      if (c === '\\' && m + 1 < text.length && isAsciiPunctCh(text[m + 1])) { m += 2; continue; }
      if (c === '(') { depth++; m++; continue; }
      if (c === ')') { if (depth === 0) break; depth--; m++; continue; }
      m++;
    }
    if (m === k) return null;
    dest = resolveEscapes(text.slice(k, m));
    j = m;
  }
  // End of the dest line (dest-only fallback): skip spaces/tabs to EOL.
  let destLineEnd = j;
  while (destLineEnd < text.length && (text[destLineEnd] === ' ' || text[destLineEnd] === '\t')) destLineEnd++;
  const destOnlyEnd = (destLineEnd < text.length && text[destLineEnd] === '\n') ? destLineEnd + 1 : destLineEnd;
  const destOnly = { end: destOnlyEnd, label: lb.content, dest, title: null };
  // Title on the same line (requires >= 1 space/tab before it).
  let k2 = j, hadSpace = false;
  while (k2 < text.length && (text[k2] === ' ' || text[k2] === '\t')) { k2++; hadSpace = true; }
  if (hadSpace && k2 < text.length && (text[k2] === '"' || text[k2] === "'" || text[k2] === '(')) {
    const t = scanTitle(text, k2);
    if (t) {
      let k3 = t.end;
      while (k3 < text.length && (text[k3] === ' ' || text[k3] === '\t')) k3++;
      if (k3 >= text.length || text[k3] === '\n') {
        let end = k3;
        if (text[end] === '\n') end++;
        return { end, label: lb.content, dest, title: t.title };
      }
    }
    return null; // same-line title malformed or followed by junk -> whole refdef fails
  }
  if (k2 < text.length && text[k2] !== '\n') return null; // junk after the dest
  // Title on the next line (any indentation).
  let k4 = destOnlyEnd;
  while (k4 < text.length && (text[k4] === ' ' || text[k4] === '\t')) k4++;
  if (k4 < text.length && (text[k4] === '"' || text[k4] === "'" || text[k4] === '(')) {
    const t = scanTitle(text, k4);
    if (t) {
      let k5 = t.end;
      while (k5 < text.length && (text[k5] === ' ' || text[k5] === '\t')) k5++;
      if (k5 >= text.length || text[k5] === '\n') {
        let end = k5;
        if (text[end] === '\n') end++;
        return { end, label: lb.content, dest, title: t.title };
      }
    }
    return destOnly;
  }
  return destOnly;
}
// Strip leading refdefs from a paragraph's lines. Returns remaining lines (null = all consumed).
function stripRefdefs(lines, refs) {
  let text = lines.join('\n');
  let pos = 0;
  while (true) {
    // skip blank lines between refdefs? No — a blank line ends the refdef sequence.
    const r = tryParseRefdef(text, pos);
    if (!r) break;
    const key = normalizeLabel(r.label);
    if (key && !refs.has(key)) refs.set(key, { dest: r.dest, title: r.title });
    pos = r.end;
  }
  if (pos === 0) return lines;
  const rest = text.slice(pos);
  if (rest.trim() === '') return null;
  return rest.split('\n');
}
// Remove the first `cols` columns of a line (tabs expand to the next multiple
// of 4); unlike stripCols this also cuts through non-whitespace (a marker).
function sliceCols(line, cols) {
  let col = 0, i = 0;
  while (i < line.length && col < cols) {
    if (line[i] === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= cols) { col += w; i++; }
      else return ' '.repeat(w - (cols - col)) + line.slice(i + 1);
    } else { col++; i++; }
  }
  return line.slice(i);
}
// Remove the first `cols` columns starting at original column `startCol`
// (tabs expand by original column). A partially-consumed tab becomes spaces,
// and any remaining leading tabs are expanded to spaces using their original
// columns. Tabs after the leading whitespace are preserved.
function stripAndExpand(line, cols, startCol) {
  const target = startCol + cols;
  let col = startCol, i = 0, out = '';
  while (i < line.length && col < target) {
    const ch = line[i];
    if (ch === ' ') { col++; i++; }
    else if (ch === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= target) { col += w; i++; }
      else { out += ' '.repeat(col + w - target); col = col + w; i++; break; }
    } else break;
  }
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    if (line[i] === ' ') { out += ' '; col++; i++; }
    else { const w = 4 - (col % 4); out += ' '.repeat(w); col += w; i++; }
  }
  return out + line.slice(i);
}
// Remove the first `cols` columns of any content starting at original column
// `startCol` (tabs expand by original column). A partially-consumed tab
// becomes spaces; remaining leading tabs are expanded to spaces using their
// original columns. Tabs after the leading whitespace are preserved.
function sliceAndExpand(line, cols, startCol) {
  const target = startCol + cols;
  let col = startCol, i = 0, out = '';
  while (i < line.length && col < target) {
    const ch = line[i];
    if (ch === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= target) { col += w; i++; }
      else { out += ' '.repeat(col + w - target); col = col + w; i++; break; }
    } else { col++; i++; }
  }
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    if (line[i] === ' ') { out += ' '; col++; i++; }
    else { const w = 4 - (col % 4); out += ' '.repeat(w); col += w; i++; }
  }
  return out + line.slice(i);
}
// ---------- container collection ----------
// A lazy continuation line that looks like a setext underline cannot be one;
// it stays paragraph text, indented by 4 spaces so the recursive parse won't
// treat it as an underline.
function lazyLine(line) {
  if (/^[ \t]*([=]+|[-]+)[ \t]*$/.test(line)) return '    ' + line.trim();
  return line;
}
// Does the given content (already collected) end with an open paragraph?
// Drills through nested quotes and lists to the innermost last block, so a
// lazy line can propagate to the innermost paragraph.
function endsWithParagraph(contentLines, refs, inListItem) {
  if (contentLines.length === 0) return false;
  const blocks = parseBlocks(contentLines, refs, false, false, inListItem);
  if (blocks.length === 0) return false;
  let last = blocks[blocks.length - 1];
  for (let depth = 0; depth < 32; depth++) {
    if (last.t === 'quote') {
      if (!last.blocks || last.blocks.length === 0) return false;
      last = last.blocks[last.blocks.length - 1];
    } else if (last.t === 'list') {
      if (!last.items || last.items.length === 0) return false;
      const item = last.items[last.items.length - 1];
      if (!item.blocks || item.blocks.length === 0) return false;
      last = item.blocks[item.blocks.length - 1];
    } else break;
  }
  return last.t === 'para';
}
function collectQuote(lines, i, refs) {
  const qlines = [];
  let j = i;
  while (j < lines.length) {
    const line = lines[j];
    const m = matchBlockquote(line);
    if (m) { qlines.push(m.content); j++; continue; }
    if (isBlank(line)) break; // a truly blank line ends the quote
    // Lazy continuation: only when the quote's content ends with a paragraph.
    // Merge into the paragraph's last line so the re-parse can't reinterpret
    // the lazy text as a new block (e.g. a list marker).
    if (qlines.length > 0 && qlines[qlines.length - 1] !== '' && !isBlockStart(line) && endsWithParagraph(qlines, refs, false)) {
      let content = lazyLine(line);
      if (indentCols(line) >= 4) content = content.trimStart();
      qlines[qlines.length - 1] += '\n' + content; j++; continue;
    }
    break;
  }
  return { qlines, nextI: j };
}
function collectListItem(lines, i, marker, refs) {
  const itemLines = [sliceAndExpand(lines[i], marker.contentIndent, 0)];
  let j = i + 1;
  let fence = null; // open fenced code block: { marker, len }
  let fenceFirst = false; // true until the first non-blank fence content line
  {
    const fm0 = matchFence(itemLines[0]);
    if (fm0) { fence = { marker: fm0.marker, len: fm0.len }; fenceFirst = true; }
  }
  while (j < lines.length) {
    const line = lines[j];
    // Inside a fenced code block, lines are content until the closing fence,
    // even when their indent drops below the list content indent — EXCEPT
    // the fence is truncated (empty) when its FIRST content line is below
    // the content indent.
    if (fence) {
      if (isBlank(line)) { itemLines.push(''); j++; continue; }
      const ind = indentCols(line);
      const pushed = ind >= marker.contentIndent ? sliceAndExpand(line, marker.contentIndent, 0) : line;
      const fm = matchFence(pushed);
      if (fm && fm.marker === fence.marker && fm.len >= fence.len && fm.info === '') {
        itemLines.push(pushed); j++; fence = null; continue;
      }
      if (fenceFirst && ind < marker.contentIndent) {
        // First content line is outside the item: the fence is empty.
        // Re-process this line as ordinary content (it ends the item).
        fence = null;
        continue;
      }
      itemLines.push(pushed); j++; fenceFirst = false; continue;
    }
    if (isBlank(line)) {
      // An empty item (no content yet) closes on a blank line.
      if (itemLines.every(l => isBlank(l))) break;
      // A blank line belongs to the item only if more content of THIS item follows.
      let k = j + 1;
      while (k < lines.length && isBlank(lines[k])) k++;
      if (k < lines.length) {
        const nl = lines[k];
        if (indentCols(nl) >= marker.contentIndent) {
          while (j < k) { itemLines.push(''); j++; }
          continue;
        }
      }
      break;
    }
    const ind = indentCols(line);
    if (ind >= marker.contentIndent) {
      const pushed = sliceAndExpand(line, marker.contentIndent, 0);
      itemLines.push(pushed); j++;
      const fm = matchFence(pushed);
      if (fm) { fence = { marker: fm.marker, len: fm.len }; fenceFirst = true; }
      continue;
    }
    if (itemLines.length > 0 && itemLines[itemLines.length - 1] !== '' && !isBlockStart(line) && endsWithParagraph(itemLines, refs, true)) {
      let content = lazyLine(line);
      if (indentCols(line) >= 4) content = content.trimStart();
      itemLines[itemLines.length - 1] += '\n' + content; j++; continue;
    }
    break;
  }
  return { itemLines, nextI: j };
}

// ---------- main block parser ----------
function parseBlocks(lines, refs, isDoc, srcEndsNL, inListItem) {
  const blocks = [];
  let i = 0;
  let para = null;
  let blankBeforeNext = false;
  // Push a block, recording whether a blank line preceded it (used for
  // list looseness: only a blank between an item's DIRECT blocks counts).
  const pushBlk = (b) => { b.blankBefore = blankBeforeNext; blankBeforeNext = false; blocks.push(b); };
  const closePara = () => {
    if (!para) return;
    const rest = stripRefdefs(para, refs);
    if (rest) pushBlk({ t: 'para', lines: rest });
    else pushBlk({ t: 'refdef' }); // all refdefs: still a block-level element
    para = null;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      // A trailing whitespace-only line inside a container is kept as part of
      // an open paragraph (cm-241); at the top level it is a separator.
      if (line.length > 0 && para && !isDoc && i === lines.length - 1) { para.push(line); i++; continue; }
      closePara(); blankBeforeNext = true; i++; continue;
    }
    const ind = indentCols(line);
    // Setext heading / table delimiter (paragraph open only)
    if (para) {
      const rest = stripCols(line, Math.min(ind, 3));
      const setext = /^([=]+|[-]+)[ \t]*$/.exec(rest);
      if (setext) {
        const stripped = stripRefdefs(para, refs);
        if (stripped) {
          const level = setext[1][0] === '=' ? 1 : 2;
          pushBlk({ t: 'h', level, text: stripped.join('\n').trim() });
          para = null; i++; continue;
        }
        // Paragraph was all refdefs: drop it, re-process this line as new content.
        para = null;
        continue;
      }
      const aligns = tableDelim(line);
      if (aligns) {
        const stripped = stripRefdefs(para, refs);
        if (!stripped) { para = null; continue; }
        const headCells = splitTableRow(stripped.join('\n'));
        if (aligns.length === headCells.length) {
          const rows = [];
          i++;
          // A whitespace-only line ending in exactly one tab is a table row
          // (empty cells), not a blank line; any other blank line ends it.
          const isTabRow = (l) => /^ *\t$/.test(l);
          while (i < lines.length && (!isBlank(lines[i]) || isTabRow(lines[i])) && !isBlockStart(lines[i])) {
            rows.push(splitTableRow(lines[i])); i++;
          }
          pushBlk({ t: 'table', head: headCells, aligns, rows });
          para = null; continue;
        }
      }
    }
    // Indented code (not in a paragraph)
    if (!para && ind >= 4) {
      const codeLines = [];
      while (i < lines.length) {
        const l = lines[i];
        if (isBlank(l)) {
          // look ahead: blank lines are included only if followed by more indented code
          let k = i;
          while (k < lines.length && isBlank(lines[k])) k++;
          if (k < lines.length && indentCols(lines[k]) >= 4 && !para) {
            while (i < k) { codeLines.push(stripCols(lines[i], 4)); i++; }
            continue;
          }
          break;
        }
        if (indentCols(l) >= 4) { codeLines.push(stripCols(l, 4)); i++; continue; }
        break;
      }
      while (codeLines.length > 0 && codeLines[codeLines.length - 1] === '') codeLines.pop();
      pushBlk({ t: 'code', text: codeLines.join('\n') + '\n' });
      continue;
    }
    const rest = stripCols(line, Math.min(ind, 3));
    // Fenced code
    const fence = matchFence(line);
    if (fence) {
      closePara();
      const fenceInd = indentCols(line);
      // Tilde fences do NOT strip the fence indent from content lines
      // (marked quirk); backtick fences strip up to the fence indent.
      const stripN = fence.marker === '~' ? 0 : fenceInd;
      const codeLines = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        const fm = matchFence(l);
        if (fm && fm.marker === fence.marker && fm.len >= fence.len && fm.info === '') { i++; break; }
        codeLines.push(stripFenceCols(l, stripN));
        i++;
      }
      { if (codeLines.length > 0 && codeLines[codeLines.length - 1] === '') codeLines.pop(); pushBlk({ t: 'fence', info: fence.info, text: codeLines.join('\n') + (codeLines.length ? '\n' : '') }); }
      continue;
    }
    // ATX heading
    const atx = matchATX(line);
    if (atx) {
      closePara();
      pushBlk({ t: 'h', level: atx.level, text: atx.text });
      i++; continue;
    }
    // Thematic break
    if (matchHR(line)) {
      closePara();
      pushBlk({ t: 'hr' });
      i++; continue;
    }
    // Blockquote
    if (matchBlockquote(line)) {
      closePara();
      const { qlines, nextI } = collectQuote(lines, i, refs);
      pushBlk({ t: 'quote', blocks: parseBlocks(qlines, refs, false, false, false) });
      i = nextI; continue;
    }
    // List
    const marker = matchListMarker(line);
    if (marker) {
      // List interruption rules: a list cannot interrupt a paragraph if
      // it is an empty item, or (ordered) start != 1.
      const isEmptyItem = rest.slice(marker.ordered ? String(marker.start).length + 1 : 1).trim() === '';
      // An ordered list must start with 1 to interrupt a paragraph, EXCEPT
      // directly inside a list item (any start number may interrupt).
      if (para && (isEmptyItem || (marker.ordered && marker.start !== 1 && !inListItem))) {
        // not an interrupting list: paragraph continuation
        para.push(line); i++; continue;
      }
      closePara();
      const items = [];
      let loose = false;
      let listOrdered = marker.ordered;
      let listStart = marker.start;
      let listBullet = marker.bullet;
      let listDelim = marker.delim;
      let curMarker = marker;
      let prevItemEndedBlank = false;
      let lastSkippedBlank = false;
      while (i < lines.length) {
        if (matchHR(lines[i])) break;
        const m2 = matchListMarker(lines[i]);
        if (!m2) break;
        if (m2.ordered !== listOrdered) break;
        if (!listOrdered && m2.bullet !== listBullet) break;
        if (listOrdered && m2.delim !== listDelim) break;
        if (prevItemEndedBlank) loose = true;
        const { itemLines, nextI } = collectListItem(lines, i, m2, refs);
        const itemBlocks = parseBlocks(itemLines, refs, false, false, true);
        // An item is loose if a blank line separates two of its DIRECT blocks.
        // (A blank inside a nested list/quote does not loosen the parent.)
        if (itemBlocks.some((b, idx) => idx > 0 && b.blankBefore)) loose = true;
        items.push({ blocks: itemBlocks });
        // did this item end with a blank line before the next item?
        prevItemEndedBlank = (nextI < lines.length && isBlank(lines[nextI]));
        // skip blank lines between items (they mark looseness)
        let k = nextI;
        while (k < lines.length && isBlank(lines[k])) k++;
        lastSkippedBlank = (k > nextI);
        i = k;
        curMarker = m2;
      }
      pushBlk({ t: 'list', ordered: listOrdered, start: listStart, tight: !loose, items });
      // Blanks skipped after the last item precede the NEXT block.
      if (lastSkippedBlank) blankBeforeNext = true;
      continue;
    }
    // HTML block (type 7 cannot interrupt a paragraph)
    const hbType = htmlBlockType(line);
    if (hbType > 0 && (!para || hbType !== 7)) {
      closePara();
      if (hbType === 6 || hbType === 7) {
        // Ends at a blank line or at the end of this lines array.
        // Trailing newline only at document level when ending at EOF.
        const htmlLines = [line];
        i++;
        while (i < lines.length) {
          if (isBlank(lines[i])) break;
          htmlLines.push(lines[i]);
          i++;
        }
        const atEof = i >= lines.length;
        const trailingNL = isDoc && atEof && srcEndsNL;
        pushBlk({ t: 'html', text: htmlLines.join('\n') + (trailingNL ? '\n' : '') });
        continue;
      }
      // Types 1-5: end at the closing marker (may be mid-line); the rest of
      // that line is raw text in the block. Trailing newline included.
      const endRe = hbType === 1 ? /<\/(?:script|pre|style|textarea)>/i :
                    hbType === 2 ? /-->/ :
                    hbType === 3 ? /\?>/ :
                    hbType === 4 ? />/ : /\]\]>/;
      const htmlLines = [line];
      i++;
      if (!endRe.test(line)) {
        while (i < lines.length) {
          const l = lines[i];
          htmlLines.push(l);
          i++;
          if (endRe.test(l)) break;
        }
      }
      // Trailing newline: at document level when the next line is non-empty
      // (a whitespace-only line still counts — only a truly empty line
      // suppresses it), or when this is the last block and the source ends
      // with one.
      const trailingNL = isDoc && ((i < lines.length && lines[i].length > 0) || (i >= lines.length && srcEndsNL));
      pushBlk({ t: 'html', text: htmlLines.join('\n') + (trailingNL ? '\n' : '') });
      continue;
    }
    // Paragraph line
    if (!para) para = [];
    para.push(line);
    i++;
  }
  closePara();
  return blocks;
}
// True if the item's lines contain a blank line separating two non-blank regions.
function hasBlankBetweenBlocks(itemLines) {
  let seenContent = false, seenBlank = false;
  for (const l of itemLines) {
    if (isBlank(l)) { if (seenContent) seenBlank = true; }
    else { if (seenBlank) return true; seenContent = true; }
  }
  return false;
}

// ---------- rendering ----------
function renderBlocks(blocks, refs, tightList) {
  let out = '';
  for (const b of blocks) out += renderBlock(b, refs, tightList);
  return out;
}
function renderBlock(b, refs, inTightList) {
  switch (b.t) {
    case 'refdef': return '';
    case 'para': {
      const text = b.lines.join('\n');
      const html = inlineParse(text, refs);
      if (inTightList) return html + '\n';
      return '<p>' + html + '</p>\n';
    }
    case 'h': return '<h' + b.level + '>' + inlineParse(b.text, refs) + '</h' + b.level + '>\n';
    case 'code': return '<pre><code>' + escPlain(b.text) + '</code></pre>\n';
    case 'fence': {
      const lang = b.info ? escAttr(resolveEscapes(b.info.split(/[ \t]+/)[0])) : '';
      const cls = lang ? ' class="language-' + lang + '"' : '';
      return '<pre><code' + cls + '>' + escPlain(b.text) + '</code></pre>\n';
    }
    case 'hr': return '<hr>\n';
    case 'quote': return '<blockquote>\n' + renderBlocks(b.blocks, refs, false) + '</blockquote>\n';
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const startAttr = (b.ordered && b.start !== 1) ? ' start="' + b.start + '"' : '';
      let out = '<' + tag + startAttr + '>\n';
      for (const item of b.items) out += renderListItem(item, refs, b.tight);
      out += '</' + tag + '>\n';
      return out;
    }
    case 'table': {
      let out = '<table>\n<thead>\n<tr>\n';
      for (let c = 0; c < b.head.length; c++) {
        const a = b.aligns[c];
        out += '<th' + (a ? ' align="' + (a === 'l' ? 'left' : a === 'c' ? 'center' : 'right') + '"' : '') + '>' + inlineParse(b.head[c], refs) + '</th>\n';
      }
      out += '</tr>\n</thead>\n';
      if (b.rows.length > 0) {
        out += '<tbody>';
        for (const row of b.rows) {
          out += '<tr>\n';
          for (let c = 0; c < b.head.length; c++) {
            const cell = c < row.length ? row[c] : '';
            const a = b.aligns[c];
            out += '<td' + (a ? ' align="' + (a === 'l' ? 'left' : a === 'c' ? 'center' : 'right') + '"' : '') + '>' + inlineParse(cell, refs) + '</td>\n';
          }
          out += '</tr>\n';
        }
        out += '</tbody>';
      }
      out += '</table>\n';
      return out;
    }
    case 'html': return b.text;
    default: return '';
  }
}
function renderListItem(item, refs, tight) {
  const blocks = item.blocks;
  if (blocks.length === 0) return '<li></li>\n';
  let out = '<li>';
  const first = blocks[0];
  if (first.t === 'para') {
    // Task list: '[ ] ' / '[x] ' / '[X] ' at the start of the item.
    const firstText = first.lines.join('\n');
    const tm = /^\[( |x|X)\] /.exec(firstText);
    if (tm) {
      const checked = tm[1] === 'x' || tm[1] === 'X';
      const box = checked
        ? '<input checked="" disabled="" type="checkbox"> '
        : '<input disabled="" type="checkbox"> ';
      const rest = firstText.slice(4);
      if (tight) {
        out += box + inlineParse(rest, refs);
      } else {
        out += '<p>' + box + inlineParse(rest, refs) + '</p>\n';
      }
      for (let k = 1; k < blocks.length; k++) out += renderBlock(blocks[k], refs, false);
      if (tight && blocks[blocks.length - 1].t === 'para' && out.endsWith('\n')) out = out.slice(0, -1);
      out += '</li>\n';
      return out;
    }
    if (tight) {
      out += inlineParse(firstText, refs);
    } else {
      out += '<p>' + inlineParse(firstText, refs) + '</p>\n';
    }
    for (let k = 1; k < blocks.length; k++) out += renderBlock(blocks[k], refs, false);
  } else {
    for (const blk of blocks) out += renderBlock(blk, refs, tight);
  }
  // In a tight item, a trailing paragraph ends without a newline before </li>.
  if (tight && blocks[blocks.length - 1].t === 'para' && out.endsWith('\n')) out = out.slice(0, -1);
  out += '</li>\n';
  return out;
}
// ---------- entry ----------
export function parse(src) {
  const refs = new Map();
  // Normalize line endings: CRLF and lone CR become LF (CommonMark).
  if (src.indexOf('\r') >= 0) src = src.replace(/\r\n?/g, '\n');
  const srcEndsNL = src.endsWith('\n');
  const lines = src.split('\n');
  // A trailing newline produces a final empty line; drop it (it is just the terminator).
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const blocks = parseBlocks(lines, refs, true, srcEndsNL, false);
  return renderBlocks(blocks, refs, false);
}
