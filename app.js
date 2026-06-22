'use strict';

// ── Service Worker ─────────────────────────────────────────
// Must register unconditionally and BEFORE the install gate below.
// Chrome only fires `beforeinstallprompt` once a controlling service
// worker with a fetch handler is registered — if this were registered
// after the gate's early-return/throw, the browser-tab visit (the one
// case where we actually need the prompt) would never trigger it, and
// the "Tap to Install Now" button would never appear.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ── Install Gate ───────────────────────────────────────────
// Detect if running as installed PWA or in browser tab
(function installGate() {
  const isPWA = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true   // iOS Safari
    || document.referrer.includes('android-app://'); // Android TWA

  if (isPWA) return; // ✅ Installed — let the app run normally

  // 🚫 Running in browser — show install gate, block app
  const gate = document.getElementById('install-gate');
  gate.classList.remove('hidden');

  const splash = document.getElementById('splash');
  const app    = document.getElementById('app');
  if (splash) splash.style.display = 'none';
  if (app)    app.classList.add('hidden');

  // Always show manual steps immediately — beforeinstallprompt is unreliable
  // (doesn't fire if dismissed before, doesn't fire on iOS, etc.)
  document.getElementById('install-steps').classList.remove('hidden');

  let deferredPrompt = null;

  // If the native install prompt IS available, show the quick-install button too
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('install-btn');
    btn.classList.remove('hidden');
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 3v10m0 0l-3-3m3 3l3-3M4 15h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Tap to Install Now`;
  });

  document.getElementById('install-btn').addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === 'accepted') {
        document.getElementById('install-btn').textContent = '✓ Installing… open from home screen';
        document.getElementById('install-btn').disabled = true;
      }
    }
  });

  // Hide install btn by default — only shown if beforeinstallprompt fires
  document.getElementById('install-btn').classList.add('hidden');

  window.addEventListener('appinstalled', () => window.location.reload());

  throw new Error('INSTALL_GATE');
})();


const DEFAULT_STATE = {
  classes:  ['1','2','3','4','5','6','7','8','9','10','11','12'],
  sections: ['A','B','C','D','E','F'],
  subjects: ['Maths','Science','English','Hindi','SST','Computer','Physics','Chemistry','Biology'],
  template: '📚 Class {class} | Section {section} | {subject}\n📅 Due: {due}\n\n{hw}',
  hapticEnabled: true,
};

let state = loadState();
let session = {
  selectedClass:   '',
  selectedSection: '',
  selectedSubject: '',
  dueLabel:        'Today',
  hwText:          '',
  files:           [],
};

function loadState() {
  try {
    const saved = localStorage.getItem('handovr_state');
    if (saved) return { ...DEFAULT_STATE, ...JSON.parse(saved) };
  } catch (_) {}
  return { ...DEFAULT_STATE };
}

function saveState() {
  try { localStorage.setItem('handovr_state', JSON.stringify(state)); } catch (_) {}
}

// ── Haptic Feedback ────────────────────────────────────────
function haptic(type = 'light') {
  if (!state.hapticEnabled) return;
  if (!('vibrate' in navigator)) return;
  const patterns = { light: [10], medium: [20], success: [10, 50, 10], error: [30, 20, 30] };
  navigator.vibrate(patterns[type] || patterns.light);
}

// ── DOM helpers ────────────────────────────────────────────
const $ = id => document.getElementById(id);
const screens = ['step1','step2','step3','step4'];

// Track current screen for back-button logic
let currentScreen = 'step1';

function showScreen(id, direction = 'forward') {
  currentScreen = id;
  screens.forEach(s => {
    const el = $('screen-' + s);
    if (!el) return;
    if (s === id) {
      el.classList.remove('hidden', 'slide-out-left', 'slide-out-right', 'entering', 'entering-back');
      void el.offsetWidth; // force reflow
      el.classList.add(direction === 'back' ? 'entering-back' : 'entering');
    } else if (!el.classList.contains('hidden')) {
      el.classList.remove('entering', 'entering-back');
      if (direction === 'back') {
        el.classList.add('slide-out-right');
        setTimeout(() => {
          el.classList.add('hidden');
          el.classList.remove('slide-out-right');
        }, 320);
      } else {
        el.classList.add('slide-out-left');
        setTimeout(() => {
          el.classList.add('hidden');
          el.classList.remove('slide-out-left');
        }, 320);
      }
    }
  });

  // Push history state on forward navigation so Android back button
  // navigates between steps instead of closing the app
  if (direction === 'forward') {
    history.pushState({ screen: id }, '');
  }
}

// ── Android hardware back button ───────────────────────────
window.addEventListener('popstate', () => {
  // Close any open panels first
  if (!$('settings-panel').classList.contains('hidden')) {
    $('settings-panel').classList.add('hidden');
    history.pushState({ screen: currentScreen }, '');
    return;
  }
  if (!$('drafts-panel').classList.contains('hidden')) {
    $('drafts-panel').classList.add('hidden');
    history.pushState({ screen: currentScreen }, '');
    return;
  }
  if (slideMenu.classList.contains('open')) {
    closeMenu();
    history.pushState({ screen: currentScreen }, '');
    return;
  }

  const idx = screens.indexOf(currentScreen);
  if (idx > 0) {
    const prev = screens[idx - 1];
    if (prev === 'step1') initStep1();
    if (prev === 'step2') {
      buildPills('subject-grid', state.subjects, session.selectedSubject, val => {
        session.selectedSubject = val;
        $('next-step2').disabled = false;
        haptic('medium');
      });
      $('next-step2').disabled = !session.selectedSubject;
    }
    showScreen(prev, 'back');
  } else {
    // On step1 — push a state so next back press also stays in app
    history.pushState({ screen: 'step1' }, '');
  }
});

function showToast(msg, type = 'default') {
  const t = $('toast');
  t.textContent = msg;
  t.style.background = type === 'success' ? '#166534' : type === 'draft' ? '#1d4ed8' : type === 'copy' ? '#7c3aed' : '';
  t.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => t.classList.add('show'));
  });
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.classList.add('hidden'), 350);
  }, 2800);
}

// ── Pill / Chip builders ───────────────────────────────────
function buildPills(containerId, items, selectedVal, onSelect) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = '';
  items.forEach((item, idx) => {
    const btn = document.createElement('button');
    btn.className = 'pill' + (item === selectedVal ? ' selected' : '');
    btn.textContent = item;
    btn.style.animationDelay = (idx * 30) + 'ms';
    btn.addEventListener('click', () => {
      haptic('light');
      container.querySelectorAll('.pill').forEach(p => p.classList.remove('selected'));
      btn.classList.add('selected');
      onSelect(item);
    });
    container.appendChild(btn);
  });
}

// ── Hamburger / Slide Menu ─────────────────────────────────
const hamburgerBtn   = $('hamburger-btn');
const slideMenu      = $('slide-menu');
const menuOverlay    = $('menu-overlay');
const closeMenuBtn   = $('close-menu');

function openMenu() {
  haptic('light');
  slideMenu.classList.remove('hidden');
  menuOverlay.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      slideMenu.classList.add('open');
      menuOverlay.classList.add('visible');
    });
  });
  hamburgerBtn.classList.add('open');
}

function closeMenu() {
  slideMenu.classList.remove('open');
  menuOverlay.classList.remove('visible');
  hamburgerBtn.classList.remove('open');
  setTimeout(() => {
    slideMenu.classList.add('hidden');
    menuOverlay.classList.add('hidden');
  }, 350);
}

hamburgerBtn.addEventListener('click', openMenu);
closeMenuBtn.addEventListener('click', closeMenu);
menuOverlay.addEventListener('click', closeMenu);

$('menu-new-hw').addEventListener('click', () => {
  haptic('light');
  closeMenu();
  resetSession();
  initStep1();
  showScreen('step1', 'back');
  document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('menu-item--active'));
  $('menu-new-hw').classList.add('menu-item--active');
});

$('menu-drafts-btn').addEventListener('click', () => {
  haptic('light');
  closeMenu();
  setTimeout(() => openDrafts(), 200);
});

$('menu-settings-link').addEventListener('click', () => {
  haptic('light');
  closeMenu();
  setTimeout(() => {
    renderSettings();
    $('settings-panel').classList.remove('hidden');
  }, 200);
});

// ── Haptic Toggle ──────────────────────────────────────────
function syncHapticUI() {
  const on = state.hapticEnabled;
  $('haptic-icon-on').classList.toggle('hidden', !on);
  $('haptic-icon-off').classList.toggle('hidden', on);
  $('haptic-toggle').classList.toggle('off', !on);
  $('menu-haptic-checkbox').checked = on;
}

$('haptic-toggle').addEventListener('click', () => {
  state.hapticEnabled = !state.hapticEnabled;
  saveState();
  syncHapticUI();
  if (state.hapticEnabled) haptic('medium');
  showToast(state.hapticEnabled ? 'Haptic on 📳' : 'Haptic off 🔇');
});

$('menu-haptic-checkbox').addEventListener('change', e => {
  state.hapticEnabled = e.target.checked;
  saveState();
  syncHapticUI();
  if (state.hapticEnabled) haptic('medium');
});

// ── Step 1: Class + Section ────────────────────────────────
function initStep1() {
  buildPills('class-grid', state.classes, session.selectedClass, val => {
    session.selectedClass = val;
    session.selectedSection = '';
    const sb = $('section-block');
    sb.classList.add('visible');
    buildPills('section-grid', state.sections, '', val2 => {
      session.selectedSection = val2;
      haptic('medium');
      checkStep1();
    });
    checkStep1();
  });

  if (session.selectedClass) {
    $('section-block').classList.add('visible');
    buildPills('section-grid', state.sections, session.selectedSection, val => {
      session.selectedSection = val;
      haptic('medium');
      checkStep1();
    });
  }

  checkStep1();
}

function checkStep1() {
  $('next-step1').disabled = !(session.selectedClass && session.selectedSection);
}

$('next-step1').addEventListener('click', () => {
  haptic('medium');
  updateCrumb('crumb-step2');
  buildPills('subject-grid', state.subjects, session.selectedSubject, val => {
    session.selectedSubject = val;
    $('next-step2').disabled = false;
    haptic('medium');
  });
  $('next-step2').disabled = !session.selectedSubject;
  showScreen('step2', 'forward');
});

// ── Step 2: Subject ────────────────────────────────────────
$('back-step2').addEventListener('click', () => {
  haptic('light');
  initStep1();
  showScreen('step1', 'back');
});

$('next-step2').addEventListener('click', () => {
  haptic('medium');
  updateCrumb('crumb-step3');
  showScreen('step3', 'forward');
  initStep3();
});

// ── Step 3: Due Date + HW ──────────────────────────────────
function initStep3() {
  const hwInput = $('hw-input');
  hwInput.value = session.hwText;
  updateCharCount();

  // Keep the attached-files list in sync with session.files — this was
  // previously only rendered on attach/remove, so a reset session (after
  // sending, or "Start fresh") left old file names visible here.
  renderFileList();

  const isCustomDue = !['Today', 'Tomorrow', 'This week'].includes(session.dueLabel);
  document.querySelectorAll('.due-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.due === session.dueLabel ||
      (chip.dataset.due === 'custom' && isCustomDue && session.dueLabel.length > 0));
  });

  // Show the date picker only when a custom date is actually behind it;
  // otherwise hide it and clear any stale leftover value.
  const customDateEl = $('custom-date');
  if (isCustomDue && session.dueLabel) {
    customDateEl.classList.remove('hidden');
  } else {
    customDateEl.classList.add('hidden');
    customDateEl.value = '';
  }

  checkStep3();
}

function applyCustomDate() {
  const val = $('custom-date').value;
  if (val) {
    const d = new Date(val);
    if (!isNaN(d)) {
      session.dueLabel = d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
      return;
    }
  }
  // No valid date chosen yet — don't let a stale previous dueLabel
  // ("Today" etc.) sneak through and silently mismatch the UI.
  session.dueLabel = '';
}

document.querySelectorAll('.due-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    haptic('light');
    document.querySelectorAll('.due-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    if (chip.dataset.due === 'custom') {
      $('custom-date').classList.remove('hidden');
      applyCustomDate();
    } else {
      session.dueLabel = chip.dataset.due;
      $('custom-date').classList.add('hidden');
    }
    checkStep3();
  });
});

$('custom-date').addEventListener('change', () => {
  applyCustomDate();
  checkStep3();
});

$('hw-input').addEventListener('input', () => {
  session.hwText = $('hw-input').value;
  updateCharCount();
  checkStep3();
});

function updateCharCount() {
  const len = $('hw-input').value.length;
  $('char-count').textContent = len + '/500';
}

// Attachments
$('attach-trigger').addEventListener('click', () => $('file-input').click());

$('file-input').addEventListener('change', e => {
  const newFiles = Array.from(e.target.files || []);
  const isSameFile = (a, b) =>
    a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
  newFiles.forEach(f => {
    if (!session.files.find(x => isSameFile(x, f))) session.files.push(f);
  });
  e.target.value = '';
  renderFileList();
  haptic('light');
});

function renderFileList() {
  const list = $('file-list');
  list.innerHTML = '';
  session.files.forEach((f, i) => {
    const isPdf = f.name.toLowerCase().endsWith('.pdf');
    const item = document.createElement('div');
    item.className = 'file-item';
    item.innerHTML = `
      <div class="file-item-icon">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          ${isPdf
            ? '<rect x="2" y="1" width="12" height="14" rx="2" stroke="white" stroke-width="1.4"/><path d="M5 5h6M5 8h6M5 11h4" stroke="white" stroke-width="1.2" stroke-linecap="round"/>'
            : '<rect x="1" y="1" width="14" height="14" rx="2" stroke="white" stroke-width="1.4"/><circle cx="5.5" cy="5.5" r="1.5" stroke="white" stroke-width="1.2"/><path d="M1 10l4-3 3 3 2-2 5 5" stroke="white" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'}
        </svg>
      </div>
      <span class="file-item-name">${f.name}</span>
      <button class="file-item-remove" aria-label="Remove file">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>
    `;
    item.querySelector('.file-item-remove').addEventListener('click', () => {
      haptic('light');
      session.files.splice(i, 1);
      renderFileList();
    });
    list.appendChild(item);
  });
}

function checkStep3() {
  const hasText = $('hw-input').value.trim().length > 0;
  const hasDue = session.dueLabel.length > 0;
  $('next-step3').disabled = !(hasText && hasDue);
}

$('back-step3').addEventListener('click', () => {
  haptic('light');
  session.hwText = $('hw-input').value;
  showScreen('step2', 'back');
});

$('next-step3').addEventListener('click', () => {
  haptic('medium');
  session.hwText = $('hw-input').value.trim();
  buildPreview();
  showScreen('step4', 'forward');
});

// ── Save Draft ─────────────────────────────────────────────
function loadDrafts() {
  try {
    const d = localStorage.getItem('handovr_drafts');
    return d ? JSON.parse(d) : [];
  } catch (_) { return []; }
}

function saveDraftsToStorage(drafts) {
  try { localStorage.setItem('handovr_drafts', JSON.stringify(drafts)); } catch (_) {}
}

function updateDraftsBadge() {
  const count = loadDrafts().length;
  const badge = $('menu-drafts-count');
  if (badge) {
    badge.textContent = count;
    badge.setAttribute('data-count', count);
  }
}

$('save-draft-btn').addEventListener('click', () => {
  haptic('medium');
  session.hwText = $('hw-input').value.trim();
  if (!session.hwText && !session.selectedClass) {
    showToast('Nothing to save yet.');
    return;
  }

  const drafts = loadDrafts();
  const draft = {
    id: Date.now(),
    savedAt: new Date().toISOString(),
    selectedClass:   session.selectedClass,
    selectedSection: session.selectedSection,
    selectedSubject: session.selectedSubject,
    dueLabel:        session.dueLabel,
    hwText:          session.hwText,
    fileNames:       session.files.map(f => f.name),
  };
  drafts.unshift(draft);
  if (drafts.length > 20) drafts.splice(20);
  saveDraftsToStorage(drafts);
  updateDraftsBadge();
  showToast('Draft saved ✓', 'draft');
});

// ── Drafts Panel ───────────────────────────────────────────
function openDrafts() {
  renderDrafts();
  $('drafts-panel').classList.remove('hidden');
}

$('close-drafts').addEventListener('click', () => {
  haptic('light');
  $('drafts-panel').classList.add('hidden');
});

function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function renderDrafts() {
  const body = $('drafts-body');
  const drafts = loadDrafts();

  if (drafts.length === 0) {
    body.innerHTML = `
      <div class="drafts-empty">
        <div class="drafts-empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="currentColor" stroke-width="1.6"/>
            <path d="M14 2v6h6M8 13h8M8 17h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </div>
        <strong>No drafts yet</strong>
        <p>Tap "Draft" on the homework step to save your work in progress.</p>
      </div>`;
    return;
  }

  body.innerHTML = '';
  drafts.forEach(draft => {
    const card = document.createElement('div');
    card.className = 'draft-card';
    const classMeta = draft.selectedClass ? `Class ${draft.selectedClass}` : '';
    const sectionMeta = draft.selectedSection ? `Sec ${draft.selectedSection}` : '';
    const subjMeta = draft.selectedSubject || '';
    const dueMeta = draft.dueLabel || '';
    const preview = draft.hwText || '(no text)';
    const fileNames = draft.fileNames || [];
    const fileMeta = fileNames.length
      ? `📎 ${fileNames.length} file${fileNames.length > 1 ? 's' : ''} (not saved)`
      : '';

    card.innerHTML = `
      <div class="draft-card-header">
        <div class="draft-card-meta">
          ${classMeta ? `<span class="draft-tag">${classMeta}</span>` : ''}
          ${sectionMeta ? `<span class="draft-tag">${sectionMeta}</span>` : ''}
          ${subjMeta ? `<span class="draft-tag">${subjMeta}</span>` : ''}
          ${dueMeta ? `<span class="draft-tag draft-tag--due">Due: ${dueMeta}</span>` : ''}
          ${fileMeta ? `<span class="draft-tag draft-tag--files">${fileMeta}</span>` : ''}
        </div>
        <span class="draft-card-time">${timeAgo(draft.savedAt)}</span>
      </div>
      <div class="draft-card-text">${preview}</div>
      <div class="draft-card-actions">
        <button class="draft-btn-load">Load draft</button>
        <button class="draft-btn-delete" aria-label="Delete draft">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
    `;

    card.querySelector('.draft-btn-load').addEventListener('click', () => {
      haptic('medium');
      loadDraft(draft);
    });

    card.querySelector('.draft-btn-delete').addEventListener('click', () => {
      haptic('light');
      deleteDraft(draft.id);
      renderDrafts();
    });

    body.appendChild(card);
  });
}

function loadDraft(draft) {
  session.selectedClass   = draft.selectedClass   || '';
  session.selectedSection = draft.selectedSection || '';
  session.selectedSubject = draft.selectedSubject || '';
  session.dueLabel        = draft.dueLabel        || 'Today';
  session.hwText          = draft.hwText          || '';
  session.files           = [];

  $('drafts-panel').classList.add('hidden');

  initStep1();
  updateCrumb('crumb-step2');
  buildPills('subject-grid', state.subjects, session.selectedSubject, val => {
    session.selectedSubject = val;
    $('next-step2').disabled = false;
  });
  $('next-step2').disabled = !session.selectedSubject;
  updateCrumb('crumb-step3');
  showScreen('step3', 'forward');
  initStep3();
  renderFileList();

  const hadFiles = (draft.fileNames || []).length;
  if (hadFiles) {
    showToast(`Draft loaded — re-attach ${hadFiles} file${hadFiles > 1 ? 's' : ''} (not saved)`, 'draft');
  } else {
    showToast('Draft loaded ✓', 'draft');
  }
}

function deleteDraft(id) {
  const drafts = loadDrafts().filter(d => d.id !== id);
  saveDraftsToStorage(drafts);
  updateDraftsBadge();
}

// ── Step 4: Preview + Send ─────────────────────────────────
function buildPreview() {
  const msg = buildMessage();
  $('preview-bubble').textContent = msg;

  const attachEl = $('preview-attachments');
  attachEl.innerHTML = '';
  session.files.forEach(f => {
    const chip = document.createElement('div');
    chip.className = 'preview-file-chip';
    chip.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="0.5" width="10" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2"/></svg>
      ${f.name}
    `;
    attachEl.appendChild(chip);
  });

  // Show caption hint only when PDFs are attached (images work fine with text)
  const hint = $('caption-hint');
  if (hint) {
    hint.classList.toggle('hidden', !session.files.some(f => f.name.toLowerCase().endsWith('.pdf')));
  }
}

