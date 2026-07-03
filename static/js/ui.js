/**
 * ui.js — the single panel/visibility primitive for the desktop shell.
 *
 * One idiom for every floating surface: a `[data-open="true|false"]` attribute on the
 * element, with CSS owning the show/hide transition. Panels may register onOpen/onClose
 * callbacks (e.g. the Inspector refreshes its list when shown). The Inspector is a tabbed
 * drawer — `isInspectorTabOpen(tab)` is the predicate the per-frame panel refreshers use
 * so they only do work while their tab is actually visible.
 *
 * This module imports nothing from the app, so it never participates in import cycles.
 */
const el = (id) => document.getElementById(id);
const panels = new Map();   // id -> { node, onOpen, onClose }

export function registerPanel(id, { onOpen, onClose } = {}) {
  const node = el(id);
  if (!node) return;
  panels.set(id, { node, onOpen, onClose });
}

export function isOpen(id) {
  const node = panels.get(id)?.node || el(id);
  return node?.dataset.open === 'true';
}

export function openPanel(id) {
  const entry = panels.get(id);
  const node = entry?.node || el(id);
  if (!node) return;
  node.dataset.open = 'true';
  entry?.onOpen?.();
  document.dispatchEvent(new CustomEvent('panel-open', { detail: id }));
}

export function closePanel(id) {
  const entry = panels.get(id);
  const node = entry?.node || el(id);
  if (!node) return;
  node.dataset.open = 'false';
  entry?.onClose?.();
  document.dispatchEvent(new CustomEvent('panel-close', { detail: id }));
}

export function togglePanel(id) {
  isOpen(id) ? closePanel(id) : openPanel(id);
}

// ── Inspector tabs (Scene / Light / Dev) ────────────────────────────────────
const inspector = el('inspector');

export function activeInspectorTab() {
  return inspector?.dataset.tab || 'scene';
}

export function isInspectorTabOpen(tab) {
  return isOpen('inspector') && activeInspectorTab() === tab;
}

export function setInspectorTab(tab) {
  if (!inspector) return;
  inspector.dataset.tab = tab;
  inspector.querySelectorAll('.insp-tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.dispatchEvent(new CustomEvent('inspector-tab-change', { detail: tab }));
}

/** Open the Inspector drawer and switch to `tab` (dispatches inspector-tab-change). */
export function openInspectorTab(tab) {
  setInspectorTab(tab);
  openPanel('inspector');
}

// ── At-load wiring ───────────────────────────────────────────────────────────
// Inspector tab strip
inspector?.querySelectorAll('.insp-tab').forEach((btn) =>
  btn.addEventListener('click', () => setInspectorTab(btn.dataset.tab)));

// Drawer close buttons
el('inspector-close')?.addEventListener('click', () => closePanel('inspector'));
el('world-close')?.addEventListener('click', () => closePanel('world-panel'));

// Escape closes the top-most transient surface
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const id of ['onboarding', 'world-panel', 'inspector']) {
    if (isOpen(id)) { closePanel(id); return; }
  }
});
