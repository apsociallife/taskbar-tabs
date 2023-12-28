
// Globals for the popup
var displayNameInput = document.getElementById('displayNameInput');
var saveDisplayName = document.getElementById('saveDisplayName');
var displayNameInitial = ""

var homepageInput = document.getElementById('homepageInput');
var saveHomepage = document.getElementById('saveHomepage');
var homepageInitial = ""

var scopeInput = document.getElementById('scopeInput');
var saveScope = document.getElementById('saveScope');
var scopeInitial = ""

var uninstallSite = document.getElementById('uninstallSite');
var manageSites = document.getElementById('manageSites');

var defaultPinSite = document.getElementById('defaultPinSite');
var defaultLaunchWithFirefox = document.getElementById('defaultLaunchWithFirefox');
var defaultNewTabBehavior = document.getElementById('defaultNewTabBehavior');
var defaultLinkBehavior = document.getElementById('defaultLinkBehavior');

var backButton = document.getElementById('backButton');

var gSettings = {};
var gSiteId = "";

// The input boxes and save buttons are all configured similarly, so we use this
// object and the attachInputEvents function to attach the events to all of them
const inputsConfig = {
    'displayNameInput': { initial: "", saveButton: 'saveDisplayName' },
    'homepageInput': { initial: "", saveButton: 'saveHomepage' },
    'scopeInput': { initial: "", saveButton: 'saveScope' },
};

function attachInputEvents(id) {
    const element = document.getElementById(id);
    const saveButton = document.getElementById(inputsConfig[id].saveButton);

    // Makes the save button visible when the input box is changed
    element.addEventListener('input', function () {
        if (element.value !== inputsConfig[id].initial) {
            saveButton.style.display = 'inline';
        } else {
            saveButton.style.display = 'none';
        }
    });

    // Sets or removes hover effect on the save button
    saveButton.addEventListener('mouseover', function () {
        saveButton.src = chrome.runtime.getURL('images/save-hover.png');
    });
    saveButton.addEventListener('mouseout', function () {
        saveButton.src = chrome.runtime.getURL('images/save-white.png');
    });
}

// Save the display name as long as it's not empty or too long
saveDisplayName.addEventListener('click', function () {
    displayNameInput.value = displayNameInput.value.trim();
    if (!(displayNameInput.value.length === 0 || displayNameInput.value.length > 255)) {
        displayNameInitial = displayNameInput.value;
        saveDisplayName.style.display = 'none';
        chrome.runtime.sendMessage({ type: "updateInstalledSite", property: "displayName", value: displayNameInput.value })
    }
});

saveHomepage.addEventListener('click', function () {
    homepageInput.value = homepageInput.value.trim();
    try {
        if (!/^https?:\/\//i.test(homepageInput.value)) {
            homepageInput.value = 'https://' + homepageInput.value;
        }
        let url = new URL(homepageInput.value);
        if (homepageInput.value.length === 0 || homepageInput.value.length > 4096) {
            throw new Error('Invalid URL length');
        }
        homepageInitial = homepageInput.value;
        saveHomepage.style.display = 'none';
        chrome.runtime.sendMessage({ type: "updateInstalledSite", property: "homepage", value: homepageInput.value })
    } catch (err) {
        console.error('Invalid URL:', err.message);
    }
});

// Save the scope as long as it's a hostname with an optional wildcard prefix and optional path
saveScope.addEventListener('click', function () {
    let hostnameRegex = /^(\*\.)?((?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63}(?<!-))*)(\/[\w.-]*)*$/;
    scopeInput.value = scopeInput.value.trim();
    if (!(scopeInput.value.length === 0 || scopeInput.value.length > 255 || !hostnameRegex.test(scopeInput.value))) {
        scopeInitial = scopeInput.value;
        saveScope.style.display = 'none';
        chrome.runtime.sendMessage({ type: "updateInstalledSite", property: "scope", value: scopeInput.value });
    }
});

// Save the link behavior
linkBehavior.addEventListener('change', function () {
    chrome.runtime.sendMessage({ type: "updateInstalledSite", property: "linkBehavior", value: linkBehavior.value })
});

// Save the launch with Firefox setting
launchWithFirefox.addEventListener('change', function () {
    chrome.runtime.sendMessage({ type: "updateInstalledSite", property: "launchWithFirefox", value: launchWithFirefox.checked })
});

// Save the new tab behavior
newTabHomepage.addEventListener('change', function () {
    chrome.runtime.sendMessage({ type: "updateInstalledSite", property: "newTabHomepage", value: newTabHomepage.checked })
});

// Uninstall the site
uninstallSite.addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: "uninstallSite", siteId: gSiteId });
});

// Switch to the main popup layout
manageSites.addEventListener('click', function () {
    switchLayout("main");
    backButton.style.display = 'inline';
    chrome.runtime.sendMessage({ type: "getMainPopupInfo" });
});

// Switch to the site popup layout
backButton.addEventListener('click', function () {
    switchLayout("site");
});

// Save the default pin site setting
defaultPinSite.addEventListener('change', function () {
    updateSettings();
});

// Save the default launch with Firefox setting
defaultLaunchWithFirefox.addEventListener('change', function () {
    updateSettings();
});

// Save the default new tab behavior setting
defaultNewTabHomepage.addEventListener('change', function () {
    updateSettings();
});

// Save the default link behavior setting
defaultLinkBehavior.addEventListener('change', function () {
    updateSettings();
});

