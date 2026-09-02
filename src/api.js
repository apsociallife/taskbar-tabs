"use strict";

// Privileged half of Taskbar Tabs.
//
// This talks to Windows through XPCOM contract IDs rather than Firefox module
// URIs wherever it can. Module paths have been renamed twice over this
// extension's life (JSM to ESM, then resource:// to moz-src://), and because
// the imports used to sit at the top of this file, a single rename took the
// whole API down and left the extension silently doing nothing. Contract IDs
// have been stable across the same period. Where a module is unavoidable it is
// loaded inside the function that needs it, so a future rename costs one
// feature instead of all of them.

const WindowMediator = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);
const WinTaskbar = Cc["@mozilla.org/windows-taskbar;1"].getService(Ci.nsIWinTaskbar);
const WindowsUIUtils = Cc["@mozilla.org/windows-ui-utils;1"].getService(Ci.nsIWindowsUIUtils);
const ImgTools = Cc["@mozilla.org/image/tools;1"].getService(Ci.imgITools);
const ShellService = Cc["@mozilla.org/browser/shell-service;1"].getService(Ci.nsIWindowsShellService);
const Favicons = Cc["@mozilla.org/browser/favicon-service;1"].getService(Ci.nsIFaviconService);

// Windows addresses shortcuts relative to a known folder rather than by
// absolute path. "Programs" is the per-user Start Menu.
const SHORTCUT_FOLDER = "Programs";

// The largest size Windows uses for taskbar and shortcut icons.
const ICON_SIZE = 256;
const ICON_MIME = "image/vnd.microsoft.icon";
const ICON_EXTENSION = "ico";

function aumidFor(siteId) {
  return "firefox-" + siteId;
}

// Path of the .lnk relative to SHORTCUT_FOLDER.
function shortcutPathFor(displayName) {
  return displayName + ".lnk";
}

function iconFolder() {
  return PathUtils.join(PathUtils.localProfileDir, "TaskbarTabs");
}

function iconPathFor(siteId) {
  return PathUtils.join(iconFolder(), `${aumidFor(siteId)}.${ICON_EXTENSION}`);
}

function fileFor(path) {
  let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  file.initWithPath(path);
  return file;
}

/**
 * Splits a hostname using Firefox's own public suffix list.
 *
 * This replaces the vendored copy of the psl package, which nothing kept up to
 * date. nsIEffectiveTLDService is the same list Gecko uses for cookies and
 * permissions, and it ships with every Firefox update, so the extension's idea
 * of what counts as one site now matches the browser's.
 *
 * @param {string} host - A hostname, with no scheme, port or path.
 * @returns {object} `domain` is the registrable domain (example.co.uk),
 *   `publicSuffix` the part the registry owns (co.uk), `sld` the label below it
 *   (example), and `subdomain` whatever precedes the registrable domain, or "".
 */
function splitHost(host) {
  let result = { host, domain: "", publicSuffix: "", sld: "", subdomain: "" };
  if (!host) {
    return result;
  }

  try {
    result.domain = Services.eTLD.getBaseDomainFromHost(host);
  } catch (e) {
    // IP literals, single label hosts and bare public suffixes have no
    // registrable domain. Treating the whole host as the domain keeps callers
    // from having to special case them.
    result.domain = host;
  }

  try {
    result.publicSuffix = Services.eTLD.getPublicSuffixFromHost(host);
  } catch (e) {
    result.publicSuffix = "";
  }

  if (result.publicSuffix && result.domain.endsWith("." + result.publicSuffix)) {
    result.sld = result.domain.slice(0, -(result.publicSuffix.length + 1));
  } else {
    result.sld = result.domain;
  }

  if (host !== result.domain && host.endsWith("." + result.domain)) {
    result.subdomain = host.slice(0, -(result.domain.length + 1));
  }

  return result;
}

function windowFor(windowId) {
  // WebExtension window IDs are outer window IDs, so this maps straight across.
  let window = WindowMediator.getOuterWindowWithId(windowId);
  if (!window) {
    throw new Error("No window with id " + windowId);
  }
  return window;
}

function decodeImage(uri) {
  let channel = Services.io.newChannelFromURI(
    uri,
    null,
    Services.scriptSecurityManager.getSystemPrincipal(),
    null,
    Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
    Ci.nsIContentPolicy.TYPE_IMAGE
  );
  return ChromeUtils.fetchDecodedImage(uri, channel);
}

