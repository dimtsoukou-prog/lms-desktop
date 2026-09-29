/* Shared UI helpers: escaping, icons, modals, toasts, event delegation. */
(function () {
  'use strict';

  const App = (window.App = window.App || {});
  App.pages = App.pages || {};
  App.actions = App.actions || {};
  App.changes = App.changes || {};
  App.inputs = App.inputs || {};

  // ------------------------------------------------------------ escaping/format
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDate(iso, withTime) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    let s = p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
    if (withTime) s += ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    return s;
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function pct(x) {
    return Math.round((x || 0) * 100) + '%';
  }

  // ------------------------------------------------------------ icons (24px stroke icons)
  const P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4"/><path d="M18 14.8c1.9.7 3.2 2.5 3.5 5.2"/>',
    book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3"/><path d="M8 7h8M8 10.5h6"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    upload: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4.5M12 8h.01"/>',
    file: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5"/><path d="M8.5 13h7M8.5 16.5h7"/>',
    sheet: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5"/><path d="M8 12h8v6H8zM12 12v6M8 15h8"/>',
    trash: '<path d="M4 6.5h16M9.5 6.5V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 6.5l.8 12.6a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12.6"/><path d="M10 11v5.5M14 11v5.5"/>',
    edit: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3"/>',
    idcard: '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><circle cx="8.5" cy="11" r="2.3"/><path d="M5.2 16.5c.5-1.8 1.8-2.8 3.3-2.8s2.8 1 3.3 2.8M14.5 9.5h4.5M14.5 13h4.5"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20.5V16h-4.5"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    anchor: '<circle cx="12" cy="5" r="2.5"/><path d="M12 7.5V21M7.5 11h9M4 14c.5 4 4 7 8 7s7.5-3 8-7"/>',
    graduation: '<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    shield: '<path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z"/><path d="m9 12 2 2 4-4"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3.5A1.5 1.5 0 0 1 10.5 2h3A1.5 1.5 0 0 1 15 3.5v1"/><path d="m8.5 12 2 2 4-4M8.5 17.5h7"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M16 6l2.5 2.5M13.5 8.5 16 11"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
    eye: '<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="3"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
    server: '<rect x="3.5" y="4" width="17" height="7" rx="1.5"/><rect x="3.5" y="13" width="17" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  };

  function icon(name, extra) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"' +
      (extra ? ' ' + extra : '') +
      '>' +
      (P[name] || '') +
      '</svg>'
    );
  }

  // ------------------------------------------------------------ small components
  function specBadge(spec) {
    if (spec === 'DECK') return '<span class="badge badge-deck">Deck</span>';
    if (spec === 'ENGINE') return '<span class="badge badge-engine">Engine</span>';
    if (spec === 'COMMON') return '<span class="badge badge-common">Κοινό</span>';
    return '<span class="faint">—</span>';
  }

  function resultBadge(r) {
    if (!r) return '';
    const C = window.Core;
    const label = C.resultLabel(r);
    if (r.status === 'pass') return '<span class="badge badge-success">' + icon('check', 'width="12" height="12"') + esc(label) + '</span>';
    if (r.status === 'fail') return '<span class="badge badge-danger">' + esc(label) + '</span>';
    if (r.status === 'incomplete') return '<span class="badge badge-warning">' + esc(label) + '</span>';
    return '<span class="badge">' + esc(label) + '</span>';
  }

  function options(list, selected) {
    return list
      .map((o) => '<option value="' + esc(o.value) + '"' + (String(o.value) === String(selected) ? ' selected' : '') + (o.disabled ? ' disabled' : '') + '>' + esc(o.label) + '</option>')
      .join('');
  }

  function emptyState(iconName, title, text, actionsHtml) {
    return (
      '<div class="empty"><div class="empty-icon">' + icon(iconName) + '</div><h3>' + esc(title) + '</h3><p>' + text + '</p>' + (actionsHtml || '') + '</div>'
    );
  }

  // ------------------------------------------------------------ toast
  function toast(message, type, opts) {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'success');
    const ic = type === 'error' || type === 'warn' ? 'alert' : type === 'info' ? 'info' : 'check';
    el.innerHTML = icon(ic) + '<div>' + message + '</div>';
    if (opts && opts.action) {
      const b = document.createElement('button');
      b.className = 'link';
      b.style.color = '#9fc7f5';
      b.style.marginLeft = '8px';
      b.textContent = opts.action.label;
      b.onclick = () => {
        opts.action.onClick();
        el.remove();
      };
      el.lastChild.appendChild(b);
    }
    root.appendChild(el);
    while (root.children.length > 3) root.firstElementChild.remove();
    setTimeout(() => {
      el.style.transition = 'opacity .25s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 260);
    }, (opts && opts.duration) || (type === 'error' ? 7000 : 4200));
  }

  // ------------------------------------------------------------ modal
  const modalStack = [];

  /**
   * openModal({ title, sub, body, size, buttons:[{label, cls, id, left, onClick(ctx)}], onMount(ctx), onClose })
   * ctx: { el, close(), setError(msg), q(sel), qa(sel), setBody(html) }
   */
  function openModal(o) {
    const root = document.getElementById('modal-root');
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    const btns = (o.buttons || [])
      .map(
        (b, i) =>
          '<button class="btn ' + (b.cls || '') + '" data-mbtn="' + i + '"' + (b.id ? ' id="' + b.id + '"' : '') + '>' + (b.icon ? icon(b.icon) : '') + esc(b.label) + '</button>'
      );
    const left = (o.buttons || []).map((b, i) => (b.left ? btns[i] : '')).join('');
    const right = (o.buttons || []).map((b, i) => (!b.left ? btns[i] : '')).join('');
    back.innerHTML =
      '<div class="modal ' + (o.size || '') + '" role="dialog" aria-modal="true">' +
      '<div class="modal-head"><div><h2>' + (o.titleHtml || esc(o.title || '')) + '</h2>' + (o.sub ? '<div class="sub">' + o.sub + '</div>' : '') + '</div>' +
      '<button class="btn btn-ghost btn-icon" data-mclose title="Κλείσιμο">' + icon('x') + '</button></div>' +
      '<div class="modal-body"><div class="modal-error error-box hidden"></div><div class="modal-content">' + (o.body || '') + '</div></div>' +
      (o.buttons && o.buttons.length ? '<div class="modal-foot"><div class="left">' + left + '</div>' + right + '</div>' : '') +
      '</div>';
    root.appendChild(back);
    const el = back.querySelector('.modal');
    const ctx = {
      el,
      closed: false,
      q: (s) => el.querySelector(s),
      qa: (s) => Array.from(el.querySelectorAll(s)),
      close() {
        if (ctx.closed) return;
        ctx.closed = true;
        back.remove();
        const i = modalStack.indexOf(ctx);
        if (i >= 0) modalStack.splice(i, 1);
        if (o.onClose) o.onClose(ctx);
      },
      setError(msg) {
        const e = el.querySelector('.modal-error');
        if (!msg) {
          e.classList.add('hidden');
          e.textContent = '';
        } else {
          e.classList.remove('hidden');
          e.textContent = msg;
        }
      },
      setBody(html) {
        el.querySelector('.modal-content').innerHTML = html;
      },
    };
    ctx.locked = !!o.locked;
    if (o.locked) el.querySelector('[data-mclose]').style.display = 'none';
    modalStack.push(ctx);
    back.addEventListener('mousedown', (e) => {
      if (e.target === back && o.dismissable !== false && !o.locked) ctx.close();
    });
    el.querySelector('[data-mclose]').addEventListener('click', () => ctx.close());
    el.querySelectorAll('[data-mbtn]').forEach((b) => {
      b.addEventListener('click', async () => {
        const def = o.buttons[Number(b.dataset.mbtn)];
        if (!def.onClick) return ctx.close();
        try {
          b.disabled = true;
          ctx.setError(null);
          const r = await def.onClick(ctx);
          if (r !== false && !def.keepOpen) ctx.close();
        } catch (err) {
          ctx.setError(err.message || String(err));
        } finally {
          b.disabled = false;
        }
      });
    });
    if (o.onMount) o.onMount(ctx);
    setTimeout(() => {
      const f = el.querySelector('[autofocus]') || el.querySelector('.modal-body input:not([type=checkbox]), .modal-body select, .modal-body textarea');
      if (f) f.focus();
    }, 20);
    return ctx;
  }

  function confirmDialog(title, message, opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      let answered = false;
      openModal({
        title,
        size: 'sm',
        body: '<div style="font-size:13.5px;line-height:1.55">' + message + '</div>',
        buttons: [
          { label: o.cancelText || 'Άκυρο', onClick: () => {} },
          {
            label: o.okText || 'Επιβεβαίωση',
            cls: o.danger ? 'btn-danger' : 'btn-primary',
            onClick: () => {
              answered = true;
              resolve(true);
            },
          },
        ],
        onClose: () => {
          if (!answered) resolve(false);
        },
      });
    });
  }

  /** Close every open dialog through its own close() (so onClose handlers run and the stack stays right). */
  function closeAllModals() {
    modalStack.slice().reverse().forEach((m) => m.close());
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalStack.length && !modalStack[modalStack.length - 1].locked) {
      modalStack[modalStack.length - 1].close();
      e.preventDefault();
    }
  });

  // ------------------------------------------------------------ delegation
  function wire() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled) return;
      const fn = App.actions[el.dataset.action];
      if (fn) {
        e.preventDefault();
        Promise.resolve()
          .then(() => fn(el, e))
          .catch((err) => {
            console.error(err);
            toast(esc(err.message || String(err)), 'error');
          });
      }
    });
    document.addEventListener('change', (e) => {
      const el = e.target.closest('[data-on-change]');
      if (!el) return;
      const fn = App.changes[el.dataset.onChange];
      if (fn)
        Promise.resolve()
          .then(() => fn(el, e))
          .catch((err) => toast(esc(err.message || String(err)), 'error'));
    });
    document.addEventListener('input', (e) => {
      const el = e.target.closest('[data-on-input]');
      if (!el) return;
      const fn = App.inputs[el.dataset.onInput];
      if (fn) fn(el, e);
    });
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  App.ui = { esc, fmtDate, plural, pct, icon, specBadge, resultBadge, options, emptyState, toast, openModal, confirmDialog, closeAllModals, wire, debounce };
})();