function buildMessage() {
  // Escape '$' in user-supplied values so String.replace() doesn't treat
  // sequences like $&, $$, $` or $' in them as special replacement patterns.
  const esc = v => String(v).replace(/\$/g, '$$$$');

  return state.template
    .replace(/\{class\}/g,   esc(session.selectedClass))
    .replace(/\{section\}/g, esc(session.selectedSection))
    .replace(/\{subject\}/g, esc(session.selectedSubject))
    .replace(/\{due\}/g,     esc(session.dueLabel))
    .replace(/\{hw\}/g,      esc(session.hwText));
}

$('back-step4').addEventListener('click', () => {
  haptic('light');
  showScreen('step3', 'back');
});

$('edit-link').addEventListener('click', () => {
  haptic('light');
  showScreen('step3', 'back');
});

// ── Copy message to clipboard helper ──────────────────────
// Must be called synchronously within a user-gesture handler
// (the click event) — BEFORE any async operations that lose focus
function copyMessageToClipboardSync(msg) {
  // execCommand is synchronous and works within the click handler
  // even on older Android WebViews where clipboard API needs a Promise
  try {
    const ta = document.createElement('textarea');
    ta.value = msg;
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return true;
  } catch (_) {}

  // Modern async fallback (may fail if focus is lost, but try anyway)
  try {
    navigator.clipboard.writeText(msg).catch(() => {});
    return true;
  } catch (_) {}
  return false;
}

