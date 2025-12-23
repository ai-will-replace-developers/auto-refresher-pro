/* AutoRefresher - Popup Script (Multi-Tab Version) */

(function() {
  'use strict';

  // Elements
  var statusBadge = document.getElementById('status-badge');
  var btnAdd = document.getElementById('btn-add');
  var btnClear = document.getElementById('btn-clear');
  var tabsList = document.getElementById('tabs-list');
  var tabCount = document.getElementById('tab-count');
  var emptyState = document.getElementById('empty-state');
  var btnToggle = document.getElementById('btn-toggle');
  var btnIcon = document.getElementById('btn-icon');
  var btnText = document.getElementById('btn-text');
  var btnRefresh = document.getElementById('btn-refresh');
  var btnReset = document.getElementById('btn-reset');
  var minSecondsInput = document.getElementById('min-seconds');
  var maxSecondsInput = document.getElementById('max-seconds');
  var cacheBustInput = document.getElementById('cache-bust');
  var countdownEl = document.getElementById('countdown');
  var nextTabEl = document.getElementById('next-tab');
  var runCountEl = document.getElementById('run-count');
  var errorMessage = document.getElementById('error-message');
  var presetButtons = document.querySelectorAll('.preset');

  var state = null;
  var countdownInterval = null;

  // Send message to background
  function send(type, payload) {
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage({ type: type, payload: payload || {} }, function(response) {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    });
  }

  // Show error
  function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.classList.add('show');
    setTimeout(function() {
      errorMessage.classList.remove('show');
    }, 3000);
  }

  // Format countdown
  function formatCountdown(targetTs) {
    if (!targetTs) return '--';
    var delta = targetTs - Date.now();
    if (delta <= 0) return 'Now';
    var secs = Math.round(delta / 1000);
    if (secs < 60) return secs + 's';
    var mins = Math.floor(secs / 60);
    var remainSecs = secs % 60;
    return mins + 'm ' + (remainSecs < 10 ? '0' : '') + remainSecs + 's';
  }

  // Shorten URL for display
  function shortenUrl(url) {
    if (!url) return '--';
    try {
      var u = new URL(url);
      return u.hostname.replace(/^www\./, '');
    } catch (e) {
      return '--';
    }
  }

  // Shorten title
  function shortenTitle(title) {
    if (!title) return '--';
    return title.length > 30 ? title.slice(0, 27) + '...' : title;
  }

  // Update countdown display
  function updateCountdown() {
    if (!state || !state.isRunning || !state.nextRunAt) {
      countdownEl.textContent = '--';
      return;
    }
    countdownEl.textContent = formatCountdown(state.nextRunAt);
  }

  // Start countdown timer
  function startCountdownTimer() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(updateCountdown, 1000);
  }

  // Render tabs list
  function renderTabs() {
    var tabs = state.tabs || [];
    tabCount.textContent = tabs.length;
    
    if (tabs.length === 0) {
      emptyState.style.display = 'block';
      tabsList.innerHTML = '';
      tabsList.appendChild(emptyState);
      return;
    }
    
    emptyState.style.display = 'none';
    tabsList.innerHTML = '';
    
    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i];
      var isNext = state.nextTabId === tab.tabId;
      
      var item = document.createElement('div');
      item.className = 'tab-item' + (isNext ? ' is-next' : '');
      
      var icon = document.createElement('div');
      icon.className = 'tab-icon' + (isNext ? ' is-next' : '');
      icon.textContent = isNext ? '→' : (i + 1);
      
      var info = document.createElement('div');
      info.className = 'tab-info';
      
      var title = document.createElement('div');
      title.className = 'tab-title';
      title.textContent = shortenTitle(tab.title);
      
      var url = document.createElement('div');
      url.className = 'tab-url';
      url.textContent = shortenUrl(tab.url);
      
      info.appendChild(title);
      info.appendChild(url);
      
      var remove = document.createElement('button');
      remove.className = 'tab-remove';
      remove.textContent = '×';
      remove.dataset.tabId = tab.tabId;
      remove.addEventListener('click', function(e) {
        var id = parseInt(e.target.dataset.tabId, 10);
        removeTabFromList(id);
      });
      
      item.appendChild(icon);
      item.appendChild(info);
      item.appendChild(remove);
      tabsList.appendChild(item);
    }
  }

  // Render UI based on state
  function render() {
    if (!state) return;

    var running = Boolean(state.isRunning);
    var tabs = state.tabs || [];

    // Status badge
    statusBadge.textContent = running ? 'Running' : 'Idle';
    statusBadge.classList.toggle('running', running);

    // Toggle button
    btnIcon.textContent = running ? '■' : '▶';
    btnText.textContent = running ? 'Stop' : 'Start';
    btnToggle.classList.toggle('running', running);

    // Inputs
    minSecondsInput.value = state.minSeconds;
    maxSecondsInput.value = state.maxSeconds;
    cacheBustInput.checked = Boolean(state.cacheBust);

    // Stats
    runCountEl.textContent = state.runCount || 0;
    
    // Next tab
    if (running && state.nextTabId) {
      var nextTab = tabs.find(function(t) { return t.tabId === state.nextTabId; });
      nextTabEl.textContent = nextTab ? shortenUrl(nextTab.url) : '--';
    } else {
      nextTabEl.textContent = '--';
    }

    // Render tabs list
    renderTabs();

    updateCountdown();
    startCountdownTimer();
  }

  // Load state from background
  async function loadState() {
    var result = await send('getState');
    if (result && !result.error) {
      state = result;
      render();
    } else {
      showError(result.error || 'Failed to load state');
    }
  }

  // Save settings
  async function saveSettings() {
    var minVal = Math.max(3, parseInt(minSecondsInput.value, 10) || 300);
    var maxVal = Math.max(minVal, parseInt(maxSecondsInput.value, 10) || 700);
    minSecondsInput.value = minVal;
    maxSecondsInput.value = maxVal;

    var payload = {
      minSeconds: minVal,
      maxSeconds: maxVal,
      cacheBust: cacheBustInput.checked
    };

    var result = await send('updateSettings', payload);
    if (result && !result.error) {
      state = result;
      render();
    }
  }

  // Add current tab
  async function addCurrentTab() {
    btnAdd.disabled = true;
    btnAdd.textContent = 'Adding...';
    
    var result = await send('addTab');
    
    if (result && result.error) {
      showError(result.error);
    } else if (result) {
      state = result;
      render();
    }
    
    btnAdd.disabled = false;
    btnAdd.innerHTML = '<span class="btn-icon">+</span> Add Current Tab';
  }

  // Remove tab from list
  async function removeTabFromList(tabId) {
    var result = await send('removeTab', { tabId: tabId });
    if (result && !result.error) {
      state = result;
      render();
    } else if (result && result.error) {
      showError(result.error);
    }
  }

  // Clear all tabs
  async function clearAllTabs() {
    if (state.tabs.length === 0) return;
    var result = await send('clearTabs');
    if (result && !result.error) {
      state = result;
      render();
    }
  }

  // Toggle auto-refresh
  async function toggleRefresh() {
    var payload = {
      minSeconds: parseInt(minSecondsInput.value, 10) || 300,
      maxSeconds: parseInt(maxSecondsInput.value, 10) || 700,
      cacheBust: cacheBustInput.checked
    };

    var action = state && state.isRunning ? 'stop' : 'start';
    var result = await send(action, payload);

    if (result && result.error) {
      showError(result.error);
      return;
    }

    state = result;
    render();
  }

  // Refresh now
  async function refreshNow() {
    btnRefresh.disabled = true;
    
    var result = await send('refreshNow');
    if (result && !result.error) {
      state = result;
      render();
    }

    btnRefresh.disabled = false;
  }

  // Reset counter
  async function resetCounter() {
    var result = await send('reset');
    if (result && !result.error) {
      state = result;
      render();
    }
  }

  // Apply preset
  async function applyPreset(min, max) {
    minSecondsInput.value = min;
    maxSecondsInput.value = max;
    await saveSettings();
  }

  // Event listeners
  btnAdd.addEventListener('click', addCurrentTab);
  btnClear.addEventListener('click', clearAllTabs);
  btnToggle.addEventListener('click', toggleRefresh);
  btnRefresh.addEventListener('click', refreshNow);
  btnReset.addEventListener('click', resetCounter);

  minSecondsInput.addEventListener('change', saveSettings);
  maxSecondsInput.addEventListener('change', saveSettings);
  cacheBustInput.addEventListener('change', saveSettings);

  presetButtons.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var min = parseInt(btn.dataset.min, 10);
      var max = parseInt(btn.dataset.max, 10);
      applyPreset(min, max);
    });
  });

  // Listen for state changes from background
  chrome.storage.onChanged.addListener(function(changes) {
    if (changes.autoRefresherState) {
      state = changes.autoRefresherState.newValue;
      render();
    }
  });

  // Initialize
  loadState();
})();
