//Taskbar Tabs - Background Script

let initialized = false;

const LINK_BEHAVIOR_NEWTAB = 1; // Open captured links in a new tab
const LINK_BEHAVIOR_CURRENTTAB = 2; // Open captured links in the current tab
const LINK_BEHAVIOR_NEWWINDOW = 3; // Open captured links in a new window
const LINK_BEHAVIOR_NOCAPTURE = 0; // Do not capture links for this site

// Global settings
let settings = {
    linkBehavior: LINK_BEHAVIOR_NOCAPTURE, // Default link behavior
    launchWithFirefox: false, // Default launch with Firefox setting
    pinSite: true, // Default pin site setting
    newTabHomepage: true // Default new tab behavior is to open homepage
}

// Update settings in both the global object and storage
function updateSettings(newSettings) {
    console.log("UpdateSettings: settings: " + JSON.stringify(newSettings));
    settings = newSettings;
    browser.storage.local.set({ settings: settings });
}

// Dictionary of sites installed in the taskbar
let installedSites = {}
// installedSite[id] = { 
//     id = "1234567890", // Unique id generated for the site, a CRC32 hash of the scope
//     scope = "*.example.com/foo", // Scope for the site
//     displayName = "Example", // Display name for the site
//     launchWithFirefox = true // Whether the site should be launched with Firefox
//     homepage = "https://www.example.com/home" // Homepage for the site
//     linkBehavior = see below, default is LINK_BEHAVIOR_NOCAPTURE
//     newTabHomepage = true, // Whether new tabs should open the homepage of the site
//     pinned = true // Whether the site is pinned to the taskbar

let sortedSites = []; // Array of siteIds sorted by scope

// Do all the things needed to add an installed site
async function addInstalledSite(windowId, installSite) {
    console.log("addInstalledSite: " + JSON.stringify(installSite));

    // Add the site and re-sort the site list
    installedSites[installSite.id] = installSite;
    sortInstalledSites();

    // Update storage. No need to wait for this, we don't need to call storage
    // until the extension is reloaded so async is fine. 
    browser.storage.local.set({ installedSites: installedSites });

    // Create the shortcut. This also sets the icon.
    windowManager[windowId].iconURL = installSite.iconURL;
    browser.experiments.taskbar_tabs.createShortcut(installSite.id, windowId, installSite.iconURL, installSite.displayName, installSite.homepage, installSite.pinned)
    console.log("addInstalledSite: installedSites: " + JSON.stringify(installedSites));
}

// Update one or more of the mutable properties of a site
// Note that changing scope is handled elsewhere as it 
// technically is the deletion of one site and the creation of another. 
function updateInstalledSite(siteId, properties) {
    console.log("updateInstalledSite: " + siteId + ", " + JSON.stringify(properties));
    if (installedSites[siteId]) {
        let site = installedSites[siteId];
        if (properties.displayName) {
            site.displayName = properties.displayName;
        }
        if (properties.homepage) {
            site.homepage = properties.homepage;
        }
        if (properties.linkBehavior) {
            site.linkBehavior = properties.linkBehavior;
        }
        if (properties.launchWithFirefox !== undefined) {
            site.launchWithFirefox = properties.launchWithFirefox;
        }
        if (properties.newTabHomepage !== undefined) {
            site.newTabHomepage = properties.newTabHomepage;
        }
        installedSites[siteId] = site;
        browser.storage.local.set({ installedSites: installedSites });
        console.log("updateInstalledSite: installedSites: " + JSON.stringify(installedSites));
    }
}

// Remove the site from the list of installed sites, and delete/unpin the shortcut
function uninstallSite(siteId) {
    console.log("uninstallSite: " + siteId);
    browser.experiments.taskbar_tabs.deleteShortcut(siteId, installedSites[siteId].displayName, true);
    delete installedSites[siteId];
    browser.storage.local.set({ installedSites: installedSites }, function () {
        if (browser.runtime.lastError) {
            console.error("Error saving installed sites: " + browser.runtime.lastError.message);
            return;
        }
    });
    sortInstalledSites();
    console.log("uninstallSite: installedSites: " + JSON.stringify(installedSites));
}

async function isSitePinned(siteId) {
    try {
        const isPinned = await browser.experiments.taskbar_tabs.isPinned(siteId);
        console.log(installedSites[siteId].displayName + " is pinned: " + isPinned);
        return isPinned;
    } catch (error) {
        console.error(`Error checking pinned status for site ${siteId}: ${error}`);
        return false;
    }
}

async function refreshPinnedState() {
    for (let siteId in installedSites) {
        installedSites[siteId].pinned = await isSitePinned(siteId);
    }
}

//We have to check each URL loaded to see if it's in the scope of any site
//This needs to be done in order, most specific sites first. 
//To avoid expense, we sort when sites are added or updated

//The sort order is, for each value of N from the highest down to 0:
// First, the sites with N subdomains and no wildcard, sorted by length of path descending
// Second, the sites with N subdomains and a wildcard, sorted by lenth of path descending

// This ensures the following order: 
// beta.search.google.com --> 2 subdomains
// search.google.com/news/today --> 1 subdomain, 11 character path
// search.google.com/news --> 1 subdomain, 5 character path
// *.search.google.com/news --> 1 subdomain with wildcard, 5 character path
// *.search.google.com --> 1 subdomain with wildcard, no path
// google.com/images --> No subdomain, 7 character path
// google.com --> No subdomain, no path
// *.google.com/images - No subdomain with wildcrd, 7 character path
function sortInstalledSites() {
    console.log("sortInstalledSites - Before: " + sortedSites);

    let sortableSites = [];
    for (let siteId in installedSites) {
        site = installedSites[siteId];

        // Determine if the site has a wildcard, then remove it from the scope
        scope = site.scope
        wildcard = scope.startsWith("*.");
        scope = scope.replace("*.", "");

        // Get the hostname domain count and the path length
        let pathLength;
        let hostname
        firstSlashIndex = scope.indexOf("/");
        if (firstSlashIndex === -1) {
            hostname = scope;
            pathLength = 0
        } else {
            hostname = scope.slice(0, firstSlashIndex);
            pathLength = scope.slice(firstSlashIndex).length;
        }
        let subdomain = psl.parse(hostname).subdomain;
        let subdomainCount = 0;
        if (subdomain) {
            let hostnameParts = subdomain.split(".");
            subdomainCount = hostnameParts.length;
        }

        // Add the calculated values to an array that will be sorted
        sortableSites.push({
            siteId: siteId,
            subdomainCount: subdomainCount,
            wildcard: wildcard,
            pathLength: pathLength
        });
    }

    sortableSites.sort((a, b) => {
        if (a.subdomainCount === b.subdomainCount) {
            if (a.wildcard === b.wildcard) {
                return b.pathLength - a.pathLength;
            } else {
                return a.wildcard ? 1 : -1;
            }
        } else {
            return b.subdomainCount - a.subdomainCount;
        }
    });

    sortedSites = sortableSites.map((site) => site.siteId);

    console.log("sortInstalledSites - After: " + sortedSites);
}


// Determine if the url given belongs to any installed sites and return the siteId if so
// The sites are alresdy sorted correctly, so we just take the first one we find
function belongsToSite(url) {
    console.log("belongsToSite: " + url);
    for (const siteId of sortedSites) {
        if (isInScope(url, installedSites[siteId].scope)) {
            return siteId;
        }
    }
    console.log("belongsToSite: " + url + " does not belong to any installed sites");
    return "";
}

// Determine if the url given is in the scope given
function isInScope(url, scope) {
    console.log("isInScope: " + url + ", " + scope);
    let firstSlashIndex = scope.indexOf("/");
    if (firstSlashIndex === -1) {
        firstSlashIndex = scope.length;
    }
    let scopePart1 = scope.slice(0, firstSlashIndex);
    let scopePart2 = scope.slice(firstSlashIndex);
    if (scopePart1.startsWith("*")) {
        // Wildcard hostname
        let scopeHostname = scopePart1.substring(2);
        if (url.hostname.endsWith(scopeHostname)) {
            // Ensure the match is for the exact domain or subdomain
            let hostnamePrefix = url.hostname.slice(0, -scopeHostname.length);
            if (hostnamePrefix === "" || hostnamePrefix.endsWith(".")) {
                // Hostname IS in scope, now check path
                if (firstSlashIndex > 0) {
                    if (url.pathname.startsWith(scopePart2)) {
                        // Path is also in scope
                        console.log("belongsToSite: " + url + " belongs to scope " + scope);
                        return true;
                    }
                } else {
                    // No path specified, so it's in scope based on hostname alone
                    console.log("belongsToSite: " + url + " belongs to scope " + scope);
                    return true;
                }
            }
        }
    } else {
        // Exact hostname
        if (url.hostname === scopePart1) {
            // Hostname IS in scope, now check path
            if (firstSlashIndex > 0) {
                if (url.pathname.startsWith(scopePart2)) {
                    // Path is also in scope
                    console.log("belongsToSite: " + url + " belongs to scope " + scope);
                    return true;
                }
            } else {
                // No path specified, so it's in scope based on hostname alone
                console.log("belongsToSite: " + url + " belongs to scope " + scope);
                return true;
            }
        }
    }
    return false;
}

// Default scope is the hostname, less any www. prefix, with a wildcard prefix
function scopeFromUrl(url) {
    let scope = url.hostname;
    if (scope.startsWith("www.")) {
        scope = scope.substring(4);
    }
    return "*." + scope;
}

let windowManager = {};  // Keeps track of all windows 
// windowManager[windowId] = {
//     siteId: "123456789", // If the window has a siteId, it's a taskbar window
//     unknownWindow: true/false // If the window was not created by Taskbar Tabs, it's exempt from being redirected in onBeforeRequest   
// }

