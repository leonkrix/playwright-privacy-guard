import type { ApiName, FingerprintName, PageEvent } from './types.js';

/** What the page script is told. It is sent as JSON, so it holds plain values only. */
export interface PageOptions {
  /** The name of the function Playwright exposes to report to the test */
  report: string;
  /** Hooks for the sensitive browser APIs (the `apis` rule) */
  apis: boolean;
  /** Hooks for what is stored (the `cookies` and `storage` rules) */
  storage: boolean;
  /** Hooks for the ways of recognising a browser (the `fingerprint` rule) */
  fingerprint: boolean;
  /** Scans of the document: link hints, forms, third-party scripts (the `requests`, `forms` and `sri` rules) */
  dom: boolean;
}

/**
 * The part that runs in the page. Playwright sends it to the browser as text, so it has to be
 * self-contained: no imports of values, no helpers from other files, no variables from outside.
 * (Types are erased by the compiler and are fine.)
 *
 * It only watches. Every hook calls the original, never changes the result and never throws into the
 * page. A script that cannot be hooked in a browser is skipped without a sound.
 */
export function guardInPage(options: PageOptions): void {
  const root = window as unknown as Record<string, unknown>;
  const marker = `__privacyGuard:${options.report}`;
  // The init script also runs again in a document that was written by a script (`document.open`)
  if (root[marker] === true) {
    return;
  }
  Object.defineProperty(root, marker, { value: true });

  const queue: PageEvent[] = [];
  const deliver = (report: (value: PageEvent) => unknown, event: PageEvent): void => {
    // The exposed function answers with a promise: a rejection (page closing) is not worth an error
    const result = report(event) as { catch?: (handler: () => void) => unknown } | undefined;
    result?.catch?.(() => undefined);
  };
  const send = (event: PageEvent): void => {
    try {
      const report = root[options.report];
      if (typeof report === 'function') {
        for (const waiting of queue.splice(0)) {
          deliver(report as (value: PageEvent) => unknown, waiting);
        }
        deliver(report as (value: PageEvent) => unknown, event);
      } else if (queue.length < 200) {
        queue.push(event);
      }
    } catch {
      // The page may be closing: a report that gets lost is not worth an error
    }
  };

  const stack = (): string => {
    try {
      return new Error().stack ?? '';
    } catch {
      return '';
    }
  };
  /**
   * Where the call came from: the stack, and the script that is running right now. WebKit leaves
   * the page's own frame out of the stack when a script calls a hook from its top level.
   */
  const where = (): { stack: string; script?: string } => {
    const script = document.currentScript;
    const src = script instanceof HTMLScriptElement && script.src !== '' ? script.src : undefined;
    return src === undefined ? { stack: stack() } : { stack: stack(), script: src };
  };

  /** Replaces a method by a function that tells the guard first and then calls the original */
  const hook = (
    target: object | undefined,
    name: string,
    before: (self: unknown, args: unknown[]) => void,
  ): void => {
    try {
      if (target === undefined) {
        return;
      }
      const original = (target as Record<string, unknown>)[name];
      if (typeof original !== 'function') {
        return;
      }
      const wrapper = function (this: unknown, ...args: unknown[]): unknown {
        try {
          before(this, args);
        } catch {
          // Looking must never break the page
        }
        return (original as (...inner: unknown[]) => unknown).apply(this, args);
      };
      Object.defineProperty(target, name, { value: wrapper, configurable: true, writable: true });
    } catch {
      // Some browsers do not let this property be replaced
    }
  };

  const proto = (name: string): object | undefined => {
    const constructor = root[name] as { prototype?: object } | undefined;
    return constructor?.prototype;
  };

  if (options.storage) {
    // document.cookie
    try {
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
      // The accessors are called with the document below, not detached
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const set = descriptor?.set;
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const get = descriptor?.get;
      if (descriptor !== undefined && set !== undefined && get !== undefined) {
        Object.defineProperty(Document.prototype, 'cookie', {
          configurable: true,
          enumerable: descriptor.enumerable ?? true,
          get,
          set(this: Document, value: unknown) {
            try {
              const text = String(value);
              const name = (text.split(';')[0] ?? '').split('=')[0]?.trim() ?? '';
              const lower = text.toLowerCase();
              const maxAge = /max-age\s*=\s*(-?\d+)/.exec(lower);
              const expires = /expires\s*=\s*([^;]+)/.exec(lower);
              const gone =
                (maxAge !== null && Number(maxAge[1]) <= 0) ||
                (expires !== null && Date.parse(expires[1] ?? '') < Date.now());
              if (name !== '' && !gone) {
                send({ kind: 'cookie-write', name, via: 'document.cookie', ...where() });
              }
            } catch {
              // see above
            }
            set.call(this, value);
          },
        });
      }
    } catch {
      // see above
    }

    // Cookie Store API (Chromium)
    hook(proto('CookieStore'), 'set', (_self, args) => {
      const first = args[0];
      const name =
        typeof first === 'string' ? first : ((first as { name?: string } | null)?.name ?? '');
      if (name !== '') {
        send({ kind: 'cookie-write', name, via: 'cookieStore.set', ...where() });
      }
    });

    // localStorage and sessionStorage: only setItem can be seen. A write like `localStorage.key = 1`
    // does not call a method; the state at the end of the test still finds it
    hook(proto('Storage'), 'setItem', (self, args) => {
      let area: 'localStorage' | 'sessionStorage' | undefined;
      try {
        if (self === window.localStorage) {
          area = 'localStorage';
        } else if (self === window.sessionStorage) {
          area = 'sessionStorage';
        }
      } catch {
        // Storage can be blocked
      }
      if (area !== undefined) {
        send({ kind: 'storage-write', area, key: String(args[0]), ...where() });
      }
    });

    hook(proto('IDBFactory'), 'open', (_self, args) => {
      send({ kind: 'storage-write', area: 'indexedDB', key: String(args[0]), ...where() });
    });
    hook(proto('CacheStorage'), 'open', (_self, args) => {
      send({ kind: 'storage-write', area: 'cacheStorage', key: String(args[0]), ...where() });
    });
    hook(proto('ServiceWorkerContainer'), 'register', (_self, args) => {
      let key = String(args[0]);
      try {
        key = new URL(key, document.baseURI).href;
      } catch {
        // the browser rejects it anyway
      }
      send({ kind: 'storage-write', area: 'serviceWorker', key, ...where() });
    });
  }

  // Policy violations are events of the document, in every browser
  document.addEventListener(
    'securitypolicyviolation',
    (event) => {
      send({
        kind: 'csp',
        blocked: event.blockedURI,
        directive: event.effectiveDirective || event.violatedDirective,
        disposition: event.disposition,
        sample: event.sample,
        sourceFile: event.sourceFile,
        line: event.lineNumber,
        column: event.columnNumber,
      });
    },
    true,
  );

  if (options.apis) {
    const api = (name: ApiName) => (): void => {
      send({ kind: 'api', api: name, ...where() });
    };
    hook(proto('Geolocation'), 'getCurrentPosition', api('geolocation'));
    hook(proto('Geolocation'), 'watchPosition', api('geolocation'));
    hook(proto('MediaDevices'), 'getUserMedia', api('camera-or-microphone'));
    hook(proto('MediaDevices'), 'getDisplayMedia', api('screen-capture'));
    hook(root.Notification as object | undefined, 'requestPermission', api('notifications'));
    hook(proto('Clipboard'), 'read', api('clipboard-read'));
    hook(proto('Clipboard'), 'readText', api('clipboard-read'));
    hook(proto('Navigator'), 'requestMIDIAccess', api('midi'));
    hook(proto('Bluetooth'), 'requestDevice', api('bluetooth'));
    hook(proto('USB'), 'requestDevice', api('usb'));
    hook(proto('Serial'), 'requestPort', api('serial'));
    hook(proto('HID'), 'requestDevice', api('hid'));
    for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection']) {
      try {
        const original = root[name] as (new (...args: unknown[]) => object) | undefined;
        if (typeof original === 'function') {
          Object.defineProperty(root, name, {
            configurable: true,
            writable: true,
            value: new Proxy(original, {
              construct(target, args, newTarget) {
                send({ kind: 'api', api: 'webrtc', ...where() });
                return Reflect.construct(target, args, newTarget) as object;
              },
            }),
          });
        }
      } catch {
        // see above
      }
    }
  }

  if (options.fingerprint) {
    const technique =
      (name: FingerprintName, detail: string, only?: (args: unknown[]) => boolean) =>
      (_self: unknown, args: unknown[]): void => {
        if (only === undefined || only(args)) {
          send({ kind: 'fingerprint', technique: name, detail, ...where() });
        }
      };
    hook(proto('HTMLCanvasElement'), 'toDataURL', technique('canvas', 'toDataURL'));
    hook(proto('HTMLCanvasElement'), 'toBlob', technique('canvas', 'toBlob'));
    hook(proto('CanvasRenderingContext2D'), 'getImageData', technique('canvas', 'getImageData'));
    hook(proto('OffscreenCanvas'), 'convertToBlob', technique('canvas', 'convertToBlob'));
    // The vendor and the renderer of the graphics card: UNMASKED_VENDOR_WEBGL and _RENDERER_WEBGL
    const unmasked = (args: unknown[]): boolean => args[0] === 0x9245 || args[0] === 0x9246;
    for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
      hook(proto(name), 'getParameter', technique('webgl', 'graphics card name', unmasked));
      hook(
        proto(name),
        'getExtension',
        technique(
          'webgl',
          'WEBGL_debug_renderer_info',
          (args) => args[0] === 'WEBGL_debug_renderer_info',
        ),
      );
    }
    hook(proto('OfflineAudioContext'), 'startRendering', technique('audio', 'OfflineAudioContext'));
    hook(proto('AnalyserNode'), 'getFloatFrequencyData', technique('audio', 'AnalyserNode'));
    hook(proto('Navigator'), 'getBattery', technique('battery', 'getBattery'));
    // A page that tries many fonts is looking for the ones that are installed
    let probes = 0;
    hook(proto('FontFaceSet'), 'check', (_self, _args) => {
      probes += 1;
      if (probes === 20) {
        send({ kind: 'fingerprint', technique: 'fonts', detail: 'many font checks', ...where() });
      }
    });
  }

  if (options.dom) {
    const seen = new Set<string>();
    const once = (key: string, event: PageEvent): void => {
      if (!seen.has(key)) {
        seen.add(key);
        send(event);
      }
    };
    const absolute = (value: string | null): string | undefined => {
      if (value === null || value.trim() === '') {
        return undefined;
      }
      try {
        return new URL(value, document.baseURI).href;
      } catch {
        return undefined;
      }
    };
    const crossOrigin = (href: string): boolean => {
      try {
        return new URL(href).origin !== location.origin;
      } catch {
        return false;
      }
    };
    const hints = new Set([
      'preconnect',
      'dns-prefetch',
      'prefetch',
      'prerender',
      'preload',
      'modulepreload',
    ]);
    const look = (element: Element): void => {
      const tag = element.localName;
      if (tag === 'link') {
        const href = absolute(element.getAttribute('href'));
        if (href === undefined || !crossOrigin(href)) {
          return;
        }
        const rel = (element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
        const hint = rel.find((token) => hints.has(token));
        if (hint !== undefined) {
          once(`hint ${hint} ${href}`, { kind: 'hint', rel: hint, href });
        }
        if (rel.includes('stylesheet')) {
          once(`asset link ${href}`, {
            kind: 'asset',
            tag: 'link',
            href,
            integrity: element.hasAttribute('integrity'),
            crossorigin: element.hasAttribute('crossorigin'),
          });
        }
      } else if (tag === 'script') {
        const href = absolute(element.getAttribute('src'));
        if (href !== undefined && crossOrigin(href)) {
          once(`asset script ${href}`, {
            kind: 'asset',
            tag: 'script',
            href,
            integrity: element.hasAttribute('integrity'),
            crossorigin: element.hasAttribute('crossorigin'),
          });
        }
      } else if (tag === 'form') {
        const action = absolute(element.getAttribute('action'));
        if (action !== undefined && crossOrigin(action)) {
          once(`form ${action}`, {
            kind: 'form',
            action,
            method: (element.getAttribute('method') ?? 'get').toLowerCase(),
          });
        }
      } else if (tag === 'meta') {
        const httpEquiv = (element.getAttribute('http-equiv') ?? '').toLowerCase();
        if (httpEquiv === 'content-security-policy') {
          const content = element.getAttribute('content') ?? '';
          once(`meta ${content}`, { kind: 'meta', httpEquiv, content });
        }
      } else if (tag === 'button' || tag === 'input') {
        const action = absolute(element.getAttribute('formaction'));
        if (action !== undefined && crossOrigin(action)) {
          once(`form ${action}`, { kind: 'form', action, method: 'post' });
        }
      }
      const ping =
        element.localName === 'a' || element.localName === 'area'
          ? absolute(element.getAttribute('ping'))
          : undefined;
      if (ping !== undefined && crossOrigin(ping)) {
        once(`ping ${ping}`, { kind: 'ping', href: ping });
      }
    };
    const scan = (node: ParentNode): void => {
      if (node instanceof Element) {
        look(node);
      }
      for (const element of node.querySelectorAll(
        'link, script[src], form, meta[http-equiv], button[formaction], input[formaction], a[ping], area[ping]',
      )) {
        look(element);
      }
    };
    try {
      // Watch from the first moment: elements that the parser adds are seen as they come
      new MutationObserver((changes) => {
        for (const change of changes) {
          for (const added of change.addedNodes) {
            if (added instanceof Element) {
              scan(added);
            }
          }
        }
      }).observe(document, { childList: true, subtree: true });
    } catch {
      // see above
    }
    const first = (): void => {
      try {
        scan(document);
      } catch {
        // see above
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', first, { once: true });
    } else {
      first();
    }
  }
}
