// Fast CSV reader: the same answer as csv-reader 1.0.0's readCsv, built with different
// machinery. Written from the written broken-row policy, not from the reference code.
//
// How it is fast: nothing on the hot path reads one character at a time. An unquoted
// field is taken with two indexOf calls (next comma, next LF) and one slice; a quoted
// field is taken with indexOf('"') and one slice per segment. A CR or a line break
// inside a quoted field is turned into LF by one regex replace per segment that holds
// one. Stray CRs outside quotes are the rare path and are walked inside the small
// slice that holds them. Node 22 standard library only, no dependencies, pure.

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let line = 1;

  // The record being read: the line it starts on and the index in rows it takes
  // (null: the header). The field readers below push errors against these.
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended (0 comma, 1 line break, 2 end of
  // text) and, for a field read unquoted, how many characters were kept.
  let fValue = '';
  let fEnded = 2;
  let fAdded = 0;

  // Reads an unquoted field starting at pos, with `start` already in the value.
  // Sets fValue, fEnded and fAdded (characters kept by this call only).
  function unquoted(start) {
    let value = start;
    let added = 0;
    for (;;) {
      const iC = text.indexOf(',', pos);
      const iN = text.indexOf('\n', pos);
      let end;
      let term; // 0 comma, 1 LF, 2 end of text
      if (iC === -1 && iN === -1) {
        end = n;
        term = 2;
      } else if (iC === -1) {
        end = iN;
        term = 1;
      } else if (iN === -1) {
        end = iC;
        term = 0;
      } else if (iC < iN) {
        end = iC;
        term = 0;
      } else {
        end = iN;
        term = 1;
      }
      const chunk = text.slice(pos, end);
      const cr = chunk.indexOf('\r');
      if (cr === -1) {
        value += chunk;
        added += chunk.length;
        if (term === 0) {
          pos = end + 1;
          fEnded = 0;
        } else if (term === 1) {
          pos = end + 1;
          line += 1;
          fEnded = 1;
        } else {
          pos = end;
          fEnded = 2;
        }
        fValue = value;
        fAdded = added;
        return;
      }
      // The chunk holds CRs: walk them. A CR that is the chunk's last character
      // while the field ends at the LF after it is the CRLF that ends the record;
      // any other CR is stray: dropped, one stray_cr error, keep going.
      let from = 0;
      for (;;) {
        const k = chunk.indexOf('\r', from);
        if (k === -1) {
          value += chunk.slice(from);
          added += chunk.length - from;
          if (term === 0) {
            pos = end + 1;
            fEnded = 0;
          } else if (term === 1) {
            pos = end + 1;
            line += 1;
            fEnded = 1;
          } else {
            pos = end;
            fEnded = 2;
          }
          fValue = value;
          fAdded = added;
          return;
        }
        if (k === chunk.length - 1 && term === 1) {
          value += chunk.slice(from, k);
          added += k - from;
          pos = end + 1;
          line += 1;
          fValue = value;
          fAdded = added;
          fEnded = 1;
          return;
        }
        value += chunk.slice(from, k);
        added += k - from;
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        from = k + 1;
      }
    }
  }

  // A quoted segment [from, to): CRLF and lone CR inside it each read as one LF,
  // and the line count moves by the number of line breaks it holds.
  function appendSegment(value, from, to) {
    const seg = text.slice(from, to);
    if (seg.indexOf('\r') === -1 && seg.indexOf('\n') === -1) return value + seg;
    return value + seg.replace(/\r\n?|\n/g, () => {
      line += 1;
      return '\n';
    });
  }

  // Reads a quoted field whose opening quote is at pos. Sets fValue and fEnded.
  function quoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let segStart = pos;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after
        // it is read again as an unquoted field.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        unquoted('"');
        return;
      }
      if (text[q + 1] === '"') {
        // A doubled quote is one quote in the value; keep scanning after it.
        value = appendSegment(value, segStart, q);
        value += '"';
        pos = q + 2;
        segStart = pos;
        continue;
      }
      value = appendSegment(value, segStart, q);
      pos = q + 1;
      if (pos >= n) {
        fValue = value;
        fEnded = 2;
        return;
      }
      const c = text[pos];
      if (c === ',') {
        pos += 1;
        fValue = value;
        fEnded = 0;
        return;
      }
      if (c === '\n') {
        pos += 1;
        line += 1;
        fValue = value;
        fEnded = 1;
        return;
      }
      if (c === '\r' && text[pos + 1] === '\n') {
        pos += 2;
        line += 1;
        fValue = value;
        fEnded = 1;
        return;
      }
      // What follows the closing quote is appended as it stands, up to the next
      // comma or line break; junk kept means a quote_junk error.
      unquoted(value);
      if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text[pos];
      if (c === '\n') {
        pos += 1;
        line += 1;
      } else if (c === '\r' && text[pos + 1] === '\n') {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let isQuoted;
    do {
      isQuoted = text[pos] === '"';
      if (isQuoted) quoted();
      else unquoted('');
      fields.push(fValue);
    } while (fEnded === 0);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !isQuoted) continue;

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