function hasPdfFiles() {
  return session.files.some(f => f.name.toLowerCase().endsWith('.pdf'));
}

// ── Send Button ────────────────────────────────────────────
const WA_BTN_HTML = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M17.5 2.5A9.9 9.9 0 0010 0C4.48 0 0 4.48 0 10c0 1.76.46 3.4 1.26 4.83L0 20l5.32-1.24A9.94 9.94 0 0010 20c5.52 0 10-4.48 10-10 0-2.67-1.04-5.18-2.5-7.5z" fill="white" opacity="0.15"/><path d="M14.5 12.97c-.22-.11-1.3-.64-1.5-.71-.2-.07-.34-.11-.49.11-.14.22-.56.71-.69.86-.13.14-.25.16-.47.05-.22-.11-.93-.34-1.77-1.09-.65-.58-1.09-1.3-1.22-1.52-.13-.22-.01-.34.1-.45.1-.1.22-.25.33-.38.11-.13.14-.22.22-.36.07-.14.04-.27-.02-.38-.07-.11-.49-1.18-.67-1.61-.18-.42-.36-.36-.49-.37h-.42c-.14 0-.38.05-.58.27-.2.22-.76.74-.76 1.8s.78 2.09.89 2.23c.11.14 1.53 2.34 3.71 3.28.52.22.93.36 1.24.46.52.17 1 .14 1.37.09.42-.06 1.3-.53 1.48-1.04.18-.51.18-.95.13-1.04-.05-.09-.2-.14-.42-.25z" fill="white"/></svg> Share on WhatsApp`;

