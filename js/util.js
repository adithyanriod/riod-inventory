// Small helpers shared by the app

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Normalises component values so "10K", "10kΩ", "10k ohm" all match "10k",
// "4.7µF" matches "4.7uF", and "4k7" matches "4.7k".
export function normValue(s) {
  let v = String(s ?? '').toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[µμ]/g, 'u')
    .replace(/Ω|ω|ohms?/g, '');
  v = v.replace(/(\d+)([rkmunp])(\d+)/g, (_, a, u, b) => `${a}.${b}${u === 'r' ? '' : u}`);
  return v;
}

export function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts instanceof Date) return ts;
  const d = new Date(ts);
  return isNaN(d) ? null : d;
}

export function fmtDate(ts) {
  const d = toDate(ts);
  return d ? d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

export function fmtDateTime(ts) {
  const d = toDate(ts);
  return d ? d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
}

export function timeAgo(ts) {
  const d = toDate(ts);
  if (!d) return 'just now';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(d);
}

export function debounce(fn, ms = 150) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function uniqSorted(arr) {
  return [...new Set(arr.filter(v => v !== undefined && v !== null && String(v).trim() !== '').map(v => String(v).trim()))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

export function toast(msg, type = 'info', ms = 3500, html = false) {
  const root = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  if (html) t.innerHTML = msg; else t.textContent = msg;
  root.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  const kill = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); };
  setTimeout(kill, ms);
  t.onclick = kill;
}

// openModal({ title, body(html), actions:[{label, cls, onClick(modalEl, btn) -> false keeps it open}], wide, onOpen })
export function openModal({ title, body, actions = [], wide = false, onOpen }) {
  const root = document.getElementById('modalRoot');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">&times;</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot"></div>
    </div>`;
  const m = wrap.querySelector('.modal');
  const foot = wrap.querySelector('.modal-foot');
  const onKey = e => {
    if (e.key === 'Escape' && root.lastElementChild === wrap) close();
    if (e.key === 'Enter' && root.lastElementChild === wrap && e.target.tagName === 'INPUT') {
      e.preventDefault();
      foot.querySelector('.btn.primary')?.click();
    }
  };
  function close() { wrap.remove(); document.removeEventListener('keydown', onKey); }

  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${a.cls || ''}`;
    b.textContent = a.label;
    b.onclick = async () => {
      if (!a.onClick) { close(); return; }
      b.disabled = true;
      try {
        const r = await a.onClick(m, b);
        if (r !== false) close();
      } catch (err) {
        console.error(err);
        toast(err.message || String(err), 'error', 6000);
      } finally { b.disabled = false; }
    };
    foot.appendChild(b);
  }
  if (!actions.length) foot.remove();
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-close]').onclick = close;
  document.addEventListener('keydown', onKey);
  root.appendChild(wrap);
  onOpen?.(m);
  m.querySelector('.modal-body input:not([type=checkbox]):not([type=radio]), .modal-body select, .modal-body textarea')?.focus();
  return { el: m, close };
}

export function confirmDialog(title, messageHtml, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const m = openModal({
      title,
      body: `<div class="confirm-msg">${messageHtml}</div>`,
      actions: [
        { label: 'Cancel', cls: 'ghost', onClick: () => finish(false) },
        { label: okLabel, cls: danger ? 'danger' : 'primary', onClick: () => finish(true) }
      ]
    });
    const obs = new MutationObserver(() => {
      if (!m.el.isConnected) { obs.disconnect(); finish(false); }
    });
    obs.observe(document.getElementById('modalRoot'), { childList: true });
  });
}
