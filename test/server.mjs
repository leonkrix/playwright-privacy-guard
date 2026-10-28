// Two small servers for the test pages (no dependencies, so the tests need nothing else):
//
//   http://127.0.0.1:4410   "the site", the origin of the pages that are tested
//   http://localhost:4411    "the other origin", a third party (a different host, so another origin)
//
// The site serves test/fixtures. Some routes answer with headers on purpose (cookies, a policy).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./fixtures/', import.meta.url)));
const sitePort = Number(process.env.PORT ?? 4410);
const otherPort = sitePort + 1;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
};
// A 1x1 transparent gif
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** Routes with their own headers: [path, headers for the answer] */
const siteHeaders = {
  '/csp.html': { 'content-security-policy': "default-src 'self'; img-src 'self'" },
  '/csp-report-only.html': {
    'content-security-policy-report-only': "default-src 'self'; img-src 'self'",
  },
  '/set-cookie.html': {
    'set-cookie': ['session=abc123; Path=/; HttpOnly', 'theme=dark; Path=/; Max-Age=31536000'],
  },
  '/delete-cookie.html': { 'set-cookie': 'old=; Path=/; Max-Age=0' },
  '/headers-good.html': {
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    'content-security-policy':
      "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    'permissions-policy': 'geolocation=()',
    'cross-origin-opener-policy': 'same-origin',
  },
  '/headers-weak.html': {
    'x-powered-by': 'Express',
    server: 'nginx/1.18.0',
    'content-security-policy':
      "default-src *; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
  },
};

async function serve(request, response, port) {
  const path = (request.url ?? '/').split('?')[0] ?? '/';

  if (port === otherPort) {
    // The third party: it answers everything and tries to set a cookie
    const headers = {
      'access-control-allow-origin': '*',
      'set-cookie': 'tracker=1; Path=/',
    };
    if (path.endsWith('.js')) {
      response.writeHead(200, { ...headers, 'content-type': 'text/javascript' }).end('');
    } else if (path.endsWith('.css')) {
      response.writeHead(200, { ...headers, 'content-type': 'text/css' }).end('');
    } else if (path.endsWith('.gif')) {
      response.writeHead(200, { ...headers, 'content-type': 'image/gif' }).end(gif);
    } else {
      response.writeHead(200, { ...headers, 'content-type': 'text/plain' }).end('ok');
    }
    return;
  }

  if (path === '/status/404') {
    response
      .writeHead(404, { 'content-type': 'text/html' })
      .end('<!doctype html><title>404</title><h1>Not found</h1>');
    return;
  }
  if (path === '/status/500') {
    response.writeHead(500, { 'content-type': 'text/plain' }).end('error');
    return;
  }
  if (path === '/pixel.gif') {
    response.writeHead(200, { 'content-type': 'image/gif' }).end(gif);
    return;
  }
  if (path === '/api/ping') {
    response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    return;
  }

  const file = resolve(
    join(root, normalize(decodeURIComponent(path === '/' ? '/index.html' : path))),
  );
  // Nothing outside the folder of the test pages is served
  if (!file.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      ...(siteHeaders[path] ?? {}),
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
}

for (const port of [sitePort, otherPort]) {
  createServer((request, response) => {
    serve(request, response, port).catch(() => {
      response.writeHead(500).end('error');
    });
  }).listen(port, '127.0.0.1', () => {
    console.log(`Test pages on http://127.0.0.1:${String(port)}`);
  });
}