let tabManager = {};  // Keeps track of all tabs
// tabManager[tabId] = {
//     windowId: windowId, // The window the tab belongs to
//     movedFromWindowId: windowId, // The window the tab was moved from, if any. 
//     detachedSiteId: "123456789", // The siteId of the tab assigned when detached. Determines what windows it may be moved to.
//     isBlank: true/false // Tab was created in a taskbar window, but hasn't been navigated to a real URL yet
//     isNew: true/false // Tab was created in a taskbar window, but hasn't been touched by the user
//     noCapture: true/false // Tab should not capture links
//     iconURL: "https://example.com/favicon.ico" // The icon URL for the tab
// }

//Count the number of detached tabs
function detachedTabCount() {
    const count = Object.values(tabManager).filter(tab => tab.detachedSiteId !== "none").length;
    console.log("detachedTabCount: " + count);
    return count;
}

// Return a list of detachedTabs from the tabManager
function reduceToDetachedTabs() {
    console.log("reduceToDetachedTabs: tabManager has " + Object.keys(tabManager).length + " tabs");
    let detachedTabs = {};
    for (let tabId in tabManager) {
        if (tabManager[tabId].detachedSiteId !== "none") {
            detachedTabs[tabId] = tabManager[tabId];
        }
    }
    console.log("reduceToDetachedTabs: detachedTabs: " + JSON.stringify(detachedTabs));
    return detachedTabs;
}

const newTabPages = ["about:startpage", "about:newtab", "about:home", "about:new"];  // List of pages that are considered "new tab" pages

// Update the icon/tooltip of the page action button based on whether the window is in the taskbar
function setPageAction(tabId, inTaskbar) {
    console.log("setPageAction: tabId " + tabId + ", inTaskbar: " + inTaskbar);
    if (inTaskbar) {
        browser.pageAction.setIcon({ tabId: tabId, path: "images/tabs.png" });
        browser.pageAction.setTitle({ tabId: tabId, title: "Move tab out of taskbar" });
        browser.pageAction.show(tabId);
        // If this is not a taskbar window, update the page action to show the "Move to taskbar" icon
    } else if (tabManager[tabId] && tabManager[tabId].noCapture) {
        browser.pageAction.setIcon({ tabId: tabId, path: "images/no-capture.png" });
        browser.pageAction.setTitle({ tabId: tabId, title: "Move tab to taskbar (Note: Link capture is disabled for this tab)" });
        browser.pageAction.show(tabId);
    } else {
        browser.pageAction.setIcon({ tabId: tabId, path: "images/taskbar.png" });
        browser.pageAction.setTitle({ tabId: tabId, title: "Move tab to taskbar" });
        browser.pageAction.show(tabId);
    }
}

// When page action is clicked, move the tab to or from the taskbar
browser.pageAction.onClicked.addListener((tab) => {
    // If this is a taskbar window, move the tab out of the taskbar
    if (windowManager[tab.windowId] && windowManager[tab.windowId].siteId !== "") {
        console.log("pageAction.onClicked: windowId: " + tab.windowId + " (taskbar window), tabId: " + tab.id)
        moveFromTaskbar(tab);
        // If this is not a taskbar window, move the tab to the taskbar
    } else {
        console.log("pageAction.onClicked: windowId: " + tab.windowId + " (normal window), tabId: " + tab.id)
        moveToTaskbar(tab);
    }
});

//Move a tab from a normal window to a taskbar window
//This function lets the event handlers for windows and tabs do as much of the work as possible
//The only meaningful thing this function does is update tab detach info so that a detached tab doesn't inherit
//the siteId of the window it came from
function moveToTaskbar(tab) {
    console.log("moveToTaskbar: tabId: " + tab.id, ", from windowId: " + tab.windowId);
    let fromWindow = tab.windowId;
    let url = new URL(tab.url);
    siteId = belongsToSite(url);
    if (siteId === "") {
        let scope = scopeFromUrl(url);
        siteId = crc32(scope);
    }

    //Update tab detach info for this tab, even though it hasn't detached yet.
    //This lets us assign a siteId even though the window it came from didn't have one
    tabManager[tab.id] = {
        ...tabManager[tab.id],
        movedFromWindowId: fromWindow,
        detachedSiteId: siteId,
    }

    // Check if there is already a window with that siteId
    let taskbarWindow = parseInt(Object.keys(windowManager).find(windowId => windowManager[windowId].siteId === siteId));
    // If there is, move the tab to that window. Also create a new window if the site has LINK_BEHAVIOR_NEWWINDOW
    if (taskbarWindow && installedSites[siteId] && (parseInt(installedSites[siteId].linkBehavior) !== LINK_BEHAVIOR_NEWWINDOW)) {
        console.log("moveToTaskbar: Window already exists for siteId: " + siteId + ", moving tab id: " + tab.id + " to window id: " + taskbarWindow)

        //Focus the destination window
        browser.windows.update(taskbarWindow, { focused: true });
        // Move the tab to the destination window
        browser.tabs.move([tab.id], { windowId: taskbarWindow, index: -1 }, function () {
            if (browser.runtime.lastError) {
                console.error("Error moving tab: " + browser.runtime.lastError.message);
                return;
            }
            console.log("moveToTaskbar: Tab id: " + tab.id + " moved to window id: " + taskbarWindow)
        });
        // If there is not, create a new window and move the tab to that window
        // Note any installation or conversion of this new window to a taskbar window is taken care of by event handlers
    } else {
        console.log("moveToTaskbar: No window exists for siteId: " + siteId + ", or the site has LINK_BEHAVIOR_NEWWINDOW")
        console.log("Creating new window and moving tab id: " + tab.id + " to that window")
        browser.windows.create({
            tabId: tab.id,
            focused: true
        }, function (window) {
            if (browser.runtime.lastError) {
                console.error("Error creating window: " + browser.runtime.lastError.message);
                return;
            }
            console.log("moveToTaskbar: Tab id: " + tab.id + " moved to new taskbar window id: " + window.id)
        });
    }
}

//Move a tab from a taskbar window to a normal window. Like moveToTaskbar, this function lets the event handlers
//for windows and tabs do as much of the work as possible. In addition to setting no siteId in tab detach info,
//this function also uninstalls the site if this is the last tab in the window
function moveFromTaskbar(tab, markNoCapture = true, newWindow = false) {
    console.log("moveFromTaskbar: tabId " + tab.id, ", from windowId: " + tab.windowId);
    if (markNoCapture) { tabManager[tab.id].noCapture = true; }
    siteId = windowManager[tab.windowId].siteId;

    //Update detachedTabs for this tab, even though it hasn't detached yet.
    //This lets us assign no siteid even though the window it came from had one
    tabManager[tab.id] = {
        ...tabManager[tab.id],
        detachedSiteId: ""
    }

    let destinationWindow = 0;

    // Find an existing window unless the caller explicitly asked for a new one
    if (!newWindow) {
        // Try to find the window that the tab was originally moved from. this is a "nice to have" feature that
        // covers for a case when a user installs a site and then immediately uninstalls it. 
        for (let windowId in windowManager) {
            if (windowId !== tab.windowId && parseInt(tabManager[tab.id].movedFromWindowId) === parseInt(windowId)) {
                destinationWindow = parseInt(windowId);
                console.log("moveFromTaskbar: Window id: " + windowId + " was previous home of tab id: " + tab.id)
                break;
            }
        }

        // The origin window does not exist, so find the most recently focused window which is not in the taskbar
        if (destinationWindow == 0) {
            console.log("moveFromTaskbar: No previous window found for tab id: " + tab.id)
            console.log("moveFromTaskbar: windowManager: " + JSON.stringify(windowManager))
            for (let windowId in windowManager) {
                if (!windowManager[windowId].siteId) {
                    destinationWindow = parseInt(windowId);
                    console.log("Window id: " + windowId + " is the most recently active non-taskbar window")
                    break;
                }
            }
        }
    }

    // If we have an existing window to move to, move the tab to that window
    if (destinationWindow !== 0) {
        browser.windows.update(destinationWindow, { focused: true });
        browser.tabs.move([tab.id], {
            windowId: destinationWindow,
            index: -1
        }, function () {
            if (browser.runtime.lastError) {
                console.error("Error moving tab: " + browser.runtime.lastError.message);
                return;
            }
            console.log("moveFromTaskbar: Tab id: " + tab.id + " moved to window id: " + destinationWindow)
            // tabs.move can complete before a newly empty window closes, and I don't know how to elegantly for that
            // TODO: Figure out how to wait for the window to close
            setTimeout(function () {
                if (siteClosed(siteId)) {
                    console.log("moveFromTaskbar: Site id: " + siteId + " has no more windows, uninstalling")
                    uninstallSite(siteId);
                }
            }, 500);
        });
    } else {
        // Otherwise create a new one
        browser.windows.create({
            tabId: tab.id,
            focused: true
        }, function (window) {
            if (browser.runtime.lastError) {
                console.error("Error creating window: " + browser.runtime.lastError.message);
                return;
            }
            console.log("moveFromTaskbar: Tab id: " + tab.id + " moved to new window id: " + window.id)
            // tabs.move can complete before a newly empty window closes, and I don't know how to elegantly for that
            // TODO: Figure out how to wait for the window to close
            setTimeout(function () {
                if (siteClosed(siteId)) {
                    console.log("moveFromTaskbar: Site id: " + siteId + " has no more windows, uninstalling")
                    uninstallSite(siteId);
                }
            }, 500);
        });
    }
}

// Return true if there are no more windows left for the given siteId
function siteClosed(siteId) {
    console.log("siteClosed: siteId: " + siteId);
    for (let windowId in windowManager) {
        if (windowManager[windowId].siteId === siteId) {
            console.log("siteClosed: siteId: " + siteId + " still has window id: " + windowId);
            return false;
        }
    }
    console.log("siteClosed: siteId: " + siteId + " has no more windows");
    return true;
}

