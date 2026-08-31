// Installs a console tap in the parent process that appends Taskbar Tabs log
// output to a file. Run once per Firefox session via:
//
//   .\ff-eval.ps1 -ScriptFile .\log-tap.js
//
// Extension and experiment-API console output goes to the Browser Console via
// console-api-log-event rather than into nsIConsoleService, so it can't be read
// back after the fact. This mirrors it to disk instead.
(() => {
  const LOG_PATH = PathUtils.join(
    PathUtils.tempDir,
    "tt-diag",
    "taskbar-tabs.log"
  );

  // The observer service keeps a strong reference to registered observers, so
  // registering under a private topic doubles as a handle on any tap already
  // installed, which lets a re-run replace it rather than stack a second one.
  const SENTINEL_TOPIC = "taskbar-tabs-log-tap";
  let replaced = 0;
  let existing = Services.obs.enumerateObservers(SENTINEL_TOPIC);
  while (existing.hasMoreElements()) {
    let old = existing.getNext();
    Services.obs.removeObserver(old, "console-api-log-event");
    Services.obs.removeObserver(old, SENTINEL_TOPIC);
    replaced++;
  }

  const encoder = new TextEncoder();
  let queue = Promise.resolve();

  function append(line) {
    queue = queue
      .then(() =>
        IOUtils.write(LOG_PATH, encoder.encode(line + "\n"), {
          mode: "appendOrCreate",
        })
      )
      .catch(() => {});
  }

  const tap = {
    observe(subject, topic) {
      if (topic !== "console-api-log-event") {
        return;
      }
      let event = subject.wrappedJSObject;
      let filename = event.filename || "";
      if (
        event.addonId !== "taskbar-tabs@mozilla.com" &&
        !/taskbar[-_]?tabs|\bapi\.js\b/i.test(filename)
      ) {
        return;
      }
      let text = (event.arguments || [])
        .map(a => {
          try {
            return typeof a === "string" ? a : JSON.stringify(a);
          } catch (e) {
            return String(a);
          }
        })
        .join(" ");
      let source = filename.split("/").pop();
      append(`${new Date().toISOString()} [${event.level}] (${source}:${event.lineNumber}) ${text}`);
    },
  };

  Services.obs.addObserver(tap, "console-api-log-event");
  Services.obs.addObserver(tap, SENTINEL_TOPIC);

  IOUtils.makeDirectory(PathUtils.parent(LOG_PATH), {
    createAncestors: true,
    ignoreExisting: true,
  }).then(() => append(`=== log tap installed ${new Date().toISOString()} ===`));

  return JSON.stringify({ status: "installed", replaced, path: LOG_PATH });
})();
