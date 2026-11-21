// Fast drop-in for make.fun's csv-reader 1.0.0 (see README.md for the spec).
// Original implementation, written from the spec in competition.yaml / RULES.txt
// and the observable behaviour of the reference reader.
//
// Strategy: most records are plain lines (no quotes, no stray CR). Those are
// taken through a record-level fast path: one slice, one regex scan for
// '"' or '\r', and a native split(','). Anything with a quote or a stray CR
// falls back to a field-by-field parser that uses indexOf to jump between
// delimiters and slices fields instead of building them character by
// character. The fallback reproduces the reference semantics exactly,
// including error order, line/row attribution, and the unterminated-quote
// re-read.

const COMMA = 'comma';
const LINE_BREAK = 'line break';
const END = 'end';
const FAST_BAD = /["\r]/;

/** csv-reader 1.0.0's answer for one case's input: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record currently being read: the line it starts on and its index in
  // rows (null for the header). Every error of the record carries these.
  let recordLine = 1;
  let recordRow = null;

  function pushError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line
  // break. A CR not followed by LF is dropped (stray_cr). Returns the field
  // and how it ended; `added` counts the characters kept.
  function readUnquoted(value) {
    let added = 0;
    if (pos >= n) return { value, ended: END, added };
    // The field ends at the first ',' or '\n' (or the end of the text).
    let cIdx = text.indexOf(',', pos);
    let nIdx = text.indexOf('\n', pos);
    let end = n;
    let kind = END;
    if (cIdx !== -1) { end = cIdx; kind = COMMA; }
    if (nIdx !== -1 && nIdx < end) { end = nIdx; kind = LINE_BREAK; }
    const seg = text.slice(pos, end);
    const r = seg.indexOf('\r');
    if (r === -1) {
      if (end > pos) { value += seg; added += seg.length; }
      pos = end;
      if (kind === COMMA) { pos += 1; return { value, ended: COMMA, added }; }
      if (kind === LINE_BREAK) { pos += 1; line += 1; return { value, ended: LINE_BREAK, added }; }
      return { value, ended: END, added };
    }
    // Slow path: the segment holds one or more CRs. A CR at its very end
    // followed by the '\n' terminator is a CRLF line break; every other CR
    // is a lone one: dropped, with a stray_cr error.
    let i = 0;
    while (true) {
      const rIdx = seg.indexOf('\r', i);
      if (rIdx === -1) {
        if (i < seg.length) { value += seg.slice(i); added += seg.length - i; }
        break;
      }
      if (rIdx > i) { value += seg.slice(i, rIdx); added += rIdx - i; }
      if (rIdx === seg.length - 1 && kind === LINE_BREAK) {
        pos = end + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added };
      }
      pushError('stray_cr');
      i = rIdx + 1;
      if (i >= seg.length) break;
    }
    pos = end;
    if (kind === COMMA) { pos += 1; return { value, ended: COMMA, added }; }
    if (kind === LINE_BREAK) { pos += 1; line += 1; return { value, ended: LINE_BREAK, added }; }
    return { value, ended: END, added };
  }

  // Reads a quoted field whose opening quote is at pos. Returns the field
  // and how it ended.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // Find the closing quote: the next '"' that is not doubled.
    let p = text.indexOf('"', open + 1);
    while (p !== -1 && text.charCodeAt(p + 1) === 34) p = text.indexOf('"', p + 2);
    if (p === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      pushError('unterminated_quote');
      return readUnquoted('"');
    }
    const seg = text.slice(open + 1, p);
    let value;
    if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1 && seg.indexOf('\n') === -1) {
      value = seg;
    } else {
      // Transform: '""' -> '"', CRLF / lone CR -> LF; count the line
      // breaks (a CRLF counts once) for the line counter.
      const parts = [];
      let s = 0;
      let i = 0;
      let lineInc = 0;
      while (i < seg.length) {
        const ch = seg.charCodeAt(i);
        if (ch === 34) {
          parts.push(seg.slice(s, i), '"');
          i += 2;
          s = i;
        } else if (ch === 13) {
          parts.push(seg.slice(s, i), '\n');
          lineInc += 1;
          i += seg.charCodeAt(i + 1) === 10 ? 2 : 1;
          s = i;
        } else if (ch === 10) {
          parts.push(seg.slice(s, i), '\n');
          lineInc += 1;
          i += 1;
          s = i;
        } else {
          i += 1;
        }
      }
      parts.push(seg.slice(s));
      value = parts.join('');
      line += lineInc;
    }
    pos = p + 1;
    if (pos >= n) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) pushError('quote_junk');
    return junk;
  }

  // Reads one record field by field (the fallback for records the fast path
  // cannot take). Returns the fields, or null when the line held only stray
  // CRs and is no record.
  function parseRecordFallback() {
    const fields = [];
    let quoted = false;
    let field;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);
    if (fields.length === 1 && fields[0] === '' && !quoted) return null;
    return fields;
  }

  // Parses one single-line record (no stray CR, no newline inside a quoted
  // field) directly from its line segment. Returns the fields, or null when
  // the line needs the general parser (a quoted field that does not close
  // on this line: multiline or unterminated). Quote-junk errors are counted
  // locally and only reported on success, so a bail-out never double-reports.
  function parseLineRecord(seg) {
    const fields = [];
    const L = seg.length;
    let p = 0;
    let junkCount = 0;
    while (true) {
      if (p < L && seg.charCodeAt(p) === 34) {
        let q = seg.indexOf('"', p + 1);
        while (q !== -1 && seg.charCodeAt(q + 1) === 34) q = seg.indexOf('"', q + 2);
        if (q === -1) return null;
        let value = seg.slice(p + 1, q);
        if (value.indexOf('"') !== -1) value = value.replaceAll('""', '"');
        p = q + 1;
        if (p >= L) { fields.push(value); break; }
        if (seg.charCodeAt(p) === 44) { fields.push(value); p += 1; continue; }
        // Junk after the closing quote, up to the next comma or the line end.
        const nx = seg.indexOf(',', p);
        const junkEnd = nx === -1 ? L : nx;
        const junk = seg.slice(p, junkEnd);
        if (junk.length > 0) junkCount += 1;
        fields.push(value + junk);
        if (nx === -1) break;
        p = nx + 1;
        continue;
      }
      const nx = seg.indexOf(',', p);
      if (nx === -1) { fields.push(seg.slice(p)); break; }
      fields.push(seg.slice(p, nx));
      p = nx + 1;
    }
    for (let i = 0; i < junkCount; i++) pushError('quote_junk');
    return fields;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    let fields = null;
    // Record-level fast path: the record is one plain line, or one line
    // whose quoted fields all close on the line (no stray CR). The line
    // ends at the next LF (or the end of the text).
    const lineEnd = text.indexOf('\n', pos);
    const segEnd = lineEnd === -1 ? n : lineEnd;
    let seg = text.slice(pos, segEnd);
    if (lineEnd !== -1 && seg.charCodeAt(seg.length - 1) === 13) {
      // A trailing CR is the CRLF ending the line; strip it for parsing.
      seg = seg.slice(0, -1);
    }
    if (!FAST_BAD.test(seg)) {
      fields = seg.split(',');
    } else if (seg.indexOf('\r') === -1) {
      // Quotes, but no stray CR: parse the single line directly.
      fields = parseLineRecord(seg);
    }
    if (fields !== null) {
      pos = lineEnd === -1 ? n : lineEnd + 1;
      if (lineEnd !== -1) line += 1;
    } else {
      fields = parseRecordFallback();
      if (fields === null) continue;
    }

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