// Created windows do not track where they came from, so there isn't a way for Taskbar Tabs to 
// support the use case of having the "new window" menu option open a new window for the installed
// site if chosen from a window for a site. So we just deem new window to be normal windows. 
// If capture is in place for this site and a new window is opened to a link for an installed 
// site it will be captured and become a taskbar window via OnBeforeRequest. TODO: Fix this
browser.windows.onCreated.addListener(function (window) {
    console.log("window.onCreated: windowId: " + window.id)

    if (detachedTabCount() > 0) {

        // Wait for detachedTabs to be empty
        let timedOut = true;
        interval = setInterval(function () {
            if (detachedTabCount() > 0) {
                console.log("window.onCreated: Waiting for zero detached tabs")
            } else {
                console.log("window.onCreated: Zero detached tabs")
                if (!windowManager[window.id]) {
                    windowManager[window.id] = {
                        siteId: "",
                        unknownWindow: true
                    };
                    console.log("window.onCreated: Added unknown window id: " + window.id + " to windowManager with no siteId")
                } else {
                    console.log("window.onCreated: Window id: " + window.id + " already in windowManager")
                }
                timedOut = false;
                clearInterval(interval);
            }
        }, 100);

        setTimeout(function () {
            if (timedOut) {
                console.log("window.onCreated: Timed out waiting for zero detached tabs")
                clearInterval(interval);
                for (let tabId in tabManager) {
                    if (tabManager[tabId]) { tabManager[tabId].detachedSiteId = "none" };
                }
            }
        }, 5000);

    } else {
        if (!windowManager[window.id]) {
            windowManager[window.id] = {
                siteId: "",
                unknownWindow: true
            };
            console.log("window.onCreated: Added unknown window id: " + window.id + " to windowManager with no siteId")
        } else {
            console.log("window.onCreated: Window id: " + window.id + " already in windowManager")
        }
    }
});

// If it's not already installed, installs the site for the given scope
// Then sets the AUMID, separatng this window into its own taskbar entry
function makeTaskbarWindow(windowId, scope, installSite) {
    console.log("makeTaskbarWindow: windowId: " + windowId + ", scope: " + scope + ", installSite: " + installSite)
    siteId = crc32(scope);
    if (installSite) {

        GetActiveTabIconURL(windowId).then((activeTabIconURL) => {

            addInstalledSite(windowId, {
                id: siteId,
                scope: scope,
                displayName: getDisplayName(scope),
                launchWithFirefox: settings.launchWithFirefox,
                homepage: "https://" + scope.replace("*.", ""),
                linkBehavior: settings.linkBehavior,
                newTabHomepage: settings.newTabHomepage,
                pinned: settings.pinSite,
                iconURL: activeTabIconURL
            }).then(() => {
                console.log("makeTaskbarWindow: Setting AUMID for window id: " + windowId + " to siteId: " + siteId)
                browser.experiments.taskbar_tabs.setAUMID(windowId, siteId);
                browser.sessions.setWindowValue(windowId, "siteId", siteId);
            });
        });
    } else {
        console.log("makeTaskbarWindow: Setting AUMID for window id: " + windowId + " to siteId: " + siteId)
        browser.experiments.taskbar_tabs.setAUMID(windowId, siteId);
        browser.sessions.setWindowValue(windowId, "siteId", siteId);
    }
}

// Calculate a default display name from a scope
// www.facebook.com becomes Facebook, news.yahoo.com become Yahoo News
// Any path is appended to the end, with invalid characters replaced with spaces
function getDisplayName(scope) {
    console.log("getDisplayName: scope: " + scope)
    scopeUrl = new URL("https://" + scope.replace("*.", ""))
    const parsed = psl.parse(scopeUrl.hostname);
    console.log("parsed: " + JSON.stringify(parsed))
    let parts = [];
    if (parsed.subdomain) {
        parts = parsed.subdomain.split('.');
    }
    parts.push(parsed.sld);
    console.log("parts: " + JSON.stringify(parts))

    if (parts[0] === 'www') {
        parts.shift();
    }

    for (let i = 0; i < parts.length; i++) {
        parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].slice(1);
    }

    displayName = parts.reverse().join(' ');
    displayName = displayName + scopeUrl.pathname;
    displayName = displayName.replace(/[\\/:*?"<>|]/g, ' ')
    displayName = displayName.replace(/\b\w/g, char => char.toUpperCase());
    displayName = displayName.replace(/^\s+|\s+$/g, '');

    console.log("getDisplayName: displayName: " + displayName)
    return displayName;
}

// Computes the CRC32 hash of a string. This used as the siteID for installed sites and a few other things
function crc32(str) {
    console.log("crc32: str: " + str.substring(0, 100))
    let crcTable = [];
    for (let i = 0; i < 256; i++) {
        let current = i;
        for (let j = 0; j < 8; j++) {
            if (current & 1) {
                current = 0xEDB88320 ^ (current >>> 1);
            } else {
                current = current >>> 1;
            }
        }
        crcTable[i] = current;
    }

    let crc = 0 ^ (-1);
    for (let i = 0; i < str.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ str.charCodeAt(i)) & 0xFF];
    }

    return ((crc ^ (-1)) >>> 0).toString();
}

// When window is focused move it to the top of the windowManager
browser.windows.onFocusChanged.addListener((windowId) => {
    console.log("window.onFocusedChanged: windowId: " + windowId)
    if (windowId !== browser.windows.WINDOW_ID_NONE && windowManager[windowId]) {
        const savedWindowId = windowManager[windowId];
        delete windowManager[windowId];
        windowManager[windowId] = savedWindowId;
        console.log("window.onFocusedChanged: Window focused and moved to top of focus list: " + windowId)
    }
});

// When a window is closed, remove the entry from the windowManager
browser.windows.onRemoved.addListener(function (windowId) {
    console.log("window.onRemoved: windowId: " + windowId + " removed from windowManager");
    delete windowManager[windowId];
});

//If this is a MoveToTaskbar or MoveFromTaskbar operation, tab detach info will alread be filled out with the information about the destination window
//If this is a "move to new window", a tab drag out into a new window, a tab drag between windows, or programmatic equivalent, we fill out
//tab detach info with the information about the window it came from. 
browser.tabs.onDetached.addListener((tabId, detachInfo) => {
    console.log("tab.OnDetached: Tab id: " + tabId + " detached from window id: " + detachInfo.oldWindowId)
    let detachedTabs = reduceToDetachedTabs();
    if (!detachedTabs[tabId]) {
        console.log("tab.OnDetached: Tab id: " + tabId + " not in detachedTabs. Adding it.")
        let oldSiteId = "";
        if (windowManager[detachInfo.oldWindowId]) {
            oldSiteId = windowManager[detachInfo.oldWindowId].siteId;
        }
        tabManager[tabId] = {
            ...tabManager[tabId],
            detachedSiteId: oldSiteId,
        };
        console.log("tab.OnDetached: detachedTabs updated for tab id: " + tabId)
    }
});

