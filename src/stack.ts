import type { Source } from './types.js';

const FRAME = /((?:https?|file|chrome-extension|moz-extension):\/\/[^\s()]*?):(\d+):(\d+)\)?\s*$/;

/**
 * The first place of a stack trace that is a real address: the page's own scripts, and not the
 * hooks of the guard (their frames say `<anonymous>`, `debugger eval code` or `web-inspector`). All
 * three engines are understood: `at name (address:line:column)` and `name@address:line:column`.
 */
export function firstFrame(stack: string): Source | undefined {
  for (const line of stack.split('\n')) {
    const found = FRAME.exec(line);
    if (found !== null) {
      return {
        url: found[1] ?? '',
        line: Number(found[2]),
        column: Number(found[3]),
      };
    }
  }
  return undefined;
}

/** The place of a hook call: the first real frame of the stack, or else the script that was running */
export function sourceOf(stack: string, script: string | undefined): Source | undefined {
  return firstFrame(stack) ?? (script === undefined ? undefined : { url: script });
}

/** `https://example.com/app.js:14:3` */
export function describeSource(source: Source | undefined): string | undefined {
  if (source?.url === undefined) {
    return undefined;
  }
  const place =
    source.line === undefined
      ? ''
      : `:${String(source.line)}${source.column === undefined ? '' : `:${String(source.column)}`}`;
  return `${source.url}${place}`;
}
