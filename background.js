/* AutoRefresher - Background Service Worker (Multi-Tab Version) */

const STATE_KEY = "autoRefresherState";
const ALARM_NAME = "autoRefresherAlarm";

const DEFAULT_STATE = {
  tabs: [],           // Array of { tabId, url, title, addedAt }
  minSeconds: 300,
  maxSeconds: 700,
  jitterPercent: 10,
  cacheBust: false,
  isRunning: false,
  nextTabId: null,    // Which tab will be refreshed next
  nextRunAt: null,
  startedAt: null,
  runCount: 0,
  lastRefreshedTabId: null
};

/* ─────────────────────────────────────────────────────────────
   Chrome API helpers (callback-safe)
───────────────────────────────────────────────────────────── */
function chromeGet(key) {
  return new Promise(function(resolve) {
    chrome.storage.sync.get(key, function(result) {
      if (chrome.runtime.lastError) {
        console.warn("chromeGet error:", chrome.runtime.lastError);
        resolve({});
        return;
      }
      resolve(result);
    });
  });
}

function chromeSet(obj) {
  return new Promise(function(resolve) {
    chrome.storage.sync.set(obj, function() {
      if (chrome.runtime.lastError) {
        console.warn("chromeSet error:", chrome.runtime.lastError);
      }
      resolve();
    });
  });
}

function chromeAlarmClear(name) {
  return new Promise(function(resolve) {
    chrome.alarms.clear(name, function() {
      resolve();
    });
  });
}

function chromeTabsQuery(query) {
  return new Promise(function(resolve) {
    chrome.tabs.query(query, function(tabs) {
      if (chrome.runtime.lastError) {
        resolve([]);
        return;
      }
      resolve(tabs || []);
    });
  });
}