//All tab move operations end here. This handles the following cases:
//If detached tab has no siteId, this can result in a new regular window or adding a tab to an existing regular window
//Trying to moved a detached tab without a siteId to a window with a siteId will bounce the tab back to the original window
//UNLESS... the siteIds happen to match, in which case the tab will be added to the taskbar window
//If detached tabs has a siteId and a new window is created, it will result in a new taskbar window for that siteId
//If detached tabs has a siteId, it can be dragged to another taskbar window with the same siteId
//If detached tabs has a siteId, it can be dragged to a regular window, which has the same effect as MoveFromTaskbar
browser.tabs.onAttached.addListener((tabId, attachInfo) => {
    console.log("tab.onAttached: Tab id: " + tabId + " attached to window id: " + attachInfo.newWindowId)
    let detachedTabs;
    // Wait until there is a detachedTabs entry for this tab
    let interval = setInterval(function () {
        detachedTabs = reduceToDetachedTabs();
        if (detachedTabs[tabId]) {
            clearInterval(interval);

            //If the window is new (not in the windowManager yet), it becomes a taskbar window or not depending on the tab's detachedSiteId
            if (!windowManager[attachInfo.newWindowId]) {
                console.log("tab.onAttached: New window id: " + attachInfo.newWindowId + " not in windowManager yet")
                //If the source window has a blank siteId, the new window is not a taskbar window
                if (detachedTabs[tabId].detachedSiteId === "") {
                    console.log("tab.onAttached: Tab id: " + tabId + " has a blank detachedSiteId. Adding window id: " + attachInfo.newWindowId +
                        " to windowManager as a regular window")
                    windowManager[attachInfo.newWindowId] = {
                        siteId: "",
                        unknownWindow: false
                    };
                    getWindowStateFromTab(tabId);
                    tabManager[tabId].movedFromWindowId = 0;
                    console.log("tab.onAttached: Tab id: " + tabId + " with blank detachedSiteId moved to new regular window id: " + attachInfo.newWindowId)
                } else {
                    //If the tab has a non-blank detachedSiteId, or if it has no siteId but the source window does, the new window is a taskbar window
                    console.log("tab.onAttached: Tab id: " + tabId + " has detachedSiteId: " + detachedTabs[tabId].detachedSiteId + ". Adding window id: " +
                        attachInfo.newWindowId + " to windowManager as a taskbar window")

                    windowManager[attachInfo.newWindowId] = {
                        siteId: detachedTabs[tabId].detachedSiteId,
                        unknownWindow: false
                    };

                    // If the site is already installed, just make the window a taskbar window
                    if (installedSites[detachedTabs[tabId].detachedSiteId]) {
                        makeTaskbarWindow(attachInfo.newWindowId, installedSites[detachedTabs[tabId].detachedSiteId].scope, false);
                    } else { // If the site is not installed, we need to get the tab URL to calculate a scope to install, and then call makeTaskbarWindow
                        browser.tabs.get(tabId, function (tab) {
                            if (browser.runtime.lastError) {
                                console.error("Error getting tab: " + browser.runtime.lastError.message);
                                return;
                            }
                            let scope = scopeFromUrl(new URL(tab.url));
                            makeTaskbarWindow(attachInfo.newWindowId, scope, true);
                        });
                    }
                    getWindowStateFromTab(tabId);
                    console.log("tab.onAttached: Tab id: " + tabId + " with siteId: " + detachedTabs[tabId].detachedSiteId + " moved to new taskbar window id: " +
                        attachInfo.newWindowId)
                }
                if (tabManager[tabId]) { tabManager[tabId].detachedSiteId = "none" };

            } else { // If the window is not new, the window state doesn't need updating, but the window might need to reject the tab

                // The window can accept the tab under three circumstances:
                // 1. The window has no siteId
                // 2. The window has the same siteId as the tab
                // 3. The tab has no siteId and it's URL is in scope for the window. 
                browser.tabs.get(tabId, function (tab) {
                    if (browser.runtime.lastError) {
                        console.error("Error getting tab: " + browser.runtime.lastError.message);
                        return;
                    }
                    let detachedTabUrl = new URL(tab.url);

                    if (windowManager[attachInfo.newWindowId].siteId === detachedTabs[tabId].detachedSiteId
                        || windowManager[attachInfo.newWindowId].siteId === ""
                        || isInScope(detachedTabUrl, installedSites[windowManager[attachInfo.newWindowId].siteId].scope)) {

                        getWindowStateFromTab(tabId);
                        focusTab(attachInfo.newWindowId, tabId)

                        if (tabManager[tabId]) { tabManager[tabId].detachedSiteId = "none" };

                        if (windowManager[attachInfo.newWindowId].siteId === "") {
                            tabManager[tabId].movedFromWindowId = 0;
                        }

                        // If the tab was moved from a site window to a normal window, disable link capture
                        if (windowManager[attachInfo.newWindowId].siteId === "" && detachedTabs[tabId].detachedSiteId !== "") {
                            tabManager[tabId].noCapture = true;
                        }

                        console.log("tab.onAttached: Tab id: " + tabId + " with siteId " + detachedTabs[tabId].detachedSiteId +
                            " moved to window id: " + attachInfo.newWindowId)

                    } else { // If the window rejects the tab, it becomes its own normal window                                
                        console.log("tab.onAttached: Tab id: " + tabId + " with siteId " + detachedTabs[tabId].detachedSiteId + " does not match window id: " +
                            attachInfo.newWindowId + " with siteId: " + windowManager[attachInfo.newWindowId].siteId + ". Creating new window")
                        browser.windows.create({ tabId: tabId, focused: true }, function (window) {
                            if (browser.runtime.lastError) {
                                console.error("Error creating window: " + browser.runtime.lastError.message);
                                if (tabManager[tabId]) { tabManager[tabId].detachedSiteId = "none" };
                                return;
                            }
                            // Enter this into windowManager and clear detach info
                            windowManager[window.id] = {
                                siteId: "",
                                unknownWindow: false
                            }
                            if (tabManager[tabId]) { tabManager[tabId].detachedSiteId = "none" };
                            tabManager[tabId].movedFromWindowId = 0;
                            tabManager[tabId].noCapture = true;
                        });
                    }
                });
            }
        } else {
            console.log("tab.onAttached: Tab id: " + tabId + " attached to window id: " + attachInfo.newWindowId + " but not in detachedTabs yet");
        }
    }, 100);

    setTimeout(function () {
        clearInterval(interval);
    }, 5000);

});

//Focus the tab specified
function focusTab(windowId, tabId) {
    console.log("focusTab: Focusing tab id: " + tabId + " in window id: " + windowId)
    browser.windows.update(windowId, { focused: true }, function (window) {
        if (browser.runtime.lastError) {
            console.error("Error updating window: " + browser.runtime.lastError.message);
            return;
        }
        browser.tabs.update(tabId, { active: true }, function (tab) {
            if (browser.runtime.lastError) {
                console.error("Error updating tab: " + browser.runtime.lastError.message);
                return;
            }
        });
    });
}

//Get the window state from a tab when it becomes active
browser.tabs.onActivated.addListener((activeInfo) => {
    console.log("tab.onActivated: Tab id: " + activeInfo.tabId + " activated in window id: " + activeInfo.windowId)
    getWindowStateFromTab(activeInfo.tabId);
});

// When the tab is navigated, remove any unknownWindow flag from its parent window
// When the favicon URL is changed, update the URL in the tab manager and the window manager
// Note that we don't update the favicon URL for the installed site. We'll save this icon once, when the site is installed
// After these updates, get the window state from the tab if it's the active tab
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        console.log("tab.onUpdated: URL for tab id: " + tabId + " updated in window id: " + tab.windowId + " with url: " + changeInfo.url)

        // If this is not a blank tab, remove the unknownWindow flag from the parent window
        if (changeInfo.url !== "about:blank") {

            // Clear unknownWindow flag from parent window
            if (windowManager[tab.windowId] && windowManager[tab.windowId].unknownWindow) {
                console.log("tab.onUpdated: Window id: " + tab.windowId + " is no longer an unknown window")
                windowManager[tab.windowId].unknownWindow = false;
            }

            // If we determined when the tab was created that this was a new tab in a taskbar window, but it was at about:blank
            // we have some operations we can do now that we know the URL. 
            if (tabManager[tabId].isBlank) {
                tabManager[tabId].isBlank = false;
                handleNewTaskbarTab(tab);
            }
        }

        getWindowStateFromTab(tabId);
    }

    if (changeInfo.favIconUrl)
    {
        console.log("tab.onUpdated: Favicon URL for tab id: " + tabId + " updated in window id: " + tab.windowId + " with url: " + changeInfo.favIconUrl)
        getWindowStateFromTab(tabId);
    }

});

// Keep track of which tabs belong to which windows
// Also, when a tab is closed, remove it from various tab tracking lists
browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
    console.log("tab.onRemoved: Tab id: " + tabId + " removed from window id: " + removeInfo.windowId)
    delete tabManager[tabId];
});

// 1. Keep movedFromWindowId up to date if this tab was moved from another window.
// 2. Also handle the case where there is a new tab in a taskbar window. If it's opened to one of the URLs which matches a
// "new tab page" then OnBeforeRequest won't handle it. We need to handle it here instead by redirecting it to the homepage
// of the site or moving it to a new window, depending on the newTabHomepage setting.
browser.tabs.onCreated.addListener((tab) => {

    tabManager[tab.id] = {
        windowId: tab.windowId,
        movedFromWindowId: 0,
        detachedSiteId: "none",
        isBlank: false,
        isNew: true,
        noCapture: false,
    }
    console.log("tab.onCreated: Tab id: " + tab.id + " created in window id: " + tab.windowId + " for url: " + tab.url);

    // If the tab was created in a taskbar window
    if (windowManager[tab.windowId] && windowManager[tab.windowId].siteId !== "") {
        console.log("tab.onCreated: Tab id: " + tab.id + " created in taskbar window");

        //New tabs in taskbar windows should inherit the movedFromWindowId of their opener tab
        if (tab.openerTabId) {
            tabManager[tab.id].movedFromWindowId = tabManager[tab.openerTabId].movedFromWindowId;
        }

        // We need to perform some actions on new tabs, but in practice they often start with about:blank, so we need to wait
        // until the tab is actually updated to a real URL to do anything. So we flag the tab here and we'll do work in 
        // tab.onUpdated
        if (tab.url === "about:blank") {
            tabManager[tab.id].isBlank = true;
        } else {
            handleNewTaskbarTab(tab);
        }
    }
});

// When a new tab is created in a taskbar window, it might need special handling if:
// 1. The user pressed the "new tab" button in the taskbar window
// 2. Windows launched a URL in Firefox and Firefox chose a taskbar window for it
// If not, all new tabs in taskbar windows are marked as "unused" and may be closed automatically if they were only used to
// redirect to a new URL that OnBeforeRequest moved to a different window
function handleNewTaskbarTab(tab) {
    let windowSiteId = windowManager[tab.windowId].siteId;
    let windowUrl = new URL(installedSites[windowSiteId].homepage)
    let tabUrl = new URL(tab.url);
    let wasNewTabPage = false;
    let hasOpenerId = tab.openerTabId !== undefined;
    tabManager[tab.id].isNew = true;

    // If the tab URL is not http, https, or one of the new tab pages, it's probably a file or about: page. We don't need to do anything
    if (tabUrl.protocol !== "http:" && tabUrl.protocol !== "https:" && !newTabPages.includes(tabUrl.href)) {
        console.log("handleNewTaskbarTab: Tab id: " + tab.id + " is a new tab for a taskbar window, but it's not http. Ignoring")
        return;
    }

    // If the tab was created for a new tab page, redirect to home page or move the tab to a normal window
    if (newTabPages.includes(tabUrl.href)) {
        if (installedSites[windowSiteId].newTabHomepage) {
            browser.tabs.update(tab.id, { url: installedSites[windowSiteId].homepage });
            tabManager[tab.id].isNew = false;
            wasNewTabPage = true;
            console.log("handleNewTaskbarTab: Tab id: " + tab.id + " is a new tab for a taskbar window. becaause newTabHomepage is true, redirecting to home page for the site")

            // Move the tab to a new window. This is the least disruptive way to give the user a new tab that isn't in scope. 
        } else {
            console.log("handleNewTaskbarTab: Tab id: " + tab.id + " is a new tab for a taskbar window. because newTabHomepage is false, moving to a new window")
            moveFromTaskbar(tab, false, true);
            return;
        }
    }

    requestSiteId = belongsToSite(tabUrl);
    console.log("handleNewTaskbarTab: Tab id: " + tab.id + " belongs to siteId: " + requestSiteId)
    console.log("handleNewTaskbarTab: wasNewTab is " + wasNewTabPage + " and linkBehavior is " + installedSites[windowSiteId].linkBehavior)

    // If the tab was created for the current site, but that site has linkBehavior LINK_BEHAVIOR_NEWWINDOW, move the tab to a new window
    if (parseInt(installedSites[windowSiteId].linkBehavior) === LINK_BEHAVIOR_NEWWINDOW && (wasNewTabPage || (domainsMatch(windowUrl, tabUrl)))) {
        console.log("handleNewTaskbarTab: Tab id: " + tab.id + " is a new tab for a taskbar window with LINK_BEHAVIOR_NEWWINDOW. Moving to new window")
        tabManager[tab.id] = {
            ...tabManager[tab.id],
            movedFromWindowId: windowId,
            detachedSiteId: windowSiteId,
        }

        browser.windows.create({
            tabId: tab.id,
            focused: true
        }, function (window) {
            if (browser.runtime.lastError) {
                console.error("Error creating window: " + browser.runtime.lastError.message);
                return;
            }
            makeTaskbarWindow(window.id, installedSites[windowSiteId].scope, false)
            console.log("handleNewTaskbarTab: Tab id: " + tab.id + " moved to new window id: " + windowId)
        });
        return;
    }

    // OnBeforeRequest will let the request through if it matches the *domain* of the current site, even if it's out of scope. 
    // So if site scope is sub.example.com and the request is for example.com, it will be allowed. But this can also happen
    // by coincidence if the OS opens a link to example.com and chooses a taskbar window for it at random. In that case 
    // we'll move the tab out of the taskbar. It should be OK to use MoveFromTaskbar to do it because OnBeforeRequest also 
    // checks to see if the site is part of another site's scope, and if it is, it will be captured that way. We have to do
    // this here because we need to know if the tab was opened by this window, and we can't know that in OnBeforeRequest
    if (!wasNewTabPage && !hasOpenerId && !domainsMatch(windowUrl, tabUrl)) {
        console.log("handleNewTaskbarTab: Tab id: " + tab.id + " is a new tab for a taskbar window, but it's out of scope. Moving to new window")
        moveFromTaskbar(tab, false);
        return;
    }
    console.log("handleNewTaskbarTab for tab id: " + tab.id + " complete")
}

