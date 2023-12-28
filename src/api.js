"use strict";

XPCOMUtils.defineLazyModuleGetters(this, {
  NetUtil: "resource://gre/modules/NetUtil.jsm",
  FileUtils: "resource://gre/modules/FileUtils.jsm",
});

ChromeUtils.defineESModuleGetters(this, {
  ShellService: "resource:///modules/ShellService.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  setInterval: "resource://gre/modules/Timer.sys.mjs",
  clearInterval: "resource://gre/modules/Timer.sys.mjs",
});

const WindowMediator = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);
const WinTaskbar = Cc["@mozilla.org/windows-taskbar;1"].getService(Ci.nsIWinTaskbar);
const WindowsUIUtils = Cc["@mozilla.org/windows-ui-utils;1"].getService(Ci.nsIWindowsUIUtils);
const imgTools = Cc["@mozilla.org/image/tools;1"].getService(Ci.imgITools);
const shellService = Cc["@mozilla.org/browser/shell-service;1"].getService(Ci.nsIWindowsShellService);

let iconReady = false;

this.experiments_taskbar_tabs = class extends ExtensionAPI {
  getAPI(context) {
    return {
      experiments: {
        taskbar_tabs: {

          // Separates this window from Firefox and other taskbar windows
          // Groups it only with other taskbar windows with the same siteId
          setAUMID(windowId, siteId) {
            let window = WindowMediator.getOuterWindowWithId(windowId);
            let aumid = "firefox-" + siteId;
            if (window) {
              WinTaskbar.setGroupIdForWindow(window, aumid);
            } else {
              throw new Error("Window not found");
            }
          },

          // Sets the icon for the window, though for most users the group of windows
          // defined by a common siteId will share an icon. I don't honestly know
          // which icon is picked if thgey're different, and they can be different
          setIcon(windowId, siteId) {
            this.iconReady = false;
            console.log("API setIcon: windowId: " + windowId + ", siteId: " + siteId)

            let window = WindowMediator.getOuterWindowWithId(windowId);
            let linkHandler = window.gBrowser.selectedBrowser.browsingContext.currentWindowGlobal.getActor("LinkHandler");
            let iconUrl;
            let interval;

            // We'll try to get the icon every 100 ms for 10 seconds
            setTimeout(() => {
              clearInterval(interval);
            }, 10000);

            interval = setInterval(() => {

              // There are two icons to try, but if either are SVG then they can't be used in the taskbar
              if (linkHandler.icon && linkHandler.icon.iconURL && !linkHandler.icon.iconURL.includes("svg+xml")) {
                iconUrl = linkHandler.icon.iconURL;
                clearInterval(interval);
              } else if (linkHandler.richIcon && linkHandler.richIcon.iconURL && !linkHandler.richIcon.iconURL.includes("svg+xml")) {
                iconUrl = linkHandler.richIcon.iconURL;
                clearInterval(interval);
              }

              if (iconUrl) {

                let iconUri = Services.io.newURI(iconUrl);
                let channel = NetUtil.newChannel({
                  uri: iconUri,
                  loadUsingSystemPrincipal: true,
                });

                //Create an imgContainer out of the icon, which is what setWindowIcon needs
                console.log("API setIcon: Decoding image from channel");
                imgTools.decodeImageFromChannelAsync(iconUri, channel, (imgContainer, status) => {
                  // Set the actual icon in the window
                  // Don't really know how to deal with setWindowIcon wanting two sizes, so just pass the same thing twice
                  console.log("API setIcon: Setting window icon");
                  WindowsUIUtils.setWindowIcon(window, imgContainer, imgContainer);

                  // Also save the icon so it can be used in the shortcut later
                  console.log("API setIcon: Saving icon to file");
                  let iconPath = PathUtils.join(PathUtils.localProfileDir, "TaskbarTabs", "firefox-" + siteId + ".ico");
                  let iconFile = new FileUtils.File(iconPath)
                  let output = FileUtils.openFileOutputStream(iconFile);
                  let stream = imgTools.encodeImage(imgContainer, "image/vnd.microsoft.icon", "");
                  NetUtil.asyncCopy(stream, output, () => {
                    output.close();
                  });
                  console.log("Icon saved to " + iconPath);
                  this.iconReady = true;
                }, null);
              }
            }, 100);
          },

          // Creates a shortcut for the site, which then plays a role in allowing it
          // to be pinned to the taskbar because it stores an AUMID and icon.
          createShortcut(siteId, windowId, displayName, homepage, pin) {
            console.log("API createShortcut: siteId: " + siteId + ", displayName: " + displayName + ", homepage: " + homepage + ", pin: " + pin);

            this.setIcon(windowId, siteId)

            let interval;
            setTimeout(() => {
              clearInterval(interval);
            }, 10000);

            interval = setInterval(() => {

              if (this.iconReady) {
                clearInterval(interval);
                let iconPath = PathUtils.join(PathUtils.localProfileDir, "TaskbarTabs", "firefox-" + siteId + ".ico");
                let iconFile = new FileUtils.File(iconPath);
                //iconFile = Services.dirsvc.get("XREExeF", Ci.nsIFile);

                shellService.createShortcut(
                  Services.dirsvc.get("XREExeF", Ci.nsIFile), // Shortcut to the Firefox executable
                  ["-new-window", homepage],                  // Launch the homepage in a new window
                  displayName,                                // Use the displayName for the shortcut tooltip and pinned taskbar icon
                  iconFile, 0,                                // Icon file and index
                  "firefox-" + siteId,                        // AUMID for the shortcut
                  "Programs",                                 // Folder to create the shortcut in (FF only gives two options)
                  displayName + ".lnk",                       // Name of the shortcut file. This is what shows up in the start menu.
                ).then(shortcutPath => {
                  console.log("API createShortcut: Shortcut created at " + shortcutPath);
                  if (pin) {
                    // Run pin.exe, which is packaged with extension, to pin the shortcut to the taskbar
                    // Ideally we'd expose the functionality in PinCurrentAppToTaskbarWin10 in the idl
                    // but that would require a Firefox change which we're not doing for this prototype
                    console.log("API createShortcut: Pinning shortcut to taskbar");
                    let process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
                    let pinexePath = PathUtils.join(PathUtils.localProfileDir, "TaskbarTabs", "pin.exe");
                    let pinexeFile = new FileUtils.File(pinexePath);
                    if (pinexeFile.exists()) {
                      process.init(pinexeFile);
                      process.startHidden = true;
                      process.run(true, [shortcutPath], 1);
                      console.log("API createShortcut: pin.exe returned: " + process.exitValue);
                    } else {
                      console.log("API createShortcut: pin.exe not found at " + pinexePath);
                    }
                  }
                });
              }
            }, 100);
          },

          // Removes the shortcut for the site.
          deleteShortcut(siteId, displayName, deleteIcon) {

            // Determine the shortcut path
            let appDataIndex = PathUtils.localProfileDir.indexOf("AppData");
            let appDataPath = PathUtils.localProfileDir.slice(0, appDataIndex + 7);
            let shortcutPath = PathUtils.join(appDataPath, "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", displayName + ".lnk");

            // Unpin the shortcut from the taskbar
            let process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
            let pinexePath = PathUtils.join(PathUtils.localProfileDir, "TaskbarTabs", "pin.exe");
            let pinexeFile = new FileUtils.File(pinexePath);
            process.init(pinexeFile);
            process.startHidden = true;
            try {
              process.run(true, [shortcutPath, "u"], 2);
            } catch (e) {
              console.log(e);
              console.log(process.exitValue)
            }

            // Delete the shortcut file itself
            let shortcutFile = new FileUtils.File(shortcutPath);
            shortcutFile.remove(false);

            // Delete the icon file
            if (deleteIcon) {
              let iconPath = PathUtils.join(PathUtils.localProfileDir, "TaskbarTabs", "firefox-" + siteId + ".ico");
              let iconFile = new FileUtils.File(iconPath)
              iconFile.remove(false);
            }
          },

          copyPinexe(pinexeUrl) {
            Components.utils.importGlobalProperties(['XMLHttpRequest']);
          
            let pinexePath = PathUtils.join(PathUtils.localProfileDir, "TaskbarTabs", "pin.exe");
            let pinexeFile = new FileUtils.File(pinexePath);
            let output = FileUtils.openFileOutputStream(pinexeFile);
          
            let xhr = new XMLHttpRequest();
            xhr.open("GET", pinexeUrl, true);
            xhr.responseType = "arraybuffer";
          
            xhr.onload = function() {
              if (xhr.response) {
                let arrayBuffer = new Uint8Array(xhr.response);
                let storageStream = Cc["@mozilla.org/storagestream;1"].createInstance(Ci.nsIStorageStream);
                let binaryOutputStream = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
          
                storageStream.init(8192, arrayBuffer.length, null);
                binaryOutputStream.setOutputStream(storageStream.getOutputStream(0));
                binaryOutputStream.writeByteArray(arrayBuffer, arrayBuffer.length);
          
                let inputStream = storageStream.newInputStream(0);
          
                NetUtil.asyncCopy(inputStream, output, () => {
                  output.close();
                });
              }
            };
          
            xhr.send();
          },
          
          isPinned(siteId) {
            return new Promise((resolve, reject) => {
              shellService.isCurrentAppPinnedToTaskbarAsync("firefox-" + siteId).then((isPinned) => {
                console.log("API isPinned: " + isPinned);
                resolve(isPinned);
              }).catch(reject);
            });
          }
          
        }
      },
    };
  }
};