// Top-level so afterSend() can also restore the button after a successful
// send — previously this only existed inside the click handler's closure,
// so the AbortError paths reset it but a *successful* send left the button
// stuck on "Opening WhatsApp…" and disabled forever.
function resetSendBtn() {
  const btn = $('send-btn');
  btn.disabled = false;
  btn.innerHTML = WA_BTN_HTML;
}

$('send-btn').addEventListener('click', async () => {
  haptic('medium');
  const msg = buildMessage();
  const btn = $('send-btn');
  btn.disabled = true;
  btn.textContent = 'Opening WhatsApp…';

  // ── Has PDFs: copy text NOW (sync, within click handler) then share PDFs ──
  if (session.files.length > 0 && hasPdfFiles()) {
    // Copy FIRST — synchronously while we still have focus from the tap
    const copied = copyMessageToClipboardSync(msg);

    if (navigator.canShare) {
      const shareWithText  = { title: msg, text: msg, files: session.files };
      const shareFilesOnly = { files: session.files };
      try {
        if (navigator.canShare(shareWithText)) {
          await navigator.share(shareWithText);
        } else if (navigator.canShare(shareFilesOnly)) {
          await navigator.share(shareFilesOnly);
        } else {
          window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
          afterSend();
          return;
        }
        if (copied) {
          showToast('📋 Message copied — paste as caption in WhatsApp', 'copy');
        }
        afterSend();
        return;
      } catch (err) {
        if (err.name === 'AbortError') { resetSendBtn(); return; }
      }
    }

    // No Web Share — open WA deep link
    if (copied) showToast('📋 Message copied — paste in WhatsApp', 'copy');
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
    afterSend();
    return;
  }

  // ── Images only or no files: Web Share handles text+image fine ──
  if (session.files.length > 0 && navigator.canShare) {
    const shareData = { title: msg, text: msg, files: session.files };
    try {
      if (navigator.canShare(shareData)) {
        await navigator.share(shareData);
        afterSend();
        return;
      }
    } catch (err) {
      if (err.name === 'AbortError') { resetSendBtn(); return; }
    }
  }

  // ── Text only ──────────────────────────────────────────
  if (navigator.share) {
    try {
      await navigator.share({ text: msg });
      afterSend();
      return;
    } catch (err) {
      if (err.name === 'AbortError') { resetSendBtn(); return; }
    }
  }

  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  afterSend();
});