// The given tab might be blank, or it might be classified as "unused" if it was only used to redirect to a new URL
// ("Unused" means .isNew === true. We can unify the naming some time. I'm sleepy.)
// Under these circumstances, we want to close the tab
function closeUnusedTab(tabId) {
    console.log("closeUnusedTab: Tab id: " + tabId)
    // First check to see if the tab is in the newTaskbarTabs list. If it is, it's unused and we can close it
    if (tabManager[tabId] && tabManager[tabId].isNew) {
        console.log("closeUnusedTab: Closing unused tab id: " + tabId)
        browser.tabs.remove(tabId, function () { if (browser.runtime.lastError) { return } });
        return
    }
    // If it's not in the newTaskbarTabs list, it might just be blank. Check to see if it's blank and close it. 
    browser.tabs.get(tabId, function (tab) {
        if (browser.runtime.lastError) { return }
        console.log("Checking if tab id: " + tabId + " is blank. URL is " + tab.url)
        if (tab.url === "about:blank") {
            browser.tabs.remove(tabId);
            console.log("closeUnusedTab: Closing blank tab id: " + tabId)
        }
        return;
    });
}

// Compare domains of two URLs. If they match, return true. Otherwise return false
function domainsMatch(url1, url2) {
    console.log("domainsMatch: url1: " + url1 + ", url2: " + url2)
    url1Domain = psl.parse(url1.hostname).domain;
    url2Domain = psl.parse(url2.hostname).domain;
    console.log("domainsMatch: " + (url1Domain === url2Domain ? "true" : "false"))
    return url1Domain === url2Domain;
}

let delayedRequests = {} // List of requests that were delayed by a previous run of OnBeforeRequest

