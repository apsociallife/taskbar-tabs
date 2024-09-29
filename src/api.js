"use strict";

XPCOMUtils.defineLazyModuleGetters(this, {
  NetUtil: "resource://gre/modules/NetUtil.jsm",
  FileUtils: "resource://gre/modules/FileUtils.jsm",
});

ChromeUtils.defineESModuleGetters(this, {
  ShellService: "resource:///modules/ShellService.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  setInterval: "resource://gre/modules/Timer.sys.mjs",
  clearInterval: "resource://gre/modules/Timer.sys.mjs"
});

const WindowMediator = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);
const WinTaskbar = Cc["@mozilla.org/windows-taskbar;1"].getService(Ci.nsIWinTaskbar);
const WindowsUIUtils = Cc["@mozilla.org/windows-ui-utils;1"].getService(Ci.nsIWindowsUIUtils);
const imgTools = Cc["@mozilla.org/image/tools;1"].getService(Ci.imgITools);
const shellService = Cc["@mozilla.org/browser/shell-service;1"].getService(Ci.nsIWindowsShellService);

const DEFAULLT_ICON_URL = "data:image/png;base64,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";

let iconReady = false;

this.experiments_taskbar_tabs = class extends ExtensionAPI {
  getAPI(context) {
    return {
      experiments: {
        taskbar_tabs: {

          // Separates this window from Firefox and other taskbar windows
          // Groups it only with other taskbar windows with the same siteId
          setAUMID(windowId, siteId) {
            try {
              console.log("API setAUMID: windowId: " + windowId + ", siteId: " + siteId);
              let window = WindowMediator.getOuterWindowWithId(windowId);
              let aumid = "firefox-" + siteId;
              if (window) {
                WinTaskbar.setGroupIdForWindow(window, aumid);
                console.log("API setAUMID: Set AUMID for window " + windowId + " to " + aumid);
              } else {
                throw new Error("Window not found");
              }
            } catch (error) {
              console.error("Error in setAUMID:", error);
            }
          },

          // Sets the icon for the window, though for most users the group of windows
          // defined by a common siteId will share an icon. I don't honestly know
          // which icon is picked if they're different, and they can be different
          setIcon(windowId, iconURL) {
            try {
              console.log("API setIcon: windowId: " + windowId + ", iconURL: " + iconURL);

              let window = WindowMediator.getOuterWindowWithId(windowId);

              let iconUri = Services.io.newURI(iconURL);
              let channel = NetUtil.newChannel({
                uri: iconUri,
                loadUsingSystemPrincipal: true,
              });

              // Create an imgContainer out of the icon, which is what setWindowIcon needs
              console.log("API setIcon: Decoding image from channel");
              imgTools.decodeImageFromChannelAsync(iconUri, channel, (imgContainer, status) => {
                try {

                  // Set the window icon
                  // Don't really know how to deal with setWindowIcon wanting two sizes, so just pass the same thing twice
                  console.log("API setIcon: Setting window icon");
                  WindowsUIUtils.setWindowIcon(window, imgContainer, imgContainer);

                } catch (e) {
                  console.error("API setIcon: Error in decodeImageFromChannelAsync callback:", e);
                  if (iconURL !== DEFAULLT_ICON_URL) {
                    console.log("API setIcon: Retrying with default icon");
                    this.setIcon(windowId, DEFAULLT_ICON_URL);
                  }
                }
              }, null);
            } catch (error) {
              console.error("API setIcon: Error in setIcon:", error);
            }
          },

          // Creates a shortcut for the site, which then plays a role in allowing it
          // to be pinned to the taskbar because it stores an AUMID and icon.
          createShortcut(siteId, windowId, iconURL, displayName, homepage, pin) {
            try {
              console.log("API createShortcut: siteId: " + siteId + ", displayName: " + displayName + ", homepage: " + homepage + ", pin: " + pin);

              let window = WindowMediator.getOuterWindowWithId(windowId);

              let iconUri = Services.io.newURI(iconURL);
              let channel = NetUtil.newChannel({
                uri: iconUri,
                loadUsingSystemPrincipal: true,
              });

              // Create an imgContainer out of the icon
              console.log("API createShortcut: Decoding image from channel");
              imgTools.decodeImageFromChannelAsync(iconUri, channel, (imgContainer, status) => {
                try {

                  // Save the icon so it can be used in the shortcut
                  console.log("API createShortcut: Saving icon to file");
                  let iconPath = PathUtils.join(PathUtils.localProfileDir, "TaskbarTabs", "firefox-" + siteId + ".ico");
                  let iconFile = new FileUtils.File(iconPath);
                  let output = FileUtils.openFileOutputStream(iconFile);
                  console.log("API createShortcut: Before use imgContainer");
                  let stream = imgTools.encodeImage(imgContainer, "image/vnd.microsoft.icon", "");
                  console.log("API createShortcut: After use imgContainer");
                  NetUtil.asyncCopy(stream, output, () => {
                    try {
                      output.close();
                      console.log("API createShortcut: Icon saved to " + iconPath);
                    } catch (e) {
                      console.error("API createShortcut: Error closing output stream: " + e);
                    }
                  });

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

                } catch (e) {
                  console.error("API setIcon: Error in decodeImageFromChannelAsync callback:", e);
                  if (iconURL !== DEFAULLT_ICON_URL) {
                    console.log("API createShortcut: Retrying with default icon");
                    this.createShortcut(siteId, windowId, DEFAULLT_ICON_URL, displayName, homepage, pin);
                  }
                }
              }, null);


            } catch (error) {
              console.error("Error in createShortcut:", error);
            }
          }, 

          // Removes the shortcut for the site.
          deleteShortcut(siteId, displayName, deleteIcon) {
            try {
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
            } catch (error) {
              console.error("Error in deleteShortcut:", error);
            }
          },

          copyPinexe(pinexeUrl) {
            try {
              Components.utils.importGlobalProperties(['XMLHttpRequest']);

              let pinexePath = PathUtils.join(PathUtils.localProfileDir, "TaskbarTabs", "pin.exe");
              let pinexeFile = new FileUtils.File(pinexePath);
              let output = FileUtils.openFileOutputStream(pinexeFile);

              let xhr = new XMLHttpRequest();
              xhr.open("GET", pinexeUrl, true);
              xhr.responseType = "arraybuffer";

              xhr.onload = function () {
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
            } catch (error) {
              console.error("Error in copyPinexe:", error);
            }
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
