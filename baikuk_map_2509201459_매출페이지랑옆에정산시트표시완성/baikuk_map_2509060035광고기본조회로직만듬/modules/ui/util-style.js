import { CONFIG } from '../core/config.js';
export function applyButtonStyle(btn, active){
  if (active){
    btn.style.backgroundColor = CONFIG.UI.HIGHLIGHT_COLOR;
    btn.style.color = CONFIG.UI.HIGHLIGHT_TEXT;
    btn.style.fontWeight = 'bold';
    btn.style.borderColor = '#eab308';
  } else {
    btn.style.backgroundColor = CONFIG.UI.DEFAULT_BTN_BG;
    btn.style.color = CONFIG.UI.DEFAULT_BTN_TEXT;
    btn.style.fontWeight = 'normal';
    btn.style.borderColor = '#d1d5db';
  }
}