browser.webRequest.onBeforeRequest.addListener(
    (details) => {
        console.log("onBeforeRequest: Tab id: " + details.tabId + " for url: " + details.url);
        let requestId = crc32(details.url + details.tabId);

        // CASE #2 - Requests from extension background processes, dev tools, sidebars, and whatever else that doesn't
        // have a tabId are ignored
        if (details.tabId === -1) {
            console.log("onBeforeRequest: Tab id: " + details.tabId + " is -1. Ignoring request.")
            return ({ cancel: false })
        }

        // CASE #1 - Under three circumstances we need to wait before handling this request:
        // 1. Initialization is not complete. This happens when the extension is first installed or enabled.
        // 2. detachedTabs is not empty, meaning a tab move operation is in progress.
        // 3. The current tab is not in the tab manager yet
        if (!initialized || detachedTabCount() > 0 || !tabManager[details.tabId]) {
            console.log("onBeforeRequest: Initialization, tab move, or tab create in progress. Delaying request for tab id: " + details.tabId)
            if (delayedRequests[requestId] && delayedRequests[requestId].count >= 10) {
                console.log("onBeforeRequest: Tab id: " + details.tabId + " has been delayed too many times. Allowing request to go through");
                return ({ cancel: false });
            } else {
                if (delayedRequests[requestId]) {
                    delayedRequests[requestId].count++;
                } else {
                    delayedRequests[requestId] = { count: 1 };
                }
                setTimeout(function () {
                    browser.tabs.update(details.tabId, { url: details.url });
                }, 100);
                return ({ cancel: true });
            }
        }

        if (delayedRequests[requestId]) {
            console.log("onBeforeRequest: Removing delayedRequest entry for: " + details.tabId)
            delete delayedRequests[requestId];
        }

        requestWindowId = tabManager[details.tabId].windowId;
        requestUrl = new URL(details.url);
        requestSiteId = belongsToSite(requestUrl);

        // CASE #3 - If this is a new window and it didn't come from something Taskbar Tabs did, we have to assume it might be a taskbar launch
        // In reality it might be any of the following:
        // 1. A taskbar launch, which we do want to capture into a site window
        // 2. Firefox.exe is launched without a URL when it's running
        // 3. Firefox.exe is launched with a URL when it's not running
        // 4. A link from any window is opened in a new window by the user or by the site
        // 5. The user explicitly chooses CTRL+N or the new window menu option
        // TODO: We need to figure out how to distinguish between these cases. For now we just assume it's a taskbar launch
        if (!windowManager[requestWindowId] || windowManager[requestWindowId].unknownWindow) {
            console.log("onBeforeRequest: Window id: " + requestWindowId + " is a new window. Add or updating it in windowManager")
            windowManager[requestWindowId] = {
                siteId: requestSiteId,
                unknownWindow: false
            }

            if (requestSiteId) {
                console.log("onBeforeRequest: New window id: " + requestWindowId + " is for site id: " + requestSiteId + ". Making it a taskbar window")
                makeTaskbarWindow(requestWindowId, installedSites[requestSiteId].scope, false);
            }
            return { cancel: false };
        }

        // Handle cases where we are in a taskbar window. 
        if (windowManager[requestWindowId] && windowManager[requestWindowId].siteId !== "") {
            console.log("onBeforeRequest: Tab id: " + details.tabId + " is in taskbar window id: " + requestWindowId + " with siteId: "
                + windowManager[requestWindowId].siteId)

            siteUrl = new URL(installedSites[windowManager[requestWindowId].siteId].homepage);
            if (domainsMatch(requestUrl, siteUrl) && (requestSiteId === "" || requestSiteId === windowManager[requestWindowId].siteId)) {

                // CASE #4 - This is a request to the same domain as the taskbar window, and doesn't belong to any other installed site.
                // We allow such requests to go through. Some sites switch domains, especially for login flows and such. But this  
                // is definitely a fragile and imprecise decision. TODO: We should study how to do this better. 
                console.log("onBeforeRequest: Request to " + requestUrl.hostname + " in taskbar window id: " + requestWindowId +
                    " matches window domain " + siteUrl.hostname + ", allowing request")
                return { cancel: false };

            } else { // This is an out of scope request in a taskbar window, so it needs to be redirected

                console.log("onBeforeRequest: Request to " + requestUrl.hostname + " in taskbar window id: " + requestWindowId +
                    " does not match window domain " + siteUrl.hostname + ", redirecting request to another window");

                // CASE #5 - If the request is for an installed site, but that site wants to open links in a new window, do that
                // We don't have to worry about making it a taskbar window. OnBeforeRequest will get called again for the new window
                if (requestSiteId && parseInt(installedSites[requestSiteId].linkBehavior) === LINK_BEHAVIOR_NEWWINDOW) {
                    console.log("onBeforeRequest: Request for installed site with LINK_BEHAVIOR_NEWWINDOW - Opening new window")
                    browser.windows.create({ url: requestUrl.href });
                    closeUnusedTab(details.tabId);
                    return { cancel: true };
                }

                // CASE #6 - If the request is for an installed site, but that site doesn't want capture, redirect to a regular window
                // To do this we just set requestSiteId to an empty string and in the loop below it will be matched to a 
                // window which also has an empty string for siteId
                if (requestSiteId && parseInt(installedSites[requestSiteId].linkBehavior) === LINK_BEHAVIOR_NOCAPTURE) {
                    console.log("onBeforeRequest: Request for installed site with LINK_BEHAVIOR_NOCAPTURE - Redirecting to a normal window")
                    requestSiteId = "";
                }

                // Look for a window to transfer this request to
                for (let newWindowId in windowManager) {
                    console.log("onBeforeRequest: Window id: " + newWindowId + " has siteId: " + windowManager[newWindowId].siteId +
                        " and requestSiteId: " + requestSiteId)

                    // Stop on the first matching window
                    if (windowManager[newWindowId].siteId === requestSiteId) {
                        console.log("onBeforeRequest: Found existing window id: " + newWindowId + " for site id: " + requestSiteId)

                        // CASE #7 - If the request is for an installed site that wants to navigate existing tabs, do that
                        if (requestSiteId && parseInt(installedSites[requestSiteId].linkBehavior) === LINK_BEHAVIOR_CURRENTTAB) {
                            console.log("onBeforeRequest: Request for installed site with LINK_BEHAVIOR_CURRENTTAB - Redirecting to existing tab")
                            browser.windows.update(parseInt(newWindowId), { focused: true }, function (window) {
                                if (browser.runtime.lastError) {
                                    console.error("Error updating window: " + browser.runtime.lastError.message);
                                    return;
                                }
                                browser.tabs.query({ windowId: parseInt(newWindowId), active: true }, function (tabs) {
                                    if (browser.runtime.lastError) {
                                        console.error("Error querying for tabs: " + browser.runtime.lastError.message);
                                        return;
                                    }
                                    browser.tabs.update(tabs[0].id, { url: requestUrl.href }, function (tab) {
                                        if (browser.runtime.lastError) {
                                            console.error("Error updating tab: " + browser.runtime.lastError.message);
                                            return;
                                        }
                                    });
                                });
                            });
                            closeUnusedTab(details.tabId);
                            return { cancel: true };
                        } else {
                            // CASE #8 - If the request is for a new tab outside the current site, move or redirect to the found window
                            console.log("onBeforeRequest: Request for a new tab outside the current site, including installed sites which");
                            console.log("onBeforeRequest: have LINK_BEHAVIOR_NEWTAB or LINK_BEHAVIOR_NOCAPTURE. Moving or redirecting to existing window")
                            if (tabManager[details.tabId].isNew) {
                                console.log("onBeforeRequest: Moving to window id: " + newWindowId);
                                tabManager[details.tabId] = {
                                    ...tabManager[details.tabId],
                                    movedFromWindowId: requestWindowId,
                                    detachedSiteId: requestSiteId
                                }
                                browser.tabs.move([details.tabId], {
                                    windowId: parseInt(newWindowId),
                                    index: -1
                                });
                                return { cancel: false };
                            } else {
                                console.log("onBeforeRequest: Opening new tab in window id: " + newWindowId);
                                browser.windows.update(parseInt(newWindowId), { focused: true }, function (window) {
                                    if (browser.runtime.lastError) {
                                        console.error("Error updating window: " + browser.runtime.lastError.message);
                                        return;
                                    }
                                    browser.tabs.create({ windowId: window.id, url: requestUrl.href });
                                });
                                closeUnusedTab(details.tabId);
                                return { cancel: true };
                            }
                        }
                    }
                }
                // CASE #9 - If there is no window for the site, open or move to a new window

                // Fill out detach info for the tab. We may or may not move it, but either way this will prevent the new 
                // window from classified as an unknown window. 
                tabManager[details.tabId] = {
                    ...tabManager[details.tabId],
                    movedFromWindowId: requestWindowId,
                    detachedSiteId: requestSiteId
                }
                if (tabManager[details.tabId].isNew) {
                    console.log("onBeforeRequest: No existing window for site. Moving to new window")
                    // We can fire and forget this one. It will become a taskbar window or not when onBeforeRequest is called again
                    browser.windows.create({ tabId: details.tabId, focused: true });
                    return { cancel: false };
                } else {
                    console.log("onBeforeRequest: No existing window for site. Opening new window")
                    browser.windows.create({ url: requestUrl.href }, function (window) {
                        if (browser.runtime.lastError) {
                            console.error("Error creating window: " + browser.runtime.lastError.message);
                            if (tabManager[details.tabId]) { tabManager[details.tabId].detachedSiteId = "none" };
                            return;
                        }
                        // Enter this into windowManager, make it a taskbar window if needed, and clear detach info
                        windowManager[window.id] = {
                            siteId: requestSiteId,
                            unknownWindow: false
                        }
                        if (requestSiteId) {
                            makeTaskbarWindow(window.id, installedSites[requestSiteId].scope, false);
                        }
                        if (tabManager[details.tabId]) { tabManager[details.tabId].detachedSiteId = "none" };
                    });
                    closeUnusedTab(details.tabId);
                    return { cancel: true };
                }
            }

        } else { // Handle cases where we are in a normal window

            // CASE #10 - If the tab is in the noCaptureTabs list, allow the request. This is the list of tabs that the user
            // manually moved back to a regular window. We don't want to capture them again.
            if (tabManager[details.tabId].noCapture) {
                console.log("onBeforeRequest: Tab id: " + details.tabId + " is in noCaptureTabs list. Allowing request.")
                return { cancel: false };
            }

            if (!requestSiteId || (requestSiteId && parseInt(installedSites[requestSiteId].linkBehavior) === LINK_BEHAVIOR_NOCAPTURE)) {

                // CASE #11 - If the request is not for an installed site, allow it. This is the 95% case!
                // Also allow requests for installed sites that don't want capture. Probably the 4% case. :-)
                console.log("onBeforeRequest: Request to " + requestUrl + " is not for an installed site or does not capture links, allowing request")
                return { cancel: false };

            } else { // Handle cases where the request is for an installed site

                console.log("onBeforeRequest: Request to " + requestUrl + " is for an installed site")

                // CASE #12 - If the request is for an installed site, but that site wants to open links in a new window, do that
                // We don't have to worry about making it a taskbar window. OnBeforeRequest will get called again for the new window
                if (requestSiteId && parseInt(installedSites[requestSiteId].linkBehavior) === LINK_BEHAVIOR_NEWWINDOW) {
                    console.log("onBeforeRequest: LINK_BEHAVIOR_NEWWINDOW - Opening new window")
                    browser.windows.create({ url: requestUrl.href });
                    closeUnusedTab(details.tabId);
                    return { cancel: true };
                }

                // Look for a window to transfer this request to
                for (let newWindowId in windowManager) {
                    console.log("onBeforeRequest: Window id: " + newWindowId + " has siteId: " + windowManager[newWindowId].siteId +
                        " and requestSiteId: " + requestSiteId)

                    // Stop on the first matching window
                    if (windowManager[newWindowId].siteId === requestSiteId) {
                        console.log("onBeforeRequest: Found existing window id: " + newWindowId + " for site id: " + requestSiteId)

                        // CASE #13 - If the request is for an installed site that wants to navigate existing tabs, do that
                        if (requestSiteId && parseInt(installedSites[requestSiteId].linkBehavior) === LINK_BEHAVIOR_CURRENTTAB) {
                            console.log("onBeforeRequest: LINK_BEHAVIOR_CURRENTTAB - Navigating existing tab")
                            browser.windows.update(parseInt(newWindowId), { focused: true }, function (window) {
                                if (browser.runtime.lastError) {
                                    console.error("Error updating window: " + browser.runtime.lastError.message);
                                    return;
                                }
                                browser.tabs.query({ windowId: parseInt(newWindowId), active: true }, function (tabs) {
                                    if (browser.runtime.lastError) {
                                        console.error("Error querying for tabs: " + browser.runtime.lastError.message);
                                        return;
                                    }
                                    browser.tabs.update(tabs[0].id, { url: requestUrl.href }, function () {
                                        if (browser.runtime.lastError) {
                                            console.error("Error updating tab: " + browser.runtime.lastError.message);
                                            return;
                                        }
                                    });
                                });
                            });
                            closeUnusedTab(details.tabId);
                            return { cancel: true };
                        } else {

                            // CASE #14 - If the request is for a new tab in an installed site, move or redirect to the found window
                            console.log("onBeforeRequest: Request for a new tab outside the current site, including installed sites which");
                            console.log("onBeforeRequest: have LINK_BEHAVIOR_NEWTAB or LINK_BEHAVIOR_NOCAPTURE. Moving or redirecting to existing window")
                            if (tabManager[details.tabId].isNew) {
                                console.log("onBeforeRequest: Moving to window id: " + newWindowId);
                                tabManager[details.tabId] = {
                                    ...tabManager[details.tabId],
                                    movedFromWindowId: requestWindowId,
                                    detachedSiteId: requestSiteId
                                }
                                browser.tabs.move([details.tabId], {
                                    windowId: parseInt(newWindowId),
                                    index: -1
                                });
                                return { cancel: false };
                            } else {
                                console.log("onBeforeRequest: Opening new tab in window id: " + newWindowId);
                                browser.windows.update(parseInt(newWindowId), { focused: true }, function (window) {
                                    if (browser.runtime.lastError) {
                                        console.error("Error updating window: " + browser.runtime.lastError.message);
                                        return;
                                    }
                                    browser.tabs.create({ windowId: window.id, url: requestUrl.href });
                                });
                                closeUnusedTab(details.tabId);
                                return { cancel: true };
                            }
                        }
                    }
                }

                // CASE #15 - If there is no window for the site, open or move to a new window

                // Fill out detach info for the tab. We may or may not move it, but either way this will prevent the new 
                // window from classified as an unknown window. 
                tabManager[details.tabId] = {
                    ...tabManager[details.tabId],
                    movedFromWindowId: requestWindowId,
                    detachedSiteId: requestSiteId
                }
                if (tabManager[details.tabId].isNew) {
                    console.log("onBeforeRequest: No existing window for site. Moving to new window")
                    // We can fire and forget this one. It will become a taskbar window or not when onBeforeRequest is called again
                    browser.windows.create({ tabId: details.tabId, focused: true });
                    return { cancel: false };
                } else {
                    console.log("onBeforeRequest: No existing window for site. Opening new window")
                    browser.windows.create({ url: requestUrl.href }, function (window) {
                        if (browser.runtime.lastError) {
                            console.error("Error creating window: " + browser.runtime.lastError.message);
                            if (tabManager[details.tabId]) { tabManager[details.tabId].detachedSiteId = "none" };
                            return;
                        }
                        // Enter this into windowManager, make it a taskbar window if needed, and clear detach info
                        windowManager[window.id] = {
                            siteId: requestSiteId,
                            unknownWindow: false
                        }
                        if (requestSiteId) {
                            makeTaskbarWindow(window.id, installedSites[requestSiteId].scope, false);
                        }
                        if (tabManager[details.tabId]) { tabManager[details.tabId].detachedSiteId = "none" };
                    });
                    closeUnusedTab(details.tabId);
                    return { cancel: true };
                }
            }
        }
    }, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] }, ['blocking']
);

