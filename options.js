/* AutoRefresher - Options Script */

(function() {
  'use strict';

  var minSecondsInput = document.getElementById('min-seconds');
  var maxSecondsInput = document.getElementById('max-seconds');
  var jitterInput = document.getElementById('jitter');
  var cacheBustInput = document.getElementById('cache-bust');
  var saveBtn = document.getElementById('save');
  var statusEl = document.getElementById('status');

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

  async function loadState() {
    var result = await send('getState');
    if (result && !result.error) {
      minSecondsInput.value = result.minSeconds;
      maxSecondsInput.value = result.maxSeconds;
      jitterInput.value = result.jitterPercent;
      cacheBustInput.checked = Boolean(result.cacheBust);
      statusEl.textContent = 'Settings loaded.';
    } else {
      statusEl.textContent = result.error || 'Failed to load settings.';
    }
  }

  async function saveSettings() {
    var minVal = Math.max(3, parseInt(minSecondsInput.value, 10) || 300);
    var maxVal = Math.max(minVal, parseInt(maxSecondsInput.value, 10) || 700);
    minSecondsInput.value = minVal;
    maxSecondsInput.value = maxVal;

    var payload = {
      minSeconds: minVal,
      maxSeconds: maxVal,
      jitterPercent: parseInt(jitterInput.value, 10) || 0,
      cacheBust: cacheBustInput.checked
    };

    var result = await send('updateSettings', payload);
    if (result && !result.error) {
      statusEl.textContent = 'Settings saved successfully!';
    } else {
      statusEl.textContent = result.error || 'Failed to save settings.';
    }
  }

  saveBtn.addEventListener('click', saveSettings);

  loadState();
})();
