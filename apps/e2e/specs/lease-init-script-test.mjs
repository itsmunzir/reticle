// A script-defined global must be visible to the app's FIRST module, checked in a REAL headless
// Chromium (#1427). Prints through process.stdout.write: the repository asks for no console logging.
//
// The unit tests prove the pool installs the script before goto and disposes it with the lease, but
// they run against a fake page — they can say the call happened, never that the page's own first
// module SAW the value. Only a real browser can say that. Serves its own fixture, so it needs no app
// from run-ci.sh — same shape as lease-permissions-test.
import { createServer } from 'node:http';
import { BrowserPool, playwrightLauncher } from '@reticlehq/server';

let pass = 0,
  fail = 0;
const say = (line) => process.stdout.write(`${line}\n`);
const chk = (label, ok, detail = '') => {
  say(`   ${ok ? '✅' : '❌'} ${label}${detail ? '  — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

// The FIRST module on the page calls the binding a desktop shell would inject, exactly like a Wails
// view on mount. What it saw is rendered into the DOM and written to a global the spec reads back; a
// missing binding is CAUGHT and recorded, so "saw the value" and "threw on mount" are distinguishable.
const server = createServer((_req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><title>host stub</title><div id="version">not-run</div>
<script type="module">
  try {
    const v = window.go.main.App.version;
    document.getElementById('version').textContent = v;
    window.__firstModuleSaw = 'saw:' + v;
  } catch (err) {
    window.__firstModuleSaw = 'threw:' + err.message;
  }
</script>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const APP = `http://127.0.0.1:${server.address().port}/`;

const STUB = "window.go = { main: { App: { version: 'stubbed-1.2.3', ListBooks: async () => [] } } };";

// The pool hands out leases, not pages; keep each page so the spec can ask it directly.
const pages = [];
const launcher = async () => {
  const browser = await playwrightLauncher({ headless: true })();
  return {
    ...browser,
    newContext: async () => {
      const context = await browser.newContext();
      return {
        ...context,
        newPage: async () => {
          const page = await context.newPage();
          pages.push(page);
          return page;
        },
      };
    },
  };
};
let seq = 0;
const pool = new BrowserPool(launcher, { maxContexts: 3, genSessionId: () => `stub-${(seq += 1)}` });
const saw = (page) => page.evaluate('window.__firstModuleSaw');
const rendered = (page) => page.evaluate('document.getElementById("version").textContent');

say('\n=== a leased tab stubs host bindings before the app’s first module ===');

// Negative control: the same page without the stub must throw, so a green below cannot be vacuous.
const control = await pool.acquire(APP);
const controlSaw = String(await saw(pages.at(-1)));
chk('without a stub, the first module throws on the missing binding', controlSaw.startsWith('threw:'), controlSaw);
chk('the pool says the control lease runs no stub', pool.stubInstalled(control.sessionId) === false);
await control.release();

const stubbed = await pool.acquire(APP, { initScript: STUB });
const stubbedPage = pages.at(-1);
const stubbedSaw = String(await saw(stubbedPage));
chk('the first module SAW the value the init script defined', stubbedSaw === 'saw:stubbed-1.2.3', stubbedSaw);
chk('the first module rendered that value into the DOM', (await rendered(stubbedPage)) === 'stubbed-1.2.3', String(await rendered(stubbedPage)));
chk('the pool says this lease runs a stub', pool.stubInstalled(stubbed.sessionId) === true);
chk('the pool remembers the script text it installed', pool.hostStubScript(stubbed.sessionId) === STUB);

// The stub belongs to the LEASE, not to the first navigation: a later navigation must still see it.
await stubbedPage.goto(APP);
const revisitedSaw = String(await saw(stubbedPage));
chk('a later navigation inside the lease still runs the stub', revisitedSaw === 'saw:stubbed-1.2.3', revisitedSaw);

await stubbed.release();
chk('releasing the lease gives its slot back', pool.activeCount() === 0, `active=${pool.activeCount()}`);
chk('the released lease keeps no stub record', pool.stubInstalled(stubbed.sessionId) === false);

await pool.shutdown();
server.close();
say(`\n${fail === 0 ? '✅' : '❌'} LEASE INIT SCRIPT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