// ── After Send: reset and go back to step 1 ───────────────
function afterSend() {
  haptic('success');
  showToast('Sent ✓', 'success');

  // Reset immediately and navigate back to step 1
  // Small delay so the share sheet has time to close cleanly
  setTimeout(() => {
    resetSession();
    initStep1();
    // Clear history stack back to base so app is fresh
    history.replaceState({ screen: 'step1' }, '');
    currentScreen = 'step1';
    // Hide all screens then show step1 cleanly
    screens.forEach(s => {
      const el = $('screen-' + s);
      if (el) el.classList.add('hidden');
    });
    const s1 = $('screen-step1');
    s1.classList.remove('hidden', 'slide-out-left', 'slide-out-right', 'entering-back');
    s1.classList.add('entering');
  }, 600);
}

$('new-hw-btn').addEventListener('click', () => {
  haptic('light');
  resetSession();
  initStep1();
  history.replaceState({ screen: 'step1' }, '');
  currentScreen = 'step1';
  screens.forEach(s => {
    const el = $('screen-' + s);
    if (el) el.classList.add('hidden');
  });
  const s1 = $('screen-step1');
  s1.classList.remove('hidden', 'slide-out-left', 'slide-out-right', 'entering', 'entering-back');
  s1.classList.add('entering');
});

