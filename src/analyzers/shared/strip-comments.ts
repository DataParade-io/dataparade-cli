/**
 * Comment stripping for source files (C++, C#, TypeScript/JavaScript, Python, Go, Java, Kotlin).
 *
 * Comments are replaced with spaces rather than removed so line and column
 * offsets stay identical to the original file. That keeps `SourceLocation`
 * line numbers accurate for findings produced from the stripped text.
 *
 * String literals are preserved verbatim: a URL such as `"https://api.x/v1"`
 * must survive stripping, so the scanner tracks string state instead of
 * blindly cutting at the first `//`.
 */

export interface StripCommentsOptions {
  /** C++ raw string literals: `R"delim( ... )delim"`. */
  rawStrings?: boolean;
  /** C# verbatim string literals: `@"..."`, where `""` is an escaped quote. */
  verbatimStrings?: boolean;
  /** Python `#` line comments. */
  hashComments?: boolean;
  /** Python `"""..."""` and `'''...'''` string literals. */
  tripleQuoteStrings?: boolean;
  /** Go raw string literals: backtick-delimited, no escapes, may span lines. */
  backtickStrings?: boolean;
  /** Java text blocks and Kotlin raw strings: `"""..."""`, may span lines. */
  tripleQuotedStrings?: boolean;
  /**
   * Kotlin permits nested block comments: an inner open delimiter must be
   * matched by its own close delimiter, so the comment ends at the last one
   * rather than the first. Java and the rest of the C family do not nest.
   */
  nestedBlockComments?: boolean;
}

function blankOut(chars: string[], from: number, to: number): void {
  for (let i = from; i < to; i += 1) {
    if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
  }
}

export function stripCommentsPreservingLayout(
  source: string,
  options: StripCommentsOptions = {},
): string {
  const chars = source.split("");
  const length = chars.length;
  let i = 0;

  while (i < length) {
    const ch = chars[i];
    const next = i + 1 < length ? chars[i + 1] : "";

    // Line comment.
    if (ch === "/" && next === "/") {
      let end = i;
      while (end < length && chars[end] !== "\n") end += 1;
      blankOut(chars, i, end);
      i = end;
      continue;
    }

    // Block comment.
    if (ch === "/" && next === "*") {
      let end = i + 2;

      if (options.nestedBlockComments) {
        let depth = 1;
        while (end < length && depth > 0) {
          if (chars[end] === "/" && chars[end + 1] === "*") {
            depth += 1;
            end += 2;
            continue;
          }
          if (chars[end] === "*" && chars[end + 1] === "/") {
            depth -= 1;
            end += 2;
            continue;
          }
          end += 1;
        }
      } else {
        while (end < length && !(chars[end] === "*" && chars[end + 1] === "/")) {
          end += 1;
        }
        end += 2;
      }

      end = Math.min(end, length);
      blankOut(chars, i, end);
      i = end;
      continue;
    }

    // Java text block / Kotlin raw string: """...""" (may span lines).
    if (
      options.tripleQuotedStrings &&
      ch === '"' &&
      next === '"' &&
      chars[i + 2] === '"'
    ) {
      const close = source.indexOf('"""', i + 3);
      i = close === -1 ? length : close + 3;
      continue;
    }

    // C++ raw string: R"delim( ... )delim"
    if (options.rawStrings && ch === "R" && next === '"') {
      let cursor = i + 2;
      let delimiter = "";
      while (cursor < length && chars[cursor] !== "(" && delimiter.length < 16) {
        delimiter += chars[cursor];
        cursor += 1;
      }
      if (chars[cursor] === "(") {
        const terminator = `)${delimiter}"`;
        const rest = source.indexOf(terminator, cursor + 1);
        i = rest === -1 ? length : rest + terminator.length;
        continue;
      }
    }

    // C# verbatim string: @"..." (doubled quotes escape).
    if (options.verbatimStrings && ch === "@" && next === '"') {
      let cursor = i + 2;
      while (cursor < length) {
        if (chars[cursor] === '"') {
          if (chars[cursor + 1] === '"') {
            cursor += 2;
            continue;
          }
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      i = cursor;
      continue;
    }

    // Python triple-quoted string.
    if (
      options.tripleQuoteStrings &&
      (ch === '"' || ch === "'") &&
      next === ch &&
      i + 2 < length &&
      chars[i + 2] === ch
    ) {
      const quote = ch;
      let cursor = i + 3;
      while (cursor < length) {
        if (
          chars[cursor] === quote &&
          chars[cursor + 1] === quote &&
          chars[cursor + 2] === quote
        ) {
          cursor += 3;
          break;
        }
        cursor += 1;
      }
      i = cursor;
      continue;
    }

    // Python / shell line comment.
    if (options.hashComments && ch === "#") {
      let end = i;
      while (end < length && chars[end] !== "\n") end += 1;
      blankOut(chars, i, end);
      i = end;
      continue;
    }

    // Go raw string: `...` (no escapes, may span lines).
    if (options.backtickStrings && ch === "`") {
      const close = source.indexOf("`", i + 1);
      i = close === -1 ? length : close + 1;
      continue;
    }

    // Regular string / char literal (backslash escapes).
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let cursor = i + 1;
      while (cursor < length) {
        if (chars[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (chars[cursor] === quote) {
          cursor += 1;
          break;
        }
        // An unterminated literal should not swallow the rest of the file.
        if (chars[cursor] === "\n") break;
        cursor += 1;
      }
      i = cursor;
      continue;
    }

    i += 1;
  }

  return chars.join("");
}
