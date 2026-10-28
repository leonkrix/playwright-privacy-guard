import { describe, expect, it } from 'vitest';

import { describeSource, firstFrame } from './stack.js';

describe('firstFrame', () => {
  it('skips the hooks of the guard in a Chromium stack', () => {
    const stack = [
      'Error',
      '    at stack (<anonymous>:31:20)',
      '    at Storage.wrapper [as setItem] (<anonymous>:49:21)',
      '    at setIt (http://127.0.0.1:4503/app.js:1:32)',
      '    at http://127.0.0.1:4503/app.js:2:1',
    ].join('\n');
    expect(firstFrame(stack)).toEqual({ url: 'http://127.0.0.1:4503/app.js', line: 1, column: 32 });
  });

  it('skips the hooks of the guard in a Firefox stack', () => {
    const stack =
      'stack@debugger eval code:31:20\nwrapper@debugger eval code:49:27\nsetIt@https://cdn.test/a.js:1:57\n@https://cdn.test/a.js:2:1\n';
    expect(firstFrame(stack)).toEqual({ url: 'https://cdn.test/a.js', line: 1, column: 57 });
  });

  it('skips the hooks of the guard in a WebKit stack', () => {
    const stack =
      'stack@web-inspector://bootstrap.js:838:29\nwrapper@web-inspector://bootstrap.js:856:27\nsetIt@http://x.test/app.js:1:39\nglobal code@http://x.test/app.js:2:6';
    expect(firstFrame(stack)).toEqual({ url: 'http://x.test/app.js', line: 1, column: 39 });
  });

  it('reads an address with a query string and a port', () => {
    expect(firstFrame('    at f (https://x.test:8443/a.js?v=2:10:5)')).toEqual({
      url: 'https://x.test:8443/a.js?v=2',
      line: 10,
      column: 5,
    });
  });

  it('gives up when no frame has an address', () => {
    expect(firstFrame('Error\n    at stack (<anonymous>:1:1)')).toBeUndefined();
    expect(firstFrame('')).toBeUndefined();
  });
});

describe('describeSource', () => {
  it('writes the place', () => {
    expect(describeSource({ url: 'https://x.test/a.js', line: 3, column: 4 })).toBe(
      'https://x.test/a.js:3:4',
    );
    expect(describeSource({ url: 'https://x.test/a.js' })).toBe('https://x.test/a.js');
    expect(describeSource(undefined)).toBeUndefined();
  });
});