// Save the settings
function updateSettings() {
    gSettings.pinSite = defaultPinSite.checked;
    gSettings.launchWithFirefox = defaultLaunchWithFirefox.checked;
    gSettings.newTabHomepage = defaultNewTabHomepage.checked;
    gSettings.linkBehavior = defaultLinkBehavior.selectedIndex;
    chrome.runtime.sendMessage({ type: "updateSettings", settings: gSettings });
}

// Set the layout of the popup, either the "main" layout or the "site" layout
function switchLayout(layout) {
    document.getElementById('main').style.display = layout === "main" ? 'block' : 'none';
    document.getElementById('site').style.display = layout === "site" ? 'block' : 'none';
}

// Handle messages from the background process
chrome.runtime.onMessage.addListener(function (request) {

    // Sets the popup layout
    if (request.type == "setPopupType") {
        if (request.popupType === "site") {
            switchLayout("site");
            // Ask the background process for the installed site information
            // The response will come async as request.type == "setInstalledSite" and will be handled below
            chrome.runtime.sendMessage({ type: "getInstalledSite"})
        } else {
            switchLayout("main");
            // Ask the background process for main popup information
            // The response will come async as request.type == "setMainPopupInfo" and will be handled below
            chrome.runtime.sendMessage({ type: "getMainPopupInfo" });
        }
    }

    // Sets information about the main popup
    if (request.type == "setMainPopupInfo") {
        gSettings = request.settings;
        
        document.getElementById('defaultPinSite').checked = gSettings.pinSite;
        document.getElementById('defaultLaunchWithFirefox').checked = gSettings.launchWithFirefox;
        document.getElementById('defaultNewTabHomepage').checked = gSettings.newTabHomepage;
        document.getElementById('defaultLinkBehavior').selectedIndex = gSettings.linkBehavior;

        let installedSites = request.installedSites;

        // Add a windowId property to each installed site and set it to 0
        Object.keys(installedSites).forEach(function (siteId) {
            installedSites[siteId].windowId = 0;
        });

        // Loop through the windowManager object and set the windowId property for each installed site
        // This flags sites which are currently open in a window
        for (let windowId in request.windowManager) {
            if (request.windowManager[windowId].siteId) {
                installedSites[request.windowManager[windowId].siteId].windowId = window.id;
            }
        }

        // Sort the installedSites object by whether the site is open and then by display name
        let sortedInstalledSites = Object.keys(installedSites).sort(function (a, b) {
            if (installedSites[a].windowId !== 0 && installedSites[b].windowId === 0) {
                return -1;
            } else if (installedSites[a].windowId === 0 && installedSites[b].windowId !== 0) {
                return 1;
            } else {
                return installedSites[a].displayName.localeCompare(installedSites[b].displayName);
            }
        });

        // Loop through all children of siteList and remove each except id = "siteTemplate"
        let siteList = document.getElementById('siteList');
        let siteListChildren = Array.from(siteList.children);
        siteListChildren.forEach(function (child) {
            if (child.id !== "siteTemplate") {
                siteList.removeChild(child);
            }
        });

        // Loop through the installedSites object and add a site for each one
        Object.keys(sortedInstalledSites).forEach(function (siteNum) {
            let installedSite = installedSites[sortedInstalledSites[siteNum]];
            let site = document.getElementById('siteTemplate').cloneNode(true);
            site.id = `site-${installedSite.id}`;
            site.style.display = "flex";
            site.querySelector('.site-name').textContent = installedSite.displayName;
            if (installedSite.windowId !== 0) {
                site.querySelector('.site-status').style.backgroundColor = "#00ff00";
            }

            site.querySelector('.site-name').id = `siteName-${installedSite.id}`;
            let siteName = site.querySelector(`#siteName-${installedSite.id}`);

            siteName.addEventListener('click', function () {
                chrome.runtime.sendMessage({ type: "activateSite", siteId: installedSite.id });
            });

            site.querySelector('#siteDelete').id = `siteDelete-${installedSite.id}`;
            let deleteBtn = site.querySelector(`#siteDelete-${installedSite.id}`);

            deleteBtn.addEventListener('click', function () {
                chrome.runtime.sendMessage({ type: "uninstallSite", siteId: installedSite.id });
            });

            document.getElementById('siteList').appendChild(site);
        });

    }

    // Sets information about the installed site in site popup mode
    if (request.type == "setInstalledSite") {
        var installedSite = request.installedSite;
        gSiteId = installedSite.id;

        displayNameInput.value = installedSite.displayName;
        displayNameInitial = installedSite.displayName;

        homepageInput.value = installedSite.homepage;
        homepageInitial = installedSite.homepage;

        scopeInput.value = installedSite.scope
        scopeInitial = installedSite.scope

        document.getElementById('linkBehavior').selectedIndex = installedSite.linkBehavior;
        document.getElementById('launchWithFirefox').checked = installedSite.launchWithFirefox;
        document.getElementById('newTabHomepage').checked = installedSite.newTabHomepage;
    }
});

// Page load event
document.addEventListener('DOMContentLoaded', function () {

    chrome.runtime.sendMessage({ type: "getPopupType" });

    // Edit boxes should select all text when focused and save when enter is pressed
    document.querySelectorAll('.editable-input').forEach(input => {
        input.addEventListener('focus', function () {
            this.select();
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.keyCode === 13) {
                e.preventDefault();
                this.nextElementSibling.click();
            }
        });
    });

    // Add events to the input boxes and save buttons
    Object.keys(inputsConfig).forEach(attachInputEvents);
});