function resetSession() {
  session = {
    selectedClass: '', selectedSection: '',
    selectedSubject: '', dueLabel: 'Today',
    hwText: '', files: [],
  };
  // Keep the DOM in lockstep with the cleared session — these previously
  // only got refreshed lazily (or not at all), which is why old attached
  // file names and a stuck send button could linger after a reset.
  renderFileList();
  resetSendBtn();
}

// ── Crumb Badge ────────────────────────────────────────────
function updateCrumb(elId) {
  const el = $(elId);
  if (!el) return;
  const parts = [];
  if (session.selectedClass) parts.push('Class ' + session.selectedClass);
  if (session.selectedSection) parts.push('Sec ' + session.selectedSection);
  if (session.selectedSubject) parts.push(session.selectedSubject);
  el.textContent = parts.join(' · ');
}

// ── Settings ───────────────────────────────────────────────
$('open-settings').addEventListener('click', () => {
  haptic('light');
  renderSettings();
  $('settings-panel').classList.remove('hidden');
});

$('close-settings').addEventListener('click', () => {
  haptic('light');
  $('settings-panel').classList.add('hidden');
});

function renderSettings() {
  renderTagCloud('settings-classes', 'classes');
  renderTagCloud('settings-sections', 'sections');
  renderTagCloud('settings-subjects', 'subjects');
  $('template-input').value = state.template;
}

