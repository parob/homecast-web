# Browser tests

Playwright specs that run the real web app against mocked data: `mocks.ts`
intercepts GraphQL and the WebSocket, `fixtures.ts` is the data. No server,
relay or account is needed.

```bash
npm ci && (cd screenshots && npm ci)
cd screenshots
npx playwright install chromium            # Linux: npx playwright install --with-deps chromium
npx playwright test phone-back-button.spec.ts --project=iphone-screenshots
```

| Config | Runs | Used by |
|---|---|---|
| `playwright.config.ts` | the `testMatch` whitelist, plus any `*.ios.spec.ts` | by hand |
| `playwright.ci.config.ts` | every `*.spec.ts` except picture-only files, Chromium only, 4 shards | the `browser` job in `.github/workflows/notify-cloud.yml` |

Projects: `screenshots` (desktop), `iphone-screenshots`, `ipad-screenshots`
(not in CI), all Chromium. `iphone-webkit` is added on its own when WebKit is
installed (below).

## Running in a sandbox

Both configs are written to run unedited on a Linux box without IPv6 whose
browsers do not match this Playwright:

- **The dev server binds `127.0.0.1`.** `vite.config.ts` binds `::`, which
  fails with `EAFNOSUPPORT` where there is no IPv6. The page is still opened at
  `http://localhost:8080`: the app derives its API origin from the page's
  hostname, and the mocks (and several specs' own routes) match
  `localhost:8080`. A `127.0.0.1` page would load and then never leave the
  loading screen.
- **Chromium is found, not assumed.** `PW_CHROMIUM_EXECUTABLE` wins if set.
  Otherwise, if the Chromium this Playwright expects is missing and
  `/opt/pw-browsers` exists, the config launches the newest
  `/opt/pw-browsers/chromium-*/chrome-linux*/chrome` (or
  `/opt/pw-browsers/chromium` if that is the binary). The config does this
  itself because a shell that forgets its environment between commands cannot
  carry the variable.

## Reproducing iOS-app reports

On an iPhone, the app is this web app inside a `WKWebView`, with a native shell
around it (parob/homecast, `app-ios-macos/`). Much of what the user sees is not
the page:

- **The top bar is UIKit.** Its title, title menu (homes, rooms, collections),
  ⋯ menu and status dot are drawn by `NativeHeaderBar.swift` from data the page
  posts as `header.setState`. The page's own header row stays mounted, hidden.
- **Native calls back in** by evaluating `window.__homecastNativeHeader.navigate(id)`,
  `.menuAction(id)`, `.selectHome(id)`, `.tap(control)` and `.refresh(kind)`.
- **HomeKit and capture** go through `window.homekit` and `window.homecastReport`.

So "the menu has no New Collection item" is not visible in a screenshot of the
page. It is visible in the messages, and `native-shell.ts` records them.

### The fake shell

```ts
import { installNativeShell, IPHONE_APP } from './native-shell';

test.use(IPHONE_APP);                          // 440×956 @3x, the app's user agent

test('…', async ({ page }) => {
  const shell = await installNativeShell(page); // before goto
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  // Not waitForDashboard(): it waits for the web ⋯, which is hidden here.
  await expect.poll(async () => (await shell.header()).covered).toBe(false);

  const menu = await shell.titleMenu();         // what the title chevron offers
  const item = await shell.findMenuItem(/^Bedroom$/);
  await shell.choose(item!);                    // as if the user picked it
});
```

It installs, before the page's first script, what `HomecastApp.swift` injects on
iOS: the platform globals (`isHomecastIOSApp`, `isHomeKitLocalCapable` but not
`isHomeKitRelayCapable`, `homecastNativeHeaderAvailable/Enabled`), the two
message handlers iOS registers (`homecast`, `homecastReport`), and the
`window.homekit` / `window.homecastReport` objects. Then:

| Call | What it gives you |
|---|---|
| `messages({ handler?, action? })` | every message posted to native, structured-cloned as WKWebView does |
| `header()` | the bar's model, merged per message as `NativeHeaderModel.merge(_:)` does |
| `titleMenu()`, `overflowMenu()` | each menu as `buildTitleMenu` / `buildMenu` would build it (`null` = UIKit draws none) |
| `findMenuItem(re)`, `choose(item)` | find an item in either menu; deliver the pick by the route Swift uses |
| `navigate`, `menuAction`, `selectHome`, `tap`, `refresh` | the native → page calls, verbatim; each returns whether the page had its half installed |
| `setEnabled(on)`, `shake()`, `homekitEvent(payload)` | bar on/off with insets, a shake, a pushed HomeKit event |

Options: `nativeHeader: false` (an older build), `insets`, `safeArea`,
`canRecordScreen`, and answer tables for `homekit` and `report` calls. A
`window.homekit` call with no answer is rejected with `NOT_FAKED` straight away
rather than left to time out. The default answers describe a phone with no
HomeKit access, so Local Mode stays out of tests that don't ask for it.

Name the file `*.ios.spec.ts`. It then runs in every Chromium project and in
`iphone-webkit`, and CI picks it up like any other spec.

### A bug that is not fixed yet

Write the reproduction as `test.fail(...)`. Playwright counts the expected
failure as a pass, so CI stays green with the bug on record. Once a fix lands
it reports *"Expected to fail, but passed"* and the run goes red; that is the
cue to delete `.fail`. A `test.fail` also passes if its *setup* breaks, so pair
it with an ordinary test that proves the setup. See
`native-header-menu.ios.spec.ts` (parob/homecast-cloud#222).

### WebKit vs Chromium

The app runs WebKit, so prefer WebKit for anything layout- or CSS-sensitive:

```bash
npx playwright install webkit              # Linux: npx playwright install --with-deps webkit
npx playwright test native-header-menu.ios.spec.ts --project=iphone-webkit
```

Playwright's WebKit is not iOS WebKit. It has WebKit's layout, CSS support and
`structuredClone` semantics, but not iOS scrolling or rubber-banding, iOS form
controls, or WKWebView's own restrictions (for example, `target="_blank"` and
`window.open` doing nothing; see `openUrl`). Its safe-area insets are 0, so the
shell sets `--safe-area-*` itself. Without WebKit installed, the project is
simply absent and Chromium runs everything; CI installs Chromium only.

### What it still cannot show

The fake shell draws nothing. A pass means "the page asked native for the right
thing", not "the user saw it". Out of reach:

- the UIKit bar itself: the large title and its collapse on scroll, glass
  buttons, the title menu's rendering, the back chevron;
- the status bar's glyphs and their colour;
- system UI: share sheets, permission prompts, StoreKit, the keyboard;
- real captures (`captureScreenshot` returns a 1×1 placeholder) and ReplayKit;
- HomeKit (`window.homekit` answers only from the table you give it);
- the shell's own injected observers (e.g. the `backgroundDark` watcher), and
  its model surviving a reload (the fake's restarts with the page).

Say which half was checked when you report a reproduction.

### What decides the colour at the top of the screen

These are three different mechanisms. Check which one the report is in before
testing anything.

- **iOS app.** The shell draws the status bar's ink from what the page
  publishes, not from the system theme or `theme-color`:
  `covered ? (coverAppearance ?? appearance) : appearance`
  (`NativeHeaderModel.topAppearance`). `appearance` is the page's own ink;
  `coverAppearance` is `light` for a full-height overlay painted light and
  `dark` for the scrim or a dark one. A test can assert those inputs
  (`shell.header()`), but not the glyphs. The colour
  behind the web view (visible in the landscape safe areas) arrives as a
  `backgroundColor` message; see `native-backdrop-colour.spec.ts`.
- **Home-screen web app** (`navigator.standalone`, not the iOS app). The page
  draws under the status bar, and iOS picks black or white glyphs against
  `meta[name=theme-color]`. If the page paints one colour there and declares
  another, the glyphs can vanish. See `status-bar-under-fullscreen-dialog.spec.ts`.
- **iOS Safari.** The bars sit outside the viewport (`env(safe-area-inset-*)`
  is 0), and their colour is not a pixel sample of the page. WebKit hit-tests
  8px inside each viewport edge and walks up to the first `fixed`/`sticky`
  ancestor. If that ancestor has a plain `background-color` in its style, the
  band uses it, live. If it has none, WebKit samples the edge once and keeps
  that colour while the same element stays there. With no such ancestor, the
  glass shows the document through. (WebKit: `LocalFrameView::fixedContainerEdges`,
  `PageColorSampler::predominantColor`.) Playwright cannot reproduce those
  bands at all.

One more trap under the native bar: UIKit collapses the large title from the
web view's own scroll view, so the **document** must scroll. Anything that
boxes the page in a fixed, overflow-hidden container leaves the bar stuck and
the page unscrollable on a phone. Developer settings kept in the device's
`localStorage` (the request-log dock was one) can do this on one device and not
another, so a simulator that works proves nothing about a particular phone.