// Handle messages communicated from the content process of the page or popup
browser.runtime.onMessage.addListener(function (request, sender) {

    //Current tab had user interaction
    if (request.type === 'tabInteraction') {
        console.log("onMessage:tabInteraction: Tab id: " + sender.tab.id + " had user interaction")
        tabManager[sender.tab.id].isNew = false;
    }

    // Popup requests to know it's type
    if (request.type === 'getPopupType') {
        console.log("onMessage:getPopupType");
        browser.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (browser.runtime.lastError) {
                console.error("Error querying for tabs: " + browser.runtime.lastError.message);
                return;
            }
            windowId = tabs[0].windowId;
            if (windowManager[windowId].siteId === "") {
                browser.runtime.sendMessage({ type: "setPopupType", popupType: "main" })
                console.log("onMessage:getPopupType: main")
            } else {
                browser.runtime.sendMessage({ type: "setPopupType", popupType: "site" })
                console.log("onMessage:getPopupType: site")
            }
        });
    }

    // Popup requests information for the main popup
    if (request.type === 'getMainPopupInfo') {
        console.log("onMessage:getMainPopupInfo");
        browser.runtime.sendMessage({ type: "setMainPopupInfo", windowManager: windowManager, installedSites: installedSites, settings: settings })
        console.log("onMessage:getMainPopupInfo: windowManager response: " + JSON.stringify(windowManager))
        console.log("onMessage:getMainPopupInfo: installedSites response: " + JSON.stringify(installedSites))
        console.log("onMessage:getMainPopupInfo: settings response: " + JSON.stringify(settings))
    }

    //Popup requests to update a global setting
    if (request.type === 'updateSettings') {
        console.log("onMessage:updateSettings: " + JSON.stringify(request.settings));
        updateSettings(request.settings);
        browser.runtime.sendMessage({ type: "setMainPopupInfo", windowManager: windowManager, installedSites: installedSites, settings: settings })
        console.log("onMessage:updateSettings: settings update complete. Sending response to popup")
    }

    // Popup requests to activate the site given
    if (request.type === 'activateSite') {
        console.log("onMessage:activateSite: siteId: " + request.siteId);

        // Search through the windowManager for the first window with a matching siteId
        for (let windowId in windowManager) {
            if (windowManager[windowId].siteId === request.siteId) {
                console.log("onMessage:activateSite: Found window id: " + windowId + " with matching siteId: " + request.siteId)
                browser.windows.update(parseInt(windowId), { focused: true }, function (window) {
                    if (browser.runtime.lastError) {
                        console.error("Error updating window: " + browser.runtime.lastError.message);
                        return;
                    }
                    browser.tabs.query({ windowId: parseInt(windowId), active: true }, function (tabs) {
                        if (browser.runtime.lastError) {
                            console.error("Error querying for tabs: " + browser.runtime.lastError.message);
                            return;
                        }
                        browser.tabs.update(tabs[0].id, { active: true }, function (tab) {
                            if (browser.runtime.lastError) {
                                console.error("Error updating tab: " + browser.runtime.lastError.message);
                                return;
                            }
                        });
                    });
                });
                return;
            }
        }

        // If we didn't find a window, open the site
        console.log("onMessage:activateSite: No window found with matching siteId: " + request.siteId + ". Opening new window")
        browser.windows.create({ url: installedSites[request.siteId].homepage });
    }

    // Popup requests to uninstall the site given
    if (request.type === 'uninstallSite') {
        console.log("onMessage:uninstallSite: siteId: " + request.siteId);

        // Find all the tabs and all the windows for this site and move them out of the taskbar. moveToTaskbar will handle
        // uninstalling the site as long as the site is running. Otherwise we do that directly. 
        console.log("onMessage:uninstallSite: Moving all tabs for site id: " + request.siteId + " out of the taskbar")
        let siteWindows = [];
        for (let windowId in windowManager) {
            if (windowManager[windowId].siteId === request.siteId) {
                siteWindows.push(windowId);
                browser.tabs.query({ windowId: parseInt(windowId) }, function (tabs) {
                    if (browser.runtime.lastError) {
                        console.error("Error querying for tabs: " + browser.runtime.lastError.message);
                        return;
                    }
                    for (let tab of tabs) {
                        moveFromTaskbar(tab, false);
                    }
                });
            }
        }

        if (siteWindows.length === 0) {
            uninstallSite(request.siteId);
        }

        // Wait for the site to be fully uninstalled before sending the response to the popup
        interval = setInterval(function () {
            if (!installedSites[request.siteId] && siteWindows.every(windowId => !windowManager[windowId])) {
                clearInterval(interval);
                browser.runtime.sendMessage({ type: "setMainPopupInfo", windowManager: windowManager, installedSites: installedSites, settings: settings })
                console.log("onMessage:uninstallSite: site uninstall complete. Sending response to popup")
            }
        }, 100);

        setTimeout(function () {
            clearInterval(interval);
        }, 5000);
    }

    // Popup requests information about the site for the window it's in
    if (request.type === 'getInstalledSite') {
        console.log("onMessage:getInstalledSite");
        browser.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (browser.runtime.lastError) {
                console.error("Error querying for tabs: " + browser.runtime.lastError.message);
                return;
            }
            windowId = tabs[0].windowId;
            siteId = installedSites[windowManager[windowId].siteId].id;
            browser.runtime.sendMessage({ type: "setInstalledSite", installedSite: installedSites[siteId] })
            console.log("onMessage:getInstalledSite: installSite response: " + JSON.stringify(installedSites[siteId]))
        });
    }

    // User has saved an update to site properties in the popup
    if (request.type === 'updateInstalledSite') {
        console.log("onMessage:updateInstalledSite: property: " + request.property + " value: " + request.value);
        browser.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (browser.runtime.lastError) {
                console.error("Error querying for tabs: " + browser.runtime.lastError.message);
                return;
            }
            windowId = tabs[0].windowId;
            siteId = windowManager[windowId].siteId

            switch (request.property) {

                case "displayName":
                    // If the displayName is empty or contains characters that are invalid in a filename, do nothing
                    if (request.value === "" || request.value.match(/[/\\?%*:|"<>]/) !== null) {
                        console.log("onMessage:updateInstalledSite: Invalid displayName. Not changing displayName.")
                        browser.runtime.sendMessage({ type: "setInstalledSite", installedSite: installedSites[siteId] })
                        break;
                    }

                    let oldDisplayName = installedSites[siteId].displayName;
                    updateInstalledSite(siteId, { displayName: request.value });
                    refreshPinnedState().then(function () {
                        GetActiveTabIconURL(windowId).then((activeTabIconURL) => {
                            browser.experiments.taskbar_tabs.deleteShortcut(siteId, oldDisplayName, false);
                            windowManager[windowId].iconURL = activeTabIconURL;
                            browser.experiments.taskbar_tabs.createShortcut(siteId, windowId, activeTabIconURL, request.value, installedSites[siteId].homepage,
                                installedSites[siteId].pinned);
                            browser.runtime.sendMessage({ type: "setInstalledSite", installedSite: installedSites[siteId] });
                        });
                    });
                    break;

                case "scope":
                    // When the scope changes we need to uninstall and reinstall the entire site
                    newScope = request.value;
                    newSiteId = crc32(newScope);

                    //Check to see if the current tab is in the new scope
                    currentUrl = new URL(tabs[0].url);
                    if (!isInScope(currentUrl, newScope)) {
                        console.log("onMessage:updateInstalledSite: Current tab is not in the new scope. Not changing scope.")
                        browser.runtime.sendMessage({ type: "setInstalledSite", installedSite: installedSites[siteId] })
                        break;
                    }

                    //Check to see if the new scope is already in use
                    if (installedSites[newSiteId]) {
                        console.log("onMessage:updateInstalledSite: New scope is already in use. Not changing scope.")
                        browser.runtime.sendMessage({ type: "setInstalledSite", installedSite: installedSites[siteId] })
                        break;
                    }

                    // If we made it here, we're OK to change the scope of the window
                    // Temporarily update the current installedSite to not capture links
                    oldLinkBehavior = installedSites[siteId].linkBehavior;
                    installedSites[siteId].linkBehavior = LINK_BEHAVIOR_NOCAPTURE;

                    //Loop through all the windows and tabs for this site and move tabs that 
                    //are not in the new scope out of the taskbar
                    for (let windowId in windowManager) {
                        if (windowManager[windowId].siteId === siteId) {
                            browser.tabs.query({ windowId: parseInt(windowId) }, function (tabs) {
                                if (browser.runtime.lastError) {
                                    console.error("Error querying for tabs: " + browser.runtime.lastError.message);
                                    return;
                                }
                                for (let tab of tabs) {
                                    if (!isInScope(new URL(tab.url), newScope)) {
                                        console.log("onMessage:updateInstalledSite: Tab id: " + tab.id + " is not in the new scope. Moving it to a regular window.")
                                        moveFromTaskbar(tab, false);
                                    }
                                }
                            });
                        }
                    }

                    // If the old homepage is not in the new scope, we need to reset the homepage
                    currentHomepageUrl = new URL(installedSites[siteId].homepage);
                    if (isInScope(currentHomepageUrl, newScope)) {
                        console.log("onMessage:updateInstalledSite: Current homepage is in the new scope. Not changing homepage.")
                        newHomepage = installedSites[siteId].homepage;
                    } else {
                        console.log("onMessage:updateInstalledSite: Current homepage is not in the new scope. Resetting homepage.")
                        newHomepage = "https://" + newScope.replace("*.", "");
                    }

                    refreshPinnedState().then(function () {

                        GetActiveTabIconURL(windowId).then((activeTabIconURL) => {

                            installSite = {
                                id: newSiteId,
                                scope: newScope,
                                displayName: getDisplayName(newScope),
                                launchWithFirefox: installedSites[siteId].launchWithFirefox,
                                homepage: newHomepage,
                                linkBehavior: oldLinkBehavior,
                                newTabHomepage: installedSites[siteId].newTabHomepage,
                                pinned: installedSites[siteId].pinned,
                                iconURL: activeTabIconURL
                            }

                            // Next, we need to uninstall the site
                            uninstallSite(siteId);

                            // Now add a new installed site
                            addInstalledSite(windowId, installSite).then(function () {

                                // Update the windowManager and set the AUMID for each window
                                for (let windowId in windowManager) {
                                    if (windowManager[windowId].siteId === siteId) {
                                        windowManager[windowId].siteId = newSiteId;
                                        browser.experiments.taskbar_tabs.setAUMID(parseInt(windowId), newSiteId);
                                    }
                                }
                                browser.runtime.sendMessage({ type: "setInstalledSite", installedSite: installedSites[newSiteId] });
                            }).catch(error => {
                                console.error("Failed to add installed site:", error);
                            });
                        });
                    });
                    break;

                case "homepage":
                    // When the homepage changes we need to remove and recreate the shortcut
                    homepage = request.value;
                    // If the homepage is not in the scope of the site, do nothing
                    if (isInScope(new URL(homepage), installedSites[siteId].scope)) {
                        updateInstalledSite(siteId, { homepage: homepage });
                        refreshPinnedState().then(function () {
                            GetActiveTabIconURL(windowId).then((activeTabIconURL) => {
                                browser.experiments.taskbar_tabs.deleteShortcut(siteId, installedSites[siteId].displayName, false);
                                windowManager[windowId].iconURL = activeTabIconURL;
                                browser.experiments.taskbar_tabs.createShortcut(siteId, windowId, activeTabIconURL, installedSites[siteId].displayName, homepage, installedSites[siteId].pinned);
                                browser.runtime.sendMessage({ type: "setInstalledSite", installedSite: installedSites[siteId] })
                            });
                        });
                    } else {
                        console.log("onMessage:updateInstalledSite: New homepage is not in the site scope. Not changing homepage.")
                        browser.runtime.sendMessage({ type: "setInstalledSite", installedSite: installedSites[siteId] })
                    }
                    break;

                case "linkBehavior":
                    // Update the link behavior of the site
                    updateInstalledSite(siteId, { linkBehavior: request.value });
                    browser.runtime.sendMessage({ type: "setInstalledSite", installedSite: installedSites[siteId] })
                    break;

                case "launchWithFirefox":
                    // Update the launchWithFirefox property of the site
                    updateInstalledSite(siteId, { launchWithFirefox: request.value });
                    browser.runtime.sendMessage({ type: "setInstalledSite", installedSite: installedSites[siteId] })
                    break;

                case "newTabHomepage":
                    // Update the newTabHomepage property of the site
                    updateInstalledSite(siteId, { newTabHomepage: request.value });
                    browser.runtime.sendMessage({ type: "setInstalledSite", installedSite: installedSites[siteId] })
                    break;

                default:
                    console.log("onMessage:updateInstalledSite: Unknown property: " + request.property);
            }
        });
    }
});