function chromeTabsReload(tabId, options) {
  return new Promise(function(resolve, reject) {
    chrome.tabs.reload(tabId, options, function() {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function chromeTabsGet(tabId) {
  return new Promise(function(resolve) {
    chrome.tabs.get(tabId, function(tab) {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(tab);
    });
  });
}

/* ─────────────────────────────────────────────────────────────
   State management
───────────────────────────────────────────────────────────── */
async function getState() {
  var stored = await chromeGet(STATE_KEY);
  return Object.assign({}, DEFAULT_STATE, stored[STATE_KEY] || {});
}

async function setState(update) {
  await chromeSet({ [STATE_KEY]: update });
  return update;
}

function clampSettings(state) {
  var min = Math.max(3, Number(state.minSeconds) || DEFAULT_STATE.minSeconds);
  var max = Math.max(min, Number(state.maxSeconds) || DEFAULT_STATE.maxSeconds);
  var jitter = Math.min(80, Math.max(0, Number(state.jitterPercent) || 0));
  return Object.assign({}, state, { minSeconds: min, maxSeconds: max, jitterPercent: jitter });
}

function pickDelaySeconds(state) {
  var minSeconds = state.minSeconds;
  var maxSeconds = state.maxSeconds;
  var jitterPercent = state.jitterPercent;
  var base = minSeconds + Math.random() * (maxSeconds - minSeconds);
  var jitterAmount = jitterPercent > 0 ? (Math.random() * 2 - 1) * (base * jitterPercent / 100) : 0;
  return Math.max(3, Math.round(base + jitterAmount));
}

/* ─────────────────────────────────────────────────────────────
   Tab helpers
───────────────────────────────────────────────────────────── */
function shortenUrl(url) {
  if (!url) return "--";
  try {
    var u = new URL(url);
    var host = u.hostname.replace(/^www\./, "");
    return host.length > 20 ? host.slice(0, 17) + "..." : host;
  } catch (e) {
    return url.slice(0, 20);
  }
}

function shortenTitle(title) {
  if (!title) return "--";
  return title.length > 25 ? title.slice(0, 22) + "..." : title;
}

async function getActiveTab() {
  var tabs = await chromeTabsQuery({ active: true, currentWindow: true });
  var tab = tabs[0];
  if (!tab || !tab.id || !tab.url) return null;
  
  var forbidden = ["chrome://", "chrome-extension://", "edge://", "about:", "file://"];
  for (var i = 0; i < forbidden.length; i++) {
    if (tab.url.startsWith(forbidden[i])) return null;
  }
  
  return tab;
}

async function isTabAlive(tabId) {
  if (!tabId) return false;
  var tab = await chromeTabsGet(tabId);
  return tab !== null;
}

function pickRandomTab(tabs) {
  if (!tabs || tabs.length === 0) return null;
  var index = Math.floor(Math.random() * tabs.length);
  return tabs[index];
}

/* ─────────────────────────────────────────────────────────────
   Scheduling
───────────────────────────────────────────────────────────── */
async function scheduleNext(delaySeconds) {
  await chromeAlarmClear(ALARM_NAME);
  var minutes = Math.max(0.05, delaySeconds / 60);
  chrome.alarms.create(ALARM_NAME, { delayInMinutes: minutes });
}

/* ─────────────────────────────────────────────────────────────
   Badge
───────────────────────────────────────────────────────────── */
function setBadge(isOn, tabCount) {
  try {
    if (isOn) {
      chrome.action.setBadgeText({ text: String(tabCount || "ON") });
      chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
    } else {
      chrome.action.setBadgeText({ text: "" });
    }
  } catch (err) {
    console.warn("setBadge error:", err);
  }
}

/* ─────────────────────────────────────────────────────────────
   Core actions
───────────────────────────────────────────────────────────── */
async function addCurrentTab() {
  var state = await getState();
  var tab = await getActiveTab();
  
  if (!tab) {
    throw new Error("Cannot add this page (protected URL)");
  }
  
  // Check if already in list
  for (var i = 0; i < state.tabs.length; i++) {
    if (state.tabs[i].tabId === tab.id) {
      throw new Error("Tab already in list");
    }
  }
  
  var newTab = {
    tabId: tab.id,
    url: tab.url,
    title: tab.title || shortenUrl(tab.url),
    addedAt: Date.now()
  };
  
  var newTabs = state.tabs.concat([newTab]);
  var nextState = Object.assign({}, state, { tabs: newTabs });
  await setState(nextState);
  
  if (state.isRunning) {
    setBadge(true, newTabs.length);
  }
  
  return nextState;
}

async function removeTab(tabId) {
  var state = await getState();
  var newTabs = state.tabs.filter(function(t) { return t.tabId !== tabId; });
  
  var nextState = Object.assign({}, state, { tabs: newTabs });
  
  // If no tabs left and running, stop
  if (newTabs.length === 0 && state.isRunning) {
    nextState.isRunning = false;
    nextState.nextTabId = null;
    nextState.nextRunAt = null;
    await chromeAlarmClear(ALARM_NAME);
    setBadge(false);
  } else if (state.isRunning) {
    // If removed tab was next, pick new next
    if (state.nextTabId === tabId && newTabs.length > 0) {
      var nextTab = pickRandomTab(newTabs);
      nextState.nextTabId = nextTab ? nextTab.tabId : null;
    }
    setBadge(true, newTabs.length);
  }
  
  await setState(nextState);
  return nextState;
}

async function clearAllTabs() {
  var state = await getState();
  var nextState = Object.assign({}, state, {
    tabs: [],
    isRunning: false,
    nextTabId: null,
    nextRunAt: null
  });
  await chromeAlarmClear(ALARM_NAME);
  await setState(nextState);
  setBadge(false);
  return nextState;
}

async function startAutoRefresh(partialSettings) {
  var currentState = await getState();
  var merged = clampSettings(Object.assign({}, currentState, partialSettings || {}));
  
  if (merged.tabs.length === 0) {
    throw new Error("Add at least one tab first");
  }
  
  // Verify tabs are still alive
  var aliveTabs = [];
  for (var i = 0; i < merged.tabs.length; i++) {
    var alive = await isTabAlive(merged.tabs[i].tabId);
    if (alive) {
      aliveTabs.push(merged.tabs[i]);
    }
  }
  
  if (aliveTabs.length === 0) {
    throw new Error("All tabs have been closed");
  }
  
  // Pick random tab for first refresh
  var nextTab = pickRandomTab(aliveTabs);
  var delay = pickDelaySeconds(merged);
  var nextRunAt = Date.now() + delay * 1000;
  
  var nextState = Object.assign({}, merged, {
    tabs: aliveTabs,
    isRunning: true,
    nextTabId: nextTab.tabId,
    nextRunAt: nextRunAt,
    startedAt: Date.now(),
    runCount: 0
  });
  
  await setState(nextState);
  await scheduleNext(delay);
  setBadge(true, aliveTabs.length);
  
  return nextState;
}

async function stopAutoRefresh() {
  var state = await getState();
  var nextState = Object.assign({}, state, {
    isRunning: false,
    nextTabId: null,
    nextRunAt: null
  });
  
  await chromeAlarmClear(ALARM_NAME);
  await setState(nextState);
  setBadge(false);
  
  return nextState;
}

async function refreshNow() {
  var state = await getState();
  
  if (state.tabs.length === 0) {
    var tab = await getActiveTab();
    if (tab) {
      try {
        await chromeTabsReload(tab.id, { bypassCache: Boolean(state.cacheBust) });
      } catch (err) {
        console.warn("refreshNow failed:", err);
      }
    }
    return state;
  }
  
  // Pick random tab and refresh
  var randomTab = pickRandomTab(state.tabs);
  if (randomTab) {
    var alive = await isTabAlive(randomTab.tabId);
    if (alive) {
      try {
        await chromeTabsReload(randomTab.tabId, { bypassCache: Boolean(state.cacheBust) });
      } catch (err) {
        console.warn("refreshNow failed:", err);
      }
    }
  }
  
  return state;
}

async function resetCounter() {
  var state = await getState();
  var nextState = Object.assign({}, state, {
    runCount: 0,
    startedAt: state.isRunning ? Date.now() : null
  });
  await setState(nextState);
  return nextState;
}

/* ─────────────────────────────────────────────────────────────
   Alarm handler - The main refresh logic
───────────────────────────────────────────────────────────── */
async function handleAlarm(alarm) {
  if (alarm.name !== ALARM_NAME) return;
  
  var state = await getState();
  if (!state.isRunning || state.tabs.length === 0) {
    await stopAutoRefresh();
    return;
  }
  
  // Clean up dead tabs
  var aliveTabs = [];
  for (var i = 0; i < state.tabs.length; i++) {
    var alive = await isTabAlive(state.tabs[i].tabId);
    if (alive) {
      aliveTabs.push(state.tabs[i]);
    }
  }
  
  if (aliveTabs.length === 0) {
    console.log("AutoRefresher: all tabs closed, stopping.");
    await stopAutoRefresh();
    return;
  }
  
  // Find the tab to refresh (nextTabId or random)
  var tabToRefresh = null;
  for (var j = 0; j < aliveTabs.length; j++) {
    if (aliveTabs[j].tabId === state.nextTabId) {
      tabToRefresh = aliveTabs[j];
      break;
    }
  }
  if (!tabToRefresh) {
    tabToRefresh = pickRandomTab(aliveTabs);
  }
  
  // Refresh the tab
  if (tabToRefresh) {
    try {
      await chromeTabsReload(tabToRefresh.tabId, { bypassCache: Boolean(state.cacheBust) });
      console.log("AutoRefresher: refreshed", tabToRefresh.url);
    } catch (err) {
      console.warn("AutoRefresher: reload failed", err);
      // Remove dead tab
      aliveTabs = aliveTabs.filter(function(t) { return t.tabId !== tabToRefresh.tabId; });
      if (aliveTabs.length === 0) {
        await stopAutoRefresh();
        return;
      }
    }
  }
  
  // Pick NEXT random tab for next refresh
  var nextTab = pickRandomTab(aliveTabs);
  var delay = pickDelaySeconds(state);
  var nextRunAt = Date.now() + delay * 1000;
  
  var nextState = Object.assign({}, state, {
    tabs: aliveTabs,
    runCount: (state.runCount || 0) + 1,
    nextTabId: nextTab ? nextTab.tabId : null,
    nextRunAt: nextRunAt,
    lastRefreshedTabId: tabToRefresh ? tabToRefresh.tabId : null
  });
  
  await setState(nextState);
  await scheduleNext(delay);
  setBadge(true, aliveTabs.length);
}

/* ─────────────────────────────────────────────────────────────
   Message handling
───────────────────────────────────────────────────────────── */
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  var type = message && message.type;
  var payload = message && message.payload;
  
  if (!type) {
    sendResponse({ error: "No message type" });
    return true;
  }

  (async function() {
    try {
      var result;
      
      if (type === "getState") {
        result = await getState();
      } else if (type === "updateSettings") {
        var state = await getState();
        var nextState = clampSettings(Object.assign({}, state, payload || {}));
        result = await setState(nextState);
      } else if (type === "addTab") {
        result = await addCurrentTab();
      } else if (type === "removeTab") {
        result = await removeTab(payload.tabId);
      } else if (type === "clearTabs") {
        result = await clearAllTabs();
      } else if (type === "start") {
        result = await startAutoRefresh(payload);
      } else if (type === "stop") {
        result = await stopAutoRefresh();
      } else if (type === "toggle") {
        var st = await getState();
        if (st.isRunning) {
          result = await stopAutoRefresh();
        } else {
          result = await startAutoRefresh(payload);
        }
      } else if (type === "refreshNow") {
        await refreshNow();
        result = await getState();
      } else if (type === "reset") {
        result = await resetCounter();
      } else {
        result = { error: "Unknown message type: " + type };
      }
      
      sendResponse(result);
    } catch (err) {
      console.error("AutoRefresher error:", err);
      sendResponse({ error: err && err.message ? err.message : "Unknown error" });
    }
  })();

  return true;
});

/* ─────────────────────────────────────────────────────────────
   Event listeners
───────────────────────────────────────────────────────────── */
chrome.alarms.onAlarm.addListener(handleAlarm);

// Auto-remove closed tabs from list
chrome.tabs.onRemoved.addListener(async function(tabId) {
  var state = await getState();
  var hasTab = state.tabs.some(function(t) { return t.tabId === tabId; });
  if (hasTab) {
    console.log("AutoRefresher: tab closed, removing from list");
    await removeTab(tabId);
  }
});

chrome.commands.onCommand.addListener(async function(command) {
  if (command === "toggle-auto-refresher") {
    var state = await getState();
    if (state.isRunning) {
      await stopAutoRefresh();
    } else {
      try {
        await startAutoRefresh();
      } catch (err) {
        console.warn("AutoRefresher: cannot start via shortcut", err);
      }
    }
  } else if (command === "refresh-now") {
    await refreshNow();
  }
});

chrome.runtime.onInstalled.addListener(async function() {
  await chromeAlarmClear(ALARM_NAME);
  var state = await getState();
  if (state.isRunning) {
    await stopAutoRefresh();
  }
  setBadge(false);
});

chrome.runtime.onStartup.addListener(async function() {
  var state = await getState();
  if (state.isRunning && state.tabs.length > 0) {
    // Verify tabs still exist
    var anyAlive = false;
    for (var i = 0; i < state.tabs.length; i++) {
      if (await isTabAlive(state.tabs[i].tabId)) {
        anyAlive = true;
        break;
      }
    }
    if (!anyAlive) {
      await stopAutoRefresh();
    } else {
      setBadge(true, state.tabs.length);
    }
  }
});