// Decoding through moz-remote-image happens in a content process at a size we
// choose. That is the only path that rasterizes SVG favicons, which most sites
// now serve and which the old imgITools path could not handle at all.
function decodeRemoteImage(spec) {
  let url;
  try {
    const { FaviconUtils } = ChromeUtils.importESModule(
      "moz-src:///toolkit/modules/FaviconUtils.sys.mjs"
    );
    url = FaviconUtils.getMozRemoteImageURL(spec, { size: ICON_SIZE });
  } catch (e) {
    url = `moz-remote-image://?url=${encodeURIComponent(spec)}&width=${ICON_SIZE}&height=${ICON_SIZE}`;
  }
  return decodeImage(Services.io.newURI(url));
}

/**
 * Resolves an icon for a site, trying progressively more forgiving sources.
 *
 * The live favicon is tried first. Places is only a fallback, because its
 * lookup is per page and will happily answer with an origin-level icon: asking
 * it about https://docs.google.com/spreadsheets/ returns the Google Drive logo
 * rather than the Sheets one, which is how a correct-looking window icon ended
 * up next to a wrong shortcut icon.
 *
 * @param {string} iconURL - A favicon URL, typically tab.favIconUrl. This is
 *   the icon the window is actually showing.
 * @param {string} [pageURL] - The page the icon belongs to, used to look the
 *   favicon up in Places if the live one can't be decoded.
 * @returns {Promise<imgIContainer>} The decoded icon.
 */
async function loadIcon(iconURL, pageURL) {
  let sources = [];

  if (iconURL) {
    sources.push(() => decodeRemoteImage(iconURL));
  }

  if (pageURL) {
    sources.push(async () => {
      let favicon = await Favicons.getFaviconForPage(Services.io.newURI(pageURL));
      if (!favicon || !favicon.dataURI) {
        throw new Error("Places has no favicon for " + pageURL);
      }
      return decodeImage(favicon.dataURI);
    });
  }

  sources.push(() => decodeImage(Favicons.defaultFavicon));

  let lastError;
  for (let source of sources) {
    try {
      return await source();
    } catch (e) {
      console.log("API loadIcon: source failed, trying next: " + e.message);
      lastError = e;
    }
  }
  throw lastError;
}

async function writeIconFile(path, image) {
  let stream = ImgTools.encodeScaledImage(image, ICON_MIME, ICON_SIZE, ICON_SIZE);
  let available = stream.available();
  let binaryStream = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci.nsIBinaryInputStream);
  binaryStream.setInputStream(stream);
  let bytes = new Uint8Array(available);
  binaryStream.readArrayBuffer(available, bytes.buffer);

  await IOUtils.makeDirectory(PathUtils.parent(path), {
    createAncestors: true,
    ignoreExisting: true,
  });
  await IOUtils.write(path, bytes);
}