// The current tab affects the window in two ways:
// 1. The current tab determines the state of the page action button
// 2. The current tab determines the icon of the taskbar window
function getWindowStateFromTab(tabId) {
    console.log("getWindowStateFromTab: Tab id: " + tabId);
    browser.tabs.get(tabId, function (tab) {
        if (browser.runtime.lastError) {
            console.error("Error getting tab: " + browser.runtime.lastError.message);
            return;
        }

        // Only do this if the tab is the active tab in the window
        if (tab.active) {

            windowId = tab.windowId;
            tabManager[tabId].windowId = windowId;

            if (windowManager[windowId] && windowManager[windowId].siteId !== "" && tab.url.startsWith("http")) {
                
                console.log("getWindowStateFromTab: " + tabId + " is a taskbar tab");
                setPageAction(tabId, true);

                console.log("getWindowStateFromTab: " + tabId + " has favIconUrl: " + tab.favIconUrl);

                if (windowManager[windowId].iconURL !== tab.favIconUrl) {
                    console.log("getWindowStateFromTab: Setting icon for window id: " + windowId + " to: " + tab.favIconUrl);
                    windowManager[windowId].iconURL = tab.favIconUrl;
                    browser.experiments.taskbar_tabs.setIcon(windowId, tab.favIconUrl);
                }

            } else {
                
                console.log("getWindowStateFromTab: " + tabId + " is not a taskbar tab");
                setPageAction(tabId, false);

            }
        }
    });
}

// Wait for the active tab to have a defined non-blank favIconUrl and then return it
function GetActiveTabIconURL(windowId) {
    console.log("GetActiveTabIconURL: Window id: " + windowId);
    return new Promise((resolve, reject) => {
        browser.tabs.query({ windowId: windowId, active: true }, function (tabs) {
            if (browser.runtime.lastError) {
                console.error("GetActiveTabIconURL: Error querying for tabs: " + browser.runtime.lastError.message);
                reject(browser.runtime.lastError.message);
            }
            if (tabs[0].favIconUrl && tabs[0].favIconUrl !== "") {
                console.log("GetActiveTabIconURL: Active tab with id " + tabs[0].id + " has favIconUrl: " + tabs[0].favIconUrl);
                resolve(tabs[0].favIconUrl);
            } else {
                console.log("GetActiveTabIconURL: Active tab with id " + tabs[0].id + " does not have a favIconUrl. Waiting for it to load.");  
                interval = setInterval(function () {
                    browser.tabs.query({ windowId: windowId, active: true }, function (tabs) {
                        if (tabs[0].favIconUrl && tabs[0].favIconUrl !== "") {
                            console.log("GetActiveTabIconURL: Active tab with id " + tabs[0].id + " now has a favIconUrl: " + tabs[0].favIconUrl);
                            clearInterval(interval);
                            resolve(tabs[0].favIconUrl);
                        }
                        else
                        {
                            console.log("GetActiveTabIconURL: Active tab with id " + tabs[0].id + " still does not have a favIconUrl. Waiting for it to load.");
                        }
                    });
                }, 100);
            }
        });
    });
}

// Initialization

// Copy pin.exe to the profile directory
// Amazing that this can even be done from a webextension, though of course it's only because it's
// a privileged extension
pinexeUrl = browser.runtime.getURL("pin.exe")
console.log("Initialization: Copying pin.exe to profile directory: " + pinexeUrl)
browser.experiments.taskbar_tabs.copyPinexe(pinexeUrl);

// Load settings from storage
browser.storage.local.get("settings", function (result) {
    if (browser.runtime.lastError) {
        console.error("Error loading installed sites: " + browser.runtime.lastError.message);
        return;
    }
    if (result.settings) {
        settings = result.settings;
    }
    console.log("Initialization: settings: " + JSON.stringify(settings));
});

// Load the list of installed sites from storage
browser.storage.local.get("installedSites", function (result) {
    if (browser.runtime.lastError) {
        console.error("Error loading installed sites: " + browser.runtime.lastError.message);
        return;
    }
    installedSites = result.installedSites || {};
    sortInstalledSites();
    refreshPinnedState().then(function () {
        console.log("Initialization: installedSites: " + JSON.stringify(installedSites));

        // Add any existing windows to windowManager and set tab state for all tabs
        browser.windows.getAll({ populate: true }, function (windows) {
            if (browser.runtime.lastError) {
                console.error("Error getting all windows: " + browser.runtime.lastError.message);
                return;
            }
            console.log("Initialization: Found windows: " + windows.length)

            initializeWindowManager(windows).then(function () {

                initialized = true;

                // Launch all installed sites where launchWithFirefox is true and they aren't already in windowManager
                // onBeforeRequest will handle making them into taskbar windows 
                Object.values(installedSites).forEach(function (installedSite) {
                    if (installedSite.launchWithFirefox && !windowManager[installedSite.id]) {
                        console.log("Initialization: Launching installed site: " + installedSite.displayName)
                        browser.windows.create({ url: installedSite.homepage }).then(function (window) {
                            if (browser.runtime.lastError) {
                                console.error("Error creating window: " + browser.runtime.lastError.message);
                                return;
                            }
                        })
                    }
                });
            });
        });
    });
});

// Initialize the windowManager object based on siteIds stored on each window in session storage
function initializeWindowManager(windows) {
    let promises = windows.map(function (window) {
        return browser.sessions.getWindowValue(window.id, "siteId").then(function (siteId) {

            // If the siteId is not in installedSites, something went wrong with storage and 
            // we're forced to to treat the window as a normal window. 
            if (!siteId || !installedSites[siteId]) {
                siteId = ""
            }

            console.log("initializeWindowManager: Window id: " + window.id + " has siteId: " + siteId + " and " + window.tabs.length + " tabs")
            windowManager[window.id] = {
                siteId: siteId,
                unknownWindow: false
            };
            if (siteId !== "") {
                makeTaskbarWindow(window.id, installedSites[siteId].scope, false);
            }
            window.tabs.forEach(function (tab) {
                tabManager[tab.id] = {
                    windowId: window.id,
                    movedFromWindowId: 0,
                    detachedSiteId: "none",
                    isBlank: false,
                    isNew: false,
                    noCapture: false
                };

                getWindowStateFromTab(tab.id);
            });
        });
    });
    return Promise.all(promises).then(function () {
        console.log("Window manager initialized");
    });
}