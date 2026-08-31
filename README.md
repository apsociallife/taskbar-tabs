# taskbar-tabs
A Firefox web extension that implements taskbar pinning, single-site browsing, and link capture

This is a privileged Firefox web extension that includes a `taskbar_tabs` experimental API, which makes use of Firefox internals to run code that could not otherwise be run in an extension. To make this work you need to set the following in `about:config`: `xpinstall.signatures.required=false` and `extensions.experiments.enabled=true`. Then you have two choices about how to run:

- If you want to be able to easily make changes on the fly, use "Load Temporary Add-on" at `about:debugging#/runtime/this-firefox`.
- If you want the extension to persist between Firefox sessions, choose "Install add-on from file" from the gears menu at `about:addons`.

## Intent

The intent of the extension is to make commonly used websites more accessible by running them in windows that have separate taskbar entries, and can be pinned to the taskbar. The extension shows the favicon for the site in the taskbar, so although taskbar windows are just Firefox windows, the user will see Facebook, YouTube, GMail, etc. icons in their taskbar and can launch them from there. Internally this is accomplished by setting the AppUserModelID (AUMID) for these windows to something different for each site. Windows taskbar code automatically ungroups these windows from Firefox when this is done. To enable pinning, a shortcut must be created which contains the AUMID and command line used to launch.

Pinning used to require `pin.exe`, a small binary compiled from the mechanism published by [Gee Law](https://geelaw.blog/entries/msedge-pins/), which the extension packaged, copied into the profile, and ran. That is no longer necessary: Firefox itself now exposes `pinShortcutToTaskbar` and `unpinShortcutFromTaskbar` on `nsIWindowsShellService`, so the extension calls those directly and ships no binary.

Be aware of how pinning behaves on current Windows 11. Firefox prefers a WinRT API that requires the user to confirm via a system toast, and that toast only appears if the calling process has window focus; the older COM path can be rejected outright with no way to detect it. So a pin triggered by a real click on the page action generally works, while one triggered programmatically tends to resolve successfully and pin nothing. If a confirmation toast appears and is ignored, Windows may block further pin attempts until it is restarted. Firefox's own [Pin to Taskbar](https://firefox-source-docs.mozilla.org/widget/windows/shell/pin-to-taskbar.html) docs cover this.

## A note on Firefox API churn

This extension's privileged API talks to Windows through XPCOM contract IDs rather than Firefox module URIs wherever it can, and loads the modules it does need inside the functions that use them. That is deliberate. Module paths have been renamed twice over the extension's life, and because the imports originally sat at the top of `api.js`, one rename (`XPCOMUtils.defineLazyModuleGetters`, removed with the JSM-to-ESM migration) threw before the API class was defined and silently disabled the entire privileged half of the extension. Windows still got no per-site AUMIDs, no icons and no shortcuts, and nothing in the extension surfaced an error. Contract IDs have been stable across the same period.

If taskbar windows stop being separated from Firefox again, check first whether the experiment API is loading at all: `browser.experiments.taskbar_tabs` should be an object exposing `setAUMID`, `setIcon`, `createShortcut`, `deleteShortcut` and `isPinned`. To confirm from the outside whether a window carries its own AUMID, read `PKEY_AppUserModel_ID` off the HWND with `SHGetPropertyStoreForWindow`; a window still grouped with Firefox will report the install-hash default. When checking taskbar buttons on a multi-monitor setup, remember that the primary monitor's taskbar is `Shell_TrayWnd` and every other monitor gets a `Shell_SecondaryTrayWnd`, so looking only at the former makes windows on other monitors appear to have no taskbar button.

## Building

`src/` does not contain `psl.min.js` or `images/`, which the extension needs at runtime, so it will not package standalone from a fresh clone. `tools/build-xpi.ps1` stages `src/` and backfills anything missing from an already-installed copy of the extension.

## Approach

- A list of "installed" sites is maintained, each with its own settings. An installed site has an icon and shortcut in Windows, capable of being pinned and launched. Icons live in `TaskbarTabs` under the local profile directory, and shortcuts go in the Start Menu's `Programs` folder.
- A "pinned site" is an installed site which has its shortcut pinned currently
- A "taskbar window" is a Firefox window which is associated with an installed site. It appears on the taskbar separately using AUMID differntiation, and with its own icon.
- A site can be installed by pressing the "move to taskbar" page action button. This will install the site, pin the site, and move it to a new taskbar window
- "Move to taskbar" also moves the current tab to an existing or new taskbar window for a site which is already installed.
- "Move from taskbar" will move the current tab out of the taskbar, and if that tab represents the last tab in the last window for that site, will uninstall the site
- Simply closing tabs and windows for a site does not uninstall it. Even if it is not pinned, it remains "installed" and is simply not running.
- A taskbar window has a "scope", which is a domain and optionally a path that define the boundaries of the site. If a user triggers a navigation outside of this scope from a taskbar window, the URL will open in a new tab in a "normal" Firefox window (unless it belongs to another installed site that cpatures links).
- An installed site has a home page, which must be within the defined scope. This page is opened when the site is launched directly, for example from the taskbar.
- An installed site has the ability to "capture" links. If enabled, links to the scope of the installed site from anywhere else in Firefox will open in a taskbar window for the site. The options are to open in the current tab, a new tab, or a new window.
- These seettings are configured using the browser action button from a taskbar window for the site
- The browser action button shows general settings and a list of installed sites when used in a normal Firefox window.
  