function renderTagCloud(elId, key) {
  const el = $(elId);
  if (!el) return;
  el.innerHTML = '';
  state[key].forEach((item, i) => {
    const tag = document.createElement('span');
    tag.className = 'tag-item';
    tag.innerHTML = `${item}
      <button class="tag-remove" aria-label="Remove ${item}">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>`;
    tag.querySelector('.tag-remove').addEventListener('click', () => {
      haptic('light');
      state[key].splice(i, 1);
      saveState();
      renderTagCloud(elId, key);
    });
    el.appendChild(tag);
  });
}

document.querySelectorAll('.add-tag-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    haptic('light');
    const type = btn.dataset.type;
    const labels = { classes: 'class (e.g. 13)', sections: 'section (e.g. G)', subjects: 'subject (e.g. Sanskrit)' };
    const val = prompt('Enter ' + (labels[type] || type) + ':');
    if (val && val.trim() && !state[type].includes(val.trim())) {
      state[type].push(val.trim());
      saveState();
      renderTagCloud('settings-' + type, type);
    }
  });
});

$('template-input').addEventListener('input', () => {
  state.template = $('template-input').value;
  saveState();
});

// ── Splash → App ───────────────────────────────────────────
window.addEventListener('load', () => {
  // Seed initial history entry so first back press stays in app
  history.replaceState({ screen: 'step1' }, '');

  setTimeout(() => {
    const splash = $('splash');
    splash.classList.add('exit');
    setTimeout(() => {
      splash.style.display = 'none';
      $('app').classList.remove('hidden');
      syncHapticUI();
      updateDraftsBadge();
      initStep1();
    }, 500);
  }, 1400);
});

