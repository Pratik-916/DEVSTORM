/**
 * settings.js
 * Handles Settings page interactions:
 *   - Toggle switches (on/off state)
 * No backend persistence — UI state only.
 */

'use strict';

const Settings = (() => {
  function init() {
    document.querySelectorAll('.toggle-switch').forEach(toggle => {
      toggle.addEventListener('click', () => {
        toggle.classList.toggle('on');
      });
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', Settings.init);