this.experiments_taskbar_tabs = class extends ExtensionAPI {
  getAPI(context) {
    return {
      experiments: {
        taskbar_tabs: {

          // Splits a hostname against Firefox's public suffix list. Async only
          // because the service lives in the parent process; callers should
          // resolve this once when a site is installed rather than per request.
          parseHost(host) {
            let parsed = splitHost(host);
            console.log("API parseHost: " + host + " -> " + JSON.stringify(parsed));
            return Promise.resolve(parsed);
          },

          // Separates this window from Firefox and other taskbar windows.
          // Groups it only with other taskbar windows with the same siteId.
          setAUMID(windowId, siteId) {
            let aumid = aumidFor(siteId);
            try {
              WinTaskbar.setGroupIdForWindow(windowFor(windowId), aumid);
              console.log("API setAUMID: Set AUMID for window " + windowId + " to " + aumid);
            } catch (error) {
              console.error("API setAUMID: Failed to set " + aumid + " on window " + windowId + ":", error);
              throw error;
            }
          },

          // Sets the icon for the window, though for most users the group of
          // windows defined by a common siteId will share an icon. I don't
          // honestly know which icon is picked if they're different, and they
          // can be different.
          async setIcon(windowId, iconURL, pageURL) {
            try {
              let window = windowFor(windowId);
              let icon = await loadIcon(iconURL, pageURL);
              // setWindowIcon wants a small and a large icon; the image is
              // already at the largest size Windows asks for, so it can scale
              // down for the small one itself.
              WindowsUIUtils.setWindowIcon(window, icon, icon);
              console.log("API setIcon: Set icon for window " + windowId);
            } catch (error) {
              console.error("API setIcon: Failed for window " + windowId + ":", error);
              throw error;
            }
          },

          // Creates a shortcut for the site, which then plays a role in
          // allowing it to be pinned to the taskbar because it stores an AUMID
          // and icon.
          async createShortcut(siteId, windowId, iconURL, displayName, homepage, pin) {
            console.log("API createShortcut: siteId: " + siteId + ", displayName: " + displayName +
              ", homepage: " + homepage + ", pin: " + pin);
            try {
              let icon = await loadIcon(iconURL, homepage);
              let iconPath = iconPathFor(siteId);
              await writeIconFile(iconPath, icon);
              console.log("API createShortcut: Icon saved to " + iconPath);

              let relativePath = shortcutPathFor(displayName);
              await ShellService.createShortcut(
                Services.dirsvc.get("XREExeF", Ci.nsIFile), // Shortcut to the Firefox executable
                ["-new-window", homepage],                  // Launch the homepage in a new window
                displayName,                                // Tooltip and pinned taskbar caption
                fileFor(iconPath), 0,                       // Icon file and index
                aumidFor(siteId),                           // AUMID for the shortcut
                SHORTCUT_FOLDER,
                relativePath
              );
              console.log("API createShortcut: Shortcut created at " + SHORTCUT_FOLDER + "\\" + relativePath);

              if (pin) {
                // Firefox now exposes the taskbar pinning that this extension
                // used to reach by shipping and shelling out to pin.exe.
                await ShellService.pinShortcutToTaskbar(
                  aumidFor(siteId),
                  SHORTCUT_FOLDER,
                  relativePath
                );
                console.log("API createShortcut: Pinned " + relativePath + " to the taskbar");
              }
            } catch (error) {
              console.error("API createShortcut: Failed for siteId " + siteId + ":", error);
              throw error;
            }
          },

          // Rewrites the icon file an already-created shortcut points at.
          //
          // The Start Menu shortcut and the taskbar pin are two separate .lnk
          // files, but both reference this one .ico by path, so replacing its
          // contents updates both without touching either shortcut. That
          // matters: recreating the shortcut would drop the taskbar pin.
          async refreshIcon(siteId, iconURL, pageURL) {
            try {
              let icon = await loadIcon(iconURL, pageURL);
              let iconPath = iconPathFor(siteId);
              await writeIconFile(iconPath, icon);
              console.log("API refreshIcon: Rewrote " + iconPath + " from " + iconURL);
              return iconPath;
            } catch (error) {
              console.error("API refreshIcon: Failed for siteId " + siteId + ":", error);
              throw error;
            }
          },

          // Removes the shortcut for the site, unpinning it first.
          async deleteShortcut(siteId, displayName, deleteIcon) {
            console.log("API deleteShortcut: siteId: " + siteId + ", displayName: " + displayName);
            let relativePath = shortcutPathFor(displayName);

            try {
              ShellService.unpinShortcutFromTaskbar(SHORTCUT_FOLDER, relativePath);
              console.log("API deleteShortcut: Unpinned " + relativePath);
            } catch (error) {
              // Unpinning a shortcut that was never pinned is not a problem.
              console.log("API deleteShortcut: Nothing to unpin for " + relativePath + ": " + error.message);
            }

            try {
              await ShellService.deleteShortcut(SHORTCUT_FOLDER, relativePath);
              console.log("API deleteShortcut: Deleted " + relativePath);
            } catch (error) {
              console.error("API deleteShortcut: Failed to delete " + relativePath + ":", error);
            }

            if (deleteIcon) {
              try {
                await IOUtils.remove(iconPathFor(siteId), { ignoreAbsent: true });
              } catch (error) {
                console.error("API deleteShortcut: Failed to delete icon:", error);
              }
            }
          },

          async isPinned(siteId) {
            let pinned = await ShellService.isCurrentAppPinnedToTaskbar(aumidFor(siteId));
            console.log("API isPinned: " + aumidFor(siteId) + " -> " + pinned);
            return pinned;
          },

        }
      },
    };
  }
};