// ── Uron Credit + Mascot Popup ──────────────────────────────
(function initUronCredit() {
  const creditLink  = $('uron-credit');
  const mascotPopup = $('mascot-popup');
  if (!creditLink || !mascotPopup) return;

  let mascotTimer = null;

  function showMascot() {
    // Clear any existing dismiss timer
    clearTimeout(mascotTimer);

    // Reset exit state then trigger visible
    mascotPopup.classList.remove('mascot-exit');
    // Force reflow so transition re-fires even if already visible
    void mascotPopup.offsetWidth;
    mascotPopup.classList.add('mascot-visible');

    // Auto-dismiss after 3.5 s
    mascotTimer = setTimeout(hideMascot, 3500);
  }

  function hideMascot() {
    mascotPopup.classList.remove('mascot-visible');
    mascotPopup.classList.add('mascot-exit');
  }

  creditLink.addEventListener('click', e => {
    // Let the link open normally (target=_blank), but also:
    haptic('light');
    // Toast — re-use existing style, custom navy background
    const t = $('toast');
    t.textContent = '🙏 Thanks for visiting!';
    t.style.background = '#1E3A8A';
    t.classList.remove('hidden');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => t.classList.add('show'));
    });
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => {
        t.classList.add('hidden');
        t.style.background = '';
      }, 350);
    }, 2800);

    // Mascot pops up a beat after the toast settles
    setTimeout(showMascot, 400);
  });

  // Tapping mascot dismisses it early
  mascotPopup.addEventListener('click', () => {
    clearTimeout(mascotTimer);
    hideMascot();
  });
})();