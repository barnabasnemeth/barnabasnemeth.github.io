// Créme's Dessert admin. Browser uses the existing publishable Supabase client only.
(function () {
  const WEEKDAYS = ['Vasárnap', 'Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat'];
  const TEXT_COLUMNS = new Set([
    'guest_notice_allergy', 'guest_notice_rush', 'pickup_help_text',
    'rush_warning_text', 'rush_summary_text', 'monday_block_message'
  ]);
  const SORT_LABELS = {
    order_number: '#',
    customer_name: 'Ügyfél',
    pickup_date: 'Átvétel',
    grand_total: 'Összeg',
    status: 'Státusz',
    paid: 'Fizetés'
  };

  const state = {
    orders: [],
    filtered: [],
    sortKey: 'ordered_at',
    sortDir: 'desc',
    editingItems: [],
    products: [],
    pogacsa: [],
    hours: [],
    extras: [],
    extrasLoaded: false,
    slots: [],
    blackouts: [],
    moving: false,
    savingOrder: false,
    userEmail: '',
    returnFocus: null,
    drawerPanel: ''
  };

  let confirmResolver = null;
  let confirmReturn = null;

  const $ = (id) => document.getElementById(id);
  const client = () => window.cremesSupabase();

  function h(tag, attrs) {
    const node = document.createElement(tag);
    const children = Array.prototype.slice.call(arguments, 2);
    if (attrs) {
      Object.keys(attrs).forEach((key) => {
        const value = attrs[key];
        if (value == null || value === false) return;
        if (key === 'class') node.className = String(value);
        else if (key === 'text') node.textContent = String(value);
        else node.setAttribute(key, value === true ? '' : String(value));
      });
    }
    children.flat().forEach((child) => {
      if (child == null || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function svgIcon(path) {
    const wrap = document.createElement('span');
    wrap.className = 'svg';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';
    return wrap;
  }

  function money(value) {
    if (value === '' || value == null || Number.isNaN(Number(value))) return '—';
    return new Intl.NumberFormat('hu-HU').format(Number(value)) + ' Ft';
  }

  function formatAmount(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('hu-HU').format(number);
  }

  function formatQty(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value == null ? '' : value);
    return new Intl.NumberFormat('hu-HU', { maximumFractionDigits: 2 }).format(number);
  }

  function blankToNull(value) {
    if (value === '' || value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : null;
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('hu-HU', {
      timeZone: 'Europe/Budapest',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).format(date);
  }

  function budapestKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Budapest',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
  }

  function todayKey() {
    return budapestKey(new Date());
  }

  function shiftKey(key, days) {
    const parts = key.split('-').map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
    return date.toISOString().slice(0, 10);
  }

  function formatPickupDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (!match) return value ? String(value) : '—';
    const year = Number(match[1]);
    const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[3])));
    const options = { timeZone: 'UTC', month: 'short', day: 'numeric' };
    if (String(year) !== todayKey().slice(0, 4)) options.year = 'numeric';
    return new Intl.DateTimeFormat('hu-HU', options).format(date);
  }

  function formatDay(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (!match) return value ? String(value) : '—';
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return new Intl.DateTimeFormat('hu-HU', {
      timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric'
    }).format(date);
  }

  function safeImageUrl(value) {
    const url = String(value || '').trim();
    if (!url || /[\s<>"']/.test(url)) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:/i.test(url)) return '';
    return url;
  }

  function nextSort(list) {
    return list.reduce((max, row) => Math.max(max, Number(row.sort_order) || 0), -1) + 1;
  }

  function sortedItems(order) {
    return (order.order_items || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }

  function extraCount(order) {
    return [order.candle_requested, order.firework_requested, order.box_requested].filter(Boolean).length;
  }

  function describeOrder(order) {
    const items = sortedItems(order);
    const extras = extraCount(order);
    const extra = extras ? '+ ' + extras + ' extra' : '';
    if (!items.length) return { title: 'Nincs tétel', meta: '', extra: extra };
    const first = items[0];
    const bits = [];
    if (first.slices) bits.push(first.slices + ' szelet');
    if (Number(first.quantity) > 1) bits.push(first.quantity + ' db');
    else if (!first.slices && first.quantity) bits.push(first.quantity + ' db');
    if (items.length > 1) bits.push('+ ' + (items.length - 1) + ' további');
    return { title: first.product_name || 'Tétel', meta: bits.join(' · '), extra: extra };
  }

  function totalParts(order) {
    if (order.grand_total_huf != null && order.grand_total_huf !== '') {
      return { text: money(order.grand_total_huf), hint: '' };
    }
    if (order.known_subtotal_huf != null && order.known_subtotal_huf !== '') {
      return { text: money(order.known_subtotal_huf), hint: 'részösszeg' };
    }
    return { text: '—', hint: '' };
  }

  function isRecent(order) {
    return !!(order.ordered_at && (Date.now() - new Date(order.ordered_at).getTime()) <= 5 * 86400000);
  }

  function statusBadge(status) {
    const map = {
      'Új': 'badge-new',
      'Folyamatban': 'badge-progress',
      'Elkészült': 'badge-ready',
      'Átvéve': 'badge-done'
    };
    return h('span', { class: 'badge ' + (map[status] || 'badge-neutral'), text: status || '—' });
  }

  function paidBadge(paid) {
    return h('span', {
      class: 'badge ' + (paid ? 'badge-paid' : 'badge-unpaid'),
      text: paid ? 'Fizetve' : 'Nincs fizetve'
    });
  }

  function dotLabel(on, onText, offText) {
    return h('span', { class: 'dot-label' + (on ? '' : ' is-off'), text: on ? onText : offText });
  }

  function loadingNodes(label) {
    return h('div', { class: 'state-block', role: 'status' },
      h('p', { class: 'sr', text: label }),
      h('div', { class: 'skeleton-stack', 'aria-hidden': 'true' },
        h('div', { class: 'skeleton short' }),
        h('div', { class: 'skeleton' }),
        h('div', { class: 'skeleton' })
      )
    );
  }

  function messageCard(title, text, retry) {
    const card = h('div', { class: 'surface state-card' },
      h('h2', { text: title }),
      text ? h('p', { text: text }) : null
    );
    if (retry) {
      const button = h('button', { class: 'btn btn-secondary', type: 'button', text: 'Újrapróbálás' });
      button.addEventListener('click', retry);
      card.append(button);
    }
    return card;
  }

  function toast(kind, title, detail) {
    const region = $('toastRegion');
    const item = h('div', { class: 'toast toast-' + kind, role: kind === 'error' ? 'alert' : 'status' });
    item.append(
      h('span', { class: 'toast-mark', text: kind === 'error' ? '!' : '✓', 'aria-hidden': 'true' }),
      h('div', {}, h('strong', { text: title }), detail ? h('span', { text: detail }) : null)
    );
    const close = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Értesítés bezárása', text: '×' });
    item.append(close);
    region.append(item);
    while (region.children.length > 3) region.removeChild(region.firstElementChild);
    const timer = setTimeout(() => item.remove(), 4200);
    close.addEventListener('click', () => {
      clearTimeout(timer);
      item.remove();
    });
  }

  function toastOk(message) { toast('success', message); }

  function toastError(error) {
    toast('error', 'Nem sikerült menteni. Próbáld újra.', error && error.message ? String(error.message) : '');
  }

  function toastLoadError(error) {
    toast('error', 'Nem sikerült betölteni.', error && error.message ? String(error.message) : '');
  }

  async function withBusy(button, work) {
    if (button && button.disabled) return;
    if (button) {
      button.disabled = true;
      button.classList.add('is-busy');
      button.setAttribute('aria-busy', 'true');
    }
    try {
      await work();
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove('is-busy');
        button.removeAttribute('aria-busy');
      }
    }
  }

  function focusable(root) {
    return Array.prototype.filter.call(root.querySelectorAll('a[href], button, input, select, textarea, [tabindex]'), (el) => {
      if (el.disabled || el.type === 'hidden' || el.getAttribute('tabindex') === '-1') return false;
      if (el.closest('[hidden]')) return false;
      return true;
    });
  }

  function trapFocus(root, event) {
    const items = focusable(root);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function syncScrollLock() {
    const mobileNav = window.matchMedia('(max-width: 768px)').matches && $('sidebar').classList.contains('is-open');
    const locked = mobileNav || !$('drawerRoot').hidden || !$('confirmRoot').hidden;
    document.body.classList.toggle('modal-open', locked);
  }

  function syncSidebarInert() {
    const mobile = window.matchMedia('(max-width: 768px)').matches;
    $('sidebar').inert = mobile && !$('sidebar').classList.contains('is-open');
  }

  function closeNav(restoreFocus) {
    const wasOpen = $('sidebar').classList.contains('is-open');
    $('sidebar').classList.remove('is-open');
    $('menuBtn').setAttribute('aria-expanded', 'false');
    $('navBackdrop').hidden = true;
    $('appMain').inert = false;
    syncSidebarInert();
    syncScrollLock();
    if (wasOpen && restoreFocus !== false) $('menuBtn').focus();
  }

  function openNav() {
    $('sidebar').classList.add('is-open');
    $('menuBtn').setAttribute('aria-expanded', 'true');
    $('navBackdrop').hidden = false;
    $('appMain').inert = true;
    syncSidebarInert();
    syncScrollLock();
    const active = document.querySelector('.nav-btn.is-active');
    if (active) active.focus();
  }

  function setTab(name) {
    const titles = {
      orders: 'Rendelések',
      products: 'Kínálat',
      hours: 'Nyitvatartás',
      settings: 'Átvétel és szabályok'
    };
    document.querySelectorAll('[data-tab]').forEach((button) => {
      const on = button.getAttribute('data-tab') === name;
      button.classList.toggle('is-active', on);
      if (on) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-panel-page]').forEach((section) => {
      section.hidden = section.getAttribute('data-panel-page') !== name;
    });
    $('topbarTitle').textContent = titles[name] || 'Admin';
    document.title = (titles[name] || 'Admin') + ' — Créme\'s Admin';
    closeNav(false);
  }

  function confirmAction(title, body) {
    return new Promise((resolve) => {
      if (confirmResolver) confirmResolver(false);
      confirmResolver = resolve;
      confirmReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      $('confirmTitle').textContent = title;
      $('confirmBody').textContent = body;
      $('confirmRoot').hidden = false;
      $('appView').inert = true;
      if (!$('drawerRoot').hidden) $('drawer').inert = true;
      syncScrollLock();
      $('confirmCancel').focus();
    });
  }

  function finishConfirm(result) {
    if (!confirmResolver) return;
    const resolve = confirmResolver;
    confirmResolver = null;
    $('confirmRoot').hidden = true;
    $('drawer').inert = false;
    if ($('drawerRoot').hidden) $('appView').inert = false;
    syncScrollLock();
    const back = confirmReturn;
    confirmReturn = null;
    if (back && document.contains(back)) back.focus();
    resolve(result);
  }

  function visibleOpener(id) {
    const selector = '[data-open-order="' + (window.CSS && CSS.escape ? CSS.escape(String(id)) : String(id)) + '"]';
    return Array.prototype.find.call(document.querySelectorAll(selector), (el) => el.getClientRects().length > 0);
  }

  function openDrawer(options) {
    document.querySelectorAll('[data-drawer-panel]').forEach((panel) => {
      panel.hidden = panel.getAttribute('data-drawer-panel') !== options.panel;
    });
    $('drawerTitle').textContent = options.title;
    $('drawerKicker').textContent = options.kicker || '';
    $('drawerKicker').hidden = !options.kicker;
    $('drawerMeta').replaceChildren();
    $('drawer').classList.toggle('is-wide', !!options.wide);
    const save = $('drawerSave');
    save.hidden = !options.formId;
    if (options.formId) save.setAttribute('form', options.formId);
    else save.removeAttribute('form');
    save.textContent = options.saveLabel || 'Mentés';
    $('drawerDelete').hidden = !options.deletable;
    state.drawerPanel = options.panel;
    if (document.activeElement instanceof HTMLElement) state.returnFocus = document.activeElement;
    $('drawerRoot').hidden = false;
    $('appView').inert = true;
    $('appView').setAttribute('aria-hidden', 'true');
    syncScrollLock();
    const panel = document.querySelector('[data-drawer-panel="' + options.panel + '"]');
    const first = panel ? focusable(panel)[0] : null;
    (first || $('drawerClose')).focus();
  }

  function closeDrawer() {
    if (!$('confirmRoot').hidden) return;
    const panel = state.drawerPanel;
    const orderId = $('editId').value;
    $('drawerRoot').hidden = true;
    $('appView').inert = false;
    $('appView').removeAttribute('aria-hidden');
    state.drawerPanel = '';
    syncScrollLock();
    const opener = panel === 'order' ? visibleOpener(orderId) : null;
    const back = state.returnFocus;
    state.returnFocus = null;
    if (opener) opener.focus();
    else if (back && document.contains(back) && back.getClientRects().length) back.focus();
    else if (!$('appView').hidden) $('content').focus();
  }

  function bindPreview(inputId, imageId, emptyId) {
    const input = $(inputId);
    const image = $(imageId);
    const empty = $(emptyId);
    function update() {
      const url = safeImageUrl(input.value);
      if (!url) {
        image.hidden = true;
        image.removeAttribute('src');
        empty.hidden = false;
        empty.textContent = input.value.trim() ? 'A kép nem jeleníthető meg.' : 'Nincs kép';
        return;
      }
      empty.hidden = true;
      image.hidden = false;
      image.alt = '';
      image.src = url;
    }
    image.addEventListener('error', () => {
      image.hidden = true;
      empty.hidden = false;
      empty.textContent = 'A kép nem jeleníthető meg.';
    });
    input.addEventListener('input', update);
    return update;
  }

  function setLoginError(message) {
    const box = $('loginError');
    box.textContent = message || '';
    box.hidden = !message;
  }

  function showLogin(message) {
    $('bootView').hidden = true;
    $('appView').hidden = true;
    $('loginView').hidden = false;
    setLoginError(message || '');
  }

  function showApp() {
    $('bootView').hidden = true;
    $('loginView').hidden = true;
    $('appView').hidden = false;
    const email = state.userEmail || 'Admin';
    $('adminEmail').textContent = email;
    $('adminEmail').title = email;
    syncSidebarInert();
  }

  async function requireAdmin() {
    const { data, error } = await client().rpc('is_admin');
    if (error || data !== true) {
      await client().auth.signOut();
      throw new Error('Ennek a fióknak nincs admin jogosultsága.');
    }
  }

  function computeStats(orders) {
    const today = todayKey();
    const until = shiftKey(today, 7);
    const stats = { placedToday: 0, upcoming: 0, active: 0, pickupsToday: 0 };
    orders.forEach((order) => {
      if (order.ordered_at && budapestKey(new Date(order.ordered_at)) === today) stats.placedToday += 1;
      const pickup = String(order.pickup_date || '').slice(0, 10);
      if (pickup && pickup >= today && pickup <= until) stats.upcoming += 1;
      if (order.status !== 'Átvéve') stats.active += 1;
      if (pickup === today) stats.pickupsToday += 1;
    });
    return stats;
  }

  function renderStats() {
    const stats = computeStats(state.orders);
    const cards = [
      ['Ma', stats.placedToday, 'Ma leadott rendelés'],
      ['Következő 7 nap', stats.upcoming, 'Átvétel ma vagy 7 napon belül'],
      ['Aktív', stats.active, 'Még nincs átvéve'],
      ['Mai átvételek', stats.pickupsToday, 'Mai átvételi nap']
    ];
    $('orderStats').replaceChildren.apply($('orderStats'), cards.map((card) => h('article', { class: 'stat-card' },
      h('p', { class: 'stat-label', text: card[0] }),
      h('p', { class: 'stat-value', text: String(card[1]) }),
      h('p', { class: 'stat-hint', text: card[2] })
    )));
  }

  function syncSortHeaders() {
    document.querySelectorAll('.orders-table [data-sort]').forEach((button) => {
      const key = button.getAttribute('data-sort');
      const on = state.sortKey === key;
      const th = button.closest('th');
      if (th) th.setAttribute('aria-sort', on ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      button.textContent = (SORT_LABELS[key] || key) + (on ? (state.sortDir === 'asc' ? ' ↑' : ' ↓') : '');
    });
    const token = state.sortKey + ':' + state.sortDir;
    if (Array.prototype.some.call($('sortSelect').options, (option) => option.value === token)) {
      $('sortSelect').value = token;
    }
  }

  function applyFilters() {
    const query = $('searchBox').value.toLowerCase().trim();
    const status = $('statusFilter').value;
    const paid = $('paidFilter').value;
    const days = parseInt($('dateFilter').value, 10);
    const now = Date.now();
    state.filtered = state.orders.filter((order) => {
      const hay = [
        order.customer_name, order.email, order.order_number,
        ...(order.order_items || []).map((item) => item.product_name)
      ].join(' ').toLowerCase();
      if (query && hay.indexOf(query) === -1) return false;
      if (status && order.status !== status) return false;
      if (paid === 'igen' && !order.paid) return false;
      if (paid === 'nem' && order.paid) return false;
      if (days) {
        const created = new Date(order.ordered_at).getTime();
        if (!created || now - created > days * 86400000 || created > now) return false;
      }
      return true;
    });
    const dir = state.sortDir === 'asc' ? 1 : -1;
    const key = state.sortKey;
    state.filtered.sort((a, b) => {
      const va = key === 'grand_total' ? Number(a.grand_total_huf || 0) : (a[key] == null ? '' : a[key]);
      const vb = key === 'grand_total' ? Number(b.grand_total_huf || 0) : (b[key] == null ? '' : b[key]);
      if (va === vb) return 0;
      return va < vb ? -1 * dir : 1 * dir;
    });
    renderOrders();
  }

  function renderOrders() {
    const filtersOn = !!($('searchBox').value.trim() || $('statusFilter').value || $('dateFilter').value || $('paidFilter').value);
    $('clearFilters').hidden = !filtersOn;
    $('dateFilterHint').hidden = !$('dateFilter').value;
    renderStats();
    $('orderStats').hidden = false;
    $('ordersToolbar').hidden = state.orders.length === 0;
    syncSortHeaders();

    if (!state.filtered.length) {
      $('ordersResults').hidden = true;
      $('ordersCount').hidden = true;
      $('ordersState').hidden = false;
      $('ordersState').replaceChildren(messageCard(
        state.orders.length ? 'Nincs a szűrésnek megfelelő rendelés.' : 'Még nincs rendelés.',
        state.orders.length ? 'Módosítsd a szűrőket, vagy töröld őket.' : 'Az új rendelések itt fognak megjelenni.'
      ));
      if (!state.orders.length) $('ordersToolbar').hidden = true;
      return;
    }

    $('ordersState').hidden = true;
    $('ordersResults').hidden = false;
    $('ordersCount').hidden = false;
    $('ordersCount').textContent = state.filtered.length === state.orders.length
      ? state.orders.length + ' rendelés'
      : state.filtered.length + ' / ' + state.orders.length + ' rendelés';

    const body = $('ordersBody');
    const cards = $('ordersCards');
    body.replaceChildren();
    cards.replaceChildren();
    state.filtered.forEach((order) => {
      body.append(orderRow(order));
      cards.append(orderCard(order));
    });
  }

  function orderRow(order) {
    const summary = describeOrder(order);
    const total = totalParts(order);
    const tr = h('tr', { 'data-open-order': order.id });
    if (order.paid && order.status === 'Átvéve') tr.classList.add('is-done');
    const number = h('td');
    number.append(h('span', { class: 'num', text: '#' + order.order_number }));
    if (isRecent(order)) number.append(h('span', { class: 'cell-sub', text: 'Friss', title: 'Az elmúlt 5 napban érkezett' }));
    const customer = h('td');
    customer.append(h('span', { class: 'cell-strong', text: order.customer_name || '' }));
    if (order.email) customer.append(h('span', { class: 'cell-sub', text: order.email }));
    const pickup = h('td');
    pickup.append(h('span', { text: formatPickupDate(order.pickup_date) }));
    pickup.append(h('span', { class: 'cell-sub', text: order.pickup_slot || '—' }));
    const items = h('td');
    items.append(h('span', { class: 'cell-strong', text: summary.title }));
    if (summary.meta) items.append(h('span', { class: 'cell-sub', text: summary.meta }));
    if (summary.extra) items.append(h('span', { class: 'cell-sub', text: summary.extra }));
    const amount = h('td');
    amount.append(h('span', { class: 'cell-strong', text: total.text }));
    if (total.hint) amount.append(h('span', { class: 'cell-sub', text: total.hint }));
    const action = h('td');
    action.append(h('button', { class: 'btn btn-ghost', type: 'button', text: 'Részletek', 'data-open-order': order.id }));
    tr.append(number, customer, pickup, items, amount, h('td', {}, statusBadge(order.status)), h('td', {}, paidBadge(order.paid)), action);
    return tr;
  }

  function orderCard(order) {
    const summary = describeOrder(order);
    const total = totalParts(order);
    const button = h('button', { class: 'order-card-btn', type: 'button', 'data-open-order': order.id });
    const top = h('span', { class: 'order-card-top' });
    top.append(h('span', { class: 'num', text: '#' + order.order_number }), statusBadge(order.status));
    button.append(top);
    button.append(h('span', { class: 'order-card-name', text: order.customer_name || '' }));
    button.append(h('span', { class: 'order-card-when', text: formatPickupDate(order.pickup_date) + ' · ' + (order.pickup_slot || '—') }));
    button.append(h('span', { class: 'order-card-item', text: summary.title }));
    if (summary.meta) button.append(h('span', { class: 'order-card-extra', text: summary.meta }));
    if (summary.extra) button.append(h('span', { class: 'order-card-extra', text: summary.extra }));
    button.append(h('span', { class: 'order-card-item', text: total.text }));
    if (total.hint) button.append(h('span', { class: 'order-card-extra', text: total.hint }));
    const foot = h('span', { class: 'order-card-foot' });
    foot.append(paidBadge(order.paid), h('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }));
    button.append(foot);
    return h('article', { class: 'order-card' }, button);
  }

  function showOrdersLoading() {
    $('orderStats').hidden = true;
    $('ordersToolbar').hidden = true;
    $('dateFilterHint').hidden = true;
    $('ordersCount').hidden = true;
    $('ordersResults').hidden = true;
    $('ordersState').hidden = false;
    $('ordersState').replaceChildren(loadingNodes('Rendelések betöltése…'));
  }

  async function loadOrders() {
    if (!state.orders.length) showOrdersLoading();
    try {
      const { data, error } = await client().from('orders').select('*, order_items(*)').order('ordered_at', { ascending: false });
      if (error) throw error;
      state.orders = data || [];
      applyFilters();
    } catch (error) {
      if (!state.orders.length) {
        $('ordersState').hidden = false;
        $('ordersState').replaceChildren(messageCard('Nem sikerült betölteni a rendeléseket.', 'Próbáld újra.', loadOrders));
      } else toastLoadError(error);
    }
  }

  function refreshOrderMeta() {
    const meta = $('drawerMeta');
    meta.replaceChildren(
      statusBadge($('editStatus').value),
      paidBadge($('editPaid').value === 'true')
    );
    if ($('editRush').checked) meta.append(h('span', { class: 'badge badge-soft', text: 'Rövid határidő' }));
    const when = $('orderForm').dataset.when;
    if (when) meta.append(h('span', { text: when }));
  }

  function renderEditItems() {
    const box = $('editItems');
    box.replaceChildren();
    if (!state.editingItems.length) {
      box.append(h('p', { class: 'hint', text: 'Ehhez a rendeléshez nincs tétel.' }));
      return;
    }
    state.editingItems.forEach((item, index) => {
      box.append(h('div', { class: 'item-edit' },
        itemInput('Termék', 'text', item.product_name, 'product_name', index),
        itemInput('Szelet', 'number', item.slices == null ? '' : item.slices, 'slices', index),
        itemInput('Mennyiség', 'number', item.quantity, 'quantity', index),
        itemInput('Egységár', 'number', item.unit_price_huf == null ? '' : item.unit_price_huf, 'unit_price_huf', index),
        itemInput('Összeg', 'number', item.line_total_huf == null ? '' : item.line_total_huf, 'line_total_huf', index)
      ));
    });
  }

  function itemInput(label, type, value, field, index) {
    const id = 'item-' + index + '-' + field;
    const input = h('input', {
      id: id,
      class: 'input',
      type: type,
      'data-index': String(index),
      'data-item': field,
      inputmode: type === 'number' ? 'numeric' : 'text'
    });
    input.value = value == null ? '' : String(value);
    if (field === 'quantity') { input.min = '1'; input.max = '50'; }
    if (field === 'slices') { input.min = '1'; input.max = '200'; }
    if (field === 'unit_price_huf' || field === 'line_total_huf') input.min = '0';
    return h('div', { class: 'field' }, h('label', { for: id, text: label }), input);
  }

  function openEdit(order) {
    state.editingItems = sortedItems(order).map((item) => Object.assign({}, item));
    $('editId').value = order.id;
    $('orderForm').dataset.when = formatDateTime(order.ordered_at);
    $('editName').value = order.customer_name || '';
    $('editEmail').value = order.email || '';
    $('editPhone').value = order.phone || '';
    $('editPickup').value = String(order.pickup_date || '').slice(0, 10);
    $('editSlot').value = order.pickup_slot || '';
    $('editCandle').checked = !!order.candle_requested;
    $('editCandleText').value = order.candle_text || '';
    $('editFirework').checked = !!order.firework_requested;
    $('editBox').checked = !!order.box_requested;
    $('editHaccp').checked = !!order.haccp_requested;
    $('editInvoice').checked = !!order.invoice_requested;
    $('editCompany').value = order.invoice_company || '';
    $('editAddress').value = order.invoice_address || '';
    $('editTax').value = order.invoice_tax_id || '';
    $('editCakeTotal').value = order.cake_total_huf ?? '';
    $('editCandleTotal').value = order.candle_total_huf ?? '';
    $('editFireworkTotal').value = order.firework_total_huf ?? '';
    $('editBoxTotal').value = order.box_total_huf ?? '';
    $('editRush').checked = !!order.is_rush;
    $('editRushFee').value = order.rush_surcharge_huf ?? '';
    $('editSubtotal').value = order.known_subtotal_huf ?? '';
    $('editGrand').value = order.grand_total_huf ?? '';
    $('editAllergy').value = order.allergy_note || '';
    $('editNote').value = order.note || '';
    $('editStatus').value = order.status;
    $('editStatus').dataset.prev = order.status;
    $('editPaid').value = String(!!order.paid);
    $('editPaid').dataset.prev = String(!!order.paid);
    renderEditItems();
    openDrawer({
      title: 'Rendelés #' + order.order_number,
      kicker: 'Rendelések',
      panel: 'order',
      formId: 'orderForm',
      deletable: false,
      wide: true
    });
    refreshOrderMeta();
  }

  async function patchOrder(id, payload, select, previous, success) {
    select.disabled = true;
    let error = null;
    try {
      const result = await client().from('orders').update(payload).eq('id', id);
      error = result.error;
    } catch (err) {
      error = err;
    }
    const same = $('editId').value === id;
    if (same) select.disabled = false;
    const row = state.orders.find((order) => order.id === id);
    if (error) {
      if (same) {
        select.value = previous;
        select.dataset.prev = previous;
        refreshOrderMeta();
      }
      toastError(error);
      return;
    }
    if (row) Object.assign(row, payload);
    if (same) {
      select.dataset.prev = select.value;
      refreshOrderMeta();
    }
    toastOk(success);
    applyFilters();
  }

  async function saveOrder() {
    if (state.savingOrder) return;
    const id = $('editId').value;
    if (!id) return;
    state.savingOrder = true;
    const update = {
      customer_name: $('editName').value.trim(),
      email: $('editEmail').value.trim(),
      phone: $('editPhone').value.trim(),
      pickup_date: $('editPickup').value,
      pickup_slot: $('editSlot').value.trim(),
      candle_requested: $('editCandle').checked,
      candle_text: $('editCandleText').value.trim(),
      firework_requested: $('editFirework').checked,
      box_requested: $('editBox').checked,
      haccp_requested: $('editHaccp').checked,
      invoice_requested: $('editInvoice').checked,
      invoice_company: $('editCompany').value.trim() || null,
      invoice_address: $('editAddress').value.trim() || null,
      invoice_tax_id: $('editTax').value.trim() || null,
      cake_total_huf: blankToNull($('editCakeTotal').value),
      candle_total_huf: blankToNull($('editCandleTotal').value),
      firework_total_huf: blankToNull($('editFireworkTotal').value),
      box_total_huf: blankToNull($('editBoxTotal').value),
      is_rush: $('editRush').checked,
      rush_surcharge_huf: blankToNull($('editRushFee').value),
      known_subtotal_huf: blankToNull($('editSubtotal').value),
      grand_total_huf: blankToNull($('editGrand').value),
      allergy_note: $('editAllergy').value.trim(),
      note: $('editNote').value
    };
    try {
      const saved = await client().from('orders').update(update).eq('id', id);
      if (saved.error) { toastError(saved.error); return; }
      const removed = await client().from('order_items').delete().eq('order_id', id);
      if (removed.error) { toastError(removed.error); return; }
      if (state.editingItems.length) {
        const rows = state.editingItems.map((item, index) => ({
          order_id: id,
          product_id: item.product_id || null,
          product_name: String(item.product_name || '').trim() || 'Tétel',
          slices: blankToNull(item.slices),
          quantity: Number(item.quantity) || 1,
          unit_price_huf: blankToNull(item.unit_price_huf),
          line_total_huf: blankToNull(item.line_total_huf),
          sort_order: index + 1
        }));
        const inserted = await client().from('order_items').insert(rows);
        if (inserted.error) { toastError(inserted.error); return; }
      }
      closeDrawer();
      toastOk('Módosítások mentve');
      await loadOrders();
    } finally {
      state.savingOrder = false;
    }
  }

  function openOrderFrom(event) {
    const source = event.target.closest('[data-open-order]');
    if (!source) return;
    if (event.target.closest('a, input, select, textarea')) return;
    const order = state.orders.find((row) => row.id === source.getAttribute('data-open-order'));
    if (order) openEdit(order);
  }

  function tagsOf(value) {
    return String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean);
  }

  function updateProductSubtitle() {
    const active = state.products.filter((product) => product.is_available).length;
    const hidden = state.products.length - active;
    if (!state.products.length) $('productSubtitle').textContent = 'Még nincs termék.';
    else if (!hidden) $('productSubtitle').textContent = active + ' aktív termék';
    else $('productSubtitle').textContent = active + ' aktív termék · ' + hidden + ' nem rendelhető';
  }

  function renderProducts() {
    updateProductSubtitle();
    const list = $('productList');
    if (!state.products.length) {
      list.hidden = true;
      $('productState').hidden = false;
      $('productState').replaceChildren(messageCard('Még nincs ilyen termék.', 'Az első terméket az Új termék gombbal veheted fel.'));
      return;
    }
    $('productState').hidden = true;
    list.hidden = false;
    list.replaceChildren();
    state.products.forEach((product, index) => {
      list.append(productCard(product, index));
    });
  }

  function productCard(product, index) {
    const photo = h('div', { class: 'product-photo' });
    const url = safeImageUrl(product.image_url);
    if (url) {
      const image = h('img', { alt: '', loading: 'lazy' });
      image.src = url;
      image.addEventListener('error', () => {
        image.remove();
        photo.append(h('span', { text: 'Nincs kép' }));
      });
      photo.append(image);
    } else photo.append(h('span', { text: 'Nincs kép' }));

    const prices = product.product_prices || [];
    const known = [8, 12, 16, 24].map((size) => prices.find((price) => Number(price.slices) === size)).filter(Boolean);
    const unit = prices.find((price) => price.slices == null);
    const priceList = h('div', { class: 'price-list' });
    known.forEach((price) => {
      priceList.append(h('div', {}, h('span', { text: price.slices + ' szelet' }), h('span', { text: money(price.price_huf) })));
    });
    if (unit) priceList.append(h('div', {}, h('span', { text: 'Egységár' }), h('span', { text: money(unit.price_huf) })));

    const tags = tagsOf(product.dietary_tags);
    const body = h('div', { class: 'product-body' },
      h('h2', { text: product.name }),
      tags.length ? h('div', { class: 'tag-row' }, tags.map((tag) => h('span', { class: 'tag', text: tag }))) : null,
      known.length || unit ? priceList : h('p', { class: 'hint', text: 'Ár egyeztetés után' }),
      dotLabel(product.is_available, 'Rendelhető', 'Nem rendelhető'),
      h('p', { class: 'hint', text: product.show_on_homepage ? 'Főoldalon' : 'Nincs a főoldalon' }),
      h('div', { class: 'card-foot' },
        moveGroup(product.id, index, state.products.length),
        h('button', { class: 'btn btn-secondary', type: 'button', text: 'Szerkesztés', 'data-edit-product': product.id })
      )
    );
    return h('article', { class: 'surface product-card' }, photo, body);
  }

  function moveGroup(id, index, length) {
    const up = h('button', {
      class: 'icon-btn', type: 'button', 'data-move': 'up', 'data-id': id,
      'aria-label': 'Feljebb', title: 'Feljebb'
    }, svgIcon('<path d="M6 14l6-6 6 6" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>'));
    const down = h('button', {
      class: 'icon-btn', type: 'button', 'data-move': 'down', 'data-id': id,
      'aria-label': 'Lejjebb', title: 'Lejjebb'
    }, svgIcon('<path d="M6 10l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>'));
    up.disabled = index === 0;
    down.disabled = index === length - 1;
    return h('div', { class: 'move-group' }, up, down);
  }

  function fillProductForm(product) {
    $('productId').value = product ? product.id : '';
    $('productName').value = product ? product.name : '';
    $('productTags').value = product ? (product.dietary_tags || '') : '';
    $('productSort').value = product ? product.sort_order : nextSort(state.products);
    $('productImage').value = product ? (product.image_url || '') : '';
    $('productAvailable').checked = product ? !!product.is_available : true;
    $('productHomepage').checked = product ? !!product.show_on_homepage : true;
    const prices = {};
    (product && product.product_prices || []).forEach((price) => {
      prices[price.slices == null ? 'unit' : price.slices] = price.price_huf;
    });
    $('price8').value = prices[8] ?? '';
    $('price12').value = prices[12] ?? '';
    $('price16').value = prices[16] ?? '';
    $('price24').value = prices[24] ?? '';
    $('priceUnit').value = prices.unit ?? '';
    updateProductPreview();
  }

  function openProduct(product) {
    fillProductForm(product);
    openDrawer({
      title: product ? 'Termék szerkesztése' : 'Új termék',
      kicker: 'Szeletes torták',
      panel: 'product',
      formId: 'productForm',
      deletable: !!product
    });
  }

  async function loadProducts() {
    if (!state.products.length) {
      $('productList').hidden = true;
      $('productState').hidden = false;
      $('productState').replaceChildren(loadingNodes('Termékek betöltése…'));
      $('productSubtitle').textContent = 'Betöltés…';
    }
    try {
      const { data, error } = await client().from('products').select('*, product_prices(slices,price_huf)').order('sort_order');
      if (error) throw error;
      state.products = data || [];
      renderProducts();
    } catch (error) {
      if (!state.products.length) {
        $('productSubtitle').textContent = 'Nem sikerült betölteni.';
        $('productState').hidden = false;
        $('productState').replaceChildren(messageCard('Nem sikerült betölteni a termékeket.', 'Próbáld újra.', loadProducts));
      } else toastLoadError(error);
    }
  }

  async function saveProduct() {
    const payload = {
      name: $('productName').value.trim(),
      dietary_tags: $('productTags').value.trim(),
      sort_order: Number($('productSort').value) || 0,
      image_url: $('productImage').value.trim() || null,
      is_available: $('productAvailable').checked,
      show_on_homepage: $('productHomepage').checked
    };
    let id = $('productId').value;
    if (id) {
      const updated = await client().from('products').update(payload).eq('id', id);
      if (updated.error) { toastError(updated.error); return; }
    } else {
      const inserted = await client().from('products').insert(payload).select('id').single();
      if (inserted.error) { toastError(inserted.error); return; }
      id = inserted.data.id;
      $('productId').value = id;
      $('drawerDelete').hidden = false;
    }
    const removed = await client().from('product_prices').delete().eq('product_id', id);
    if (removed.error) { toastError(removed.error); return; }
    const rows = [];
    [[8, 'price8'], [12, 'price12'], [16, 'price16'], [24, 'price24']].forEach(([slices, field]) => {
      if ($(field).value !== '') rows.push({ product_id: id, slices: slices, price_huf: Number($(field).value) });
    });
    if (!rows.length && $('priceUnit').value !== '') {
      rows.push({ product_id: id, slices: null, price_huf: Number($('priceUnit').value) });
    }
    if (rows.length) {
      const priced = await client().from('product_prices').insert(rows);
      if (priced.error) { toastError(priced.error); return; }
    }
    closeDrawer();
    toastOk('Termék mentve');
    await loadProducts();
  }

  async function deleteProduct() {
    const id = $('productId').value;
    const name = $('productName').value.trim() || 'termék';
    if (!id) return;
    const ok = await confirmAction(
      'Biztosan törlöd a „' + name + '” terméket?',
      'A régi rendeléseken a név megmarad. Ez a művelet nem vonható vissza.'
    );
    if (!ok) return;
    await withBusy($('drawerDelete'), async () => {
      const { error } = await client().from('products').delete().eq('id', id);
      if (error) { toastError(error); return; }
      closeDrawer();
      toastOk('Termék törölve');
      await loadProducts();
    });
  }

  function renderPogacsa() {
    const count = state.pogacsa.length;
    $('pogacsaSubtitle').textContent = count ? count + ' pogácsa' : 'Még nincs pogácsa.';
    const list = $('pogacsaList');
    if (!count) {
      list.hidden = true;
      $('pogacsaState').hidden = false;
      $('pogacsaState').replaceChildren(messageCard('Még nincs ilyen termék.', 'Az első pogácsát az Új pogácsa gombbal veheted fel.'));
      return;
    }
    $('pogacsaState').hidden = true;
    list.hidden = false;
    list.replaceChildren();
    state.pogacsa.forEach((row, index) => list.append(pogacsaRow(row, index)));
  }

  function pogacsaRow(row, index) {
    const main = h('div', { class: 'entity-main' });
    const title = h('div', { class: 'entity-title' },
      h('span', { text: row.name }),
      dotLabel(row.is_available, 'Aktív', 'Inaktív')
    );
    if (row.is_featured) title.append(h('span', { class: 'badge badge-soft', text: 'Kiemelt' }));
    main.append(
      title,
      h('p', { class: 'entity-meta', text: formatAmount(row.price_huf) + ' ' + (row.price_unit_label || '') }),
      h('p', { class: 'entity-meta', text: 'Minimum rendelés: ' + formatQty(row.min_order_quantity) + ' ' + (row.quantity_unit || '') })
    );
    const url = safeImageUrl(row.image_url);
    let thumb = null;
    if (url) {
      thumb = h('img', { class: 'thumb', alt: '' });
      thumb.src = url;
      thumb.addEventListener('error', () => thumb.remove());
    }
    return h('div', { class: 'entity-row' },
      thumb,
      main,
      h('div', { class: 'row-actions' },
        moveGroup(row.id, index, state.pogacsa.length),
        h('button', { class: 'btn btn-ghost', type: 'button', text: 'Szerkesztés', 'data-edit-pogacsa': row.id })
      )
    );
  }

  function fillPogacsa(row) {
    $('pogacsaId').value = row ? row.id : '';
    $('pogacsaName').value = row ? row.name : '';
    $('pogacsaPrice').value = row ? row.price_huf : '';
    $('pogacsaSort').value = row ? row.sort_order : nextSort(state.pogacsa);
    $('pogacsaMin').value = row ? row.min_order_quantity : '';
    $('pogacsaUnit').value = row ? row.quantity_unit : 'kg';
    $('pogacsaLabel').value = row ? row.price_unit_label : 'Ft / kg';
    $('pogacsaImage').value = row ? (row.image_url || '') : '';
    $('pogacsaFeatured').checked = row ? !!row.is_featured : false;
    $('pogacsaAvailable').checked = row ? !!row.is_available : true;
    updatePogacsaPreview();
  }

  function openPogacsa(row) {
    fillPogacsa(row);
    openDrawer({
      title: row ? 'Pogácsa szerkesztése' : 'Új pogácsa',
      kicker: 'Pogácsa',
      panel: 'pogacsa',
      formId: 'pogacsaForm',
      deletable: !!row
    });
  }

  async function loadPogacsa() {
    if (!state.pogacsa.length) {
      $('pogacsaList').hidden = true;
      $('pogacsaState').hidden = false;
      $('pogacsaState').replaceChildren(loadingNodes('Pogácsa betöltése…'));
      $('pogacsaSubtitle').textContent = 'Betöltés…';
    }
    try {
      const { data, error } = await client().from('pogacsa_products').select('*').order('sort_order');
      if (error) throw error;
      state.pogacsa = data || [];
      renderPogacsa();
    } catch (error) {
      if (!state.pogacsa.length) {
        $('pogacsaSubtitle').textContent = 'Nem sikerült betölteni.';
        $('pogacsaState').hidden = false;
        $('pogacsaState').replaceChildren(messageCard('Nem sikerült betölteni a pogácsát.', 'Próbáld újra.', loadPogacsa));
      } else toastLoadError(error);
    }
  }

  async function savePogacsa() {
    const payload = {
      name: $('pogacsaName').value.trim(),
      price_huf: Number($('pogacsaPrice').value),
      min_order_quantity: Number($('pogacsaMin').value),
      quantity_unit: $('pogacsaUnit').value.trim() || 'kg',
      price_unit_label: $('pogacsaLabel').value.trim() || 'Ft / kg',
      image_url: $('pogacsaImage').value.trim() || null,
      is_featured: $('pogacsaFeatured').checked,
      is_available: $('pogacsaAvailable').checked,
      sort_order: Number($('pogacsaSort').value) || 0
    };
    const id = $('pogacsaId').value;
    const result = id
      ? await client().from('pogacsa_products').update(payload).eq('id', id)
      : await client().from('pogacsa_products').insert(payload);
    if (result.error) { toastError(result.error); return; }
    closeDrawer();
    toastOk('Pogácsa mentve');
    await loadPogacsa();
  }

  async function deletePogacsa() {
    const id = $('pogacsaId').value;
    const name = $('pogacsaName').value.trim() || 'pogácsa';
    if (!id) return;
    const ok = await confirmAction(
      'Biztosan törlöd a „' + name + '” pogácsát?',
      'Ez a művelet nem vonható vissza.'
    );
    if (!ok) return;
    await withBusy($('drawerDelete'), async () => {
      const { error } = await client().from('pogacsa_products').delete().eq('id', id);
      if (error) { toastError(error); return; }
      closeDrawer();
      toastOk('Pogácsa törölve');
      await loadPogacsa();
    });
  }

  function setTimeInput(input, value) {
    const raw = value == null ? '' : String(value);
    input.dataset.original = raw;
    if (/^\d{2}:\d{2}/.test(raw)) {
      input.type = 'time';
      input.value = raw.slice(0, 5);
    } else {
      input.type = 'text';
      input.value = raw;
    }
  }

  function readTimeInput(input) {
    const value = input.value.trim();
    if (!value) return null;
    const original = input.dataset.original || '';
    if (original && input.type === 'time' && original.slice(0, 5) === value) return original;
    return value;
  }

  function formatClock(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return /^\d{2}:\d{2}/.test(raw) ? raw.slice(0, 5) : raw;
  }

  function formatHours(row) {
    if (row.is_closed) return 'Zárva';
    const open = formatClock(row.opens_at);
    const close = formatClock(row.closes_at);
    if (open && close) return open + ' – ' + close;
    return open || close || 'Nincs megadva';
  }

  function renderHours() {
    const list = $('hoursList');
    list.replaceChildren();
    if (!state.hours.length) {
      list.append(h('p', { class: 'hint', text: 'Még nincs nyitvatartási sor.' }));
      return;
    }
    state.hours.forEach((row, index) => {
      list.append(h('div', { class: 'hours-row' },
        h('span', { class: 'hours-label', text: row.day_label }),
        h('span', { class: 'hours-value', text: formatHours(row) }),
        h('div', { class: 'row-actions' },
          moveGroup(row.id, index, state.hours.length),
          h('button', { class: 'btn btn-ghost', type: 'button', text: 'Szerkesztés', 'data-edit-hours': row.id })
        )
      ));
    });
  }

  function renderExtras() {
    const list = $('extrasList');
    list.replaceChildren();
    if (!state.extras.length) {
      list.append(h('p', { class: 'hint', text: 'Még nincs finomság.' }));
      return;
    }
    state.extras.forEach((row, index) => {
      list.append(h('div', { class: 'extra-row' },
        h('span', { class: 'entity-main entity-title', text: row.name }),
        dotLabel(row.is_visible, 'Látható', 'Rejtett'),
        h('div', { class: 'row-actions' },
          moveGroup(row.id, index, state.extras.length),
          h('button', { class: 'btn btn-ghost', type: 'button', text: 'Szerkesztés', 'data-edit-extra': row.id })
        )
      ));
    });
  }

  function openHours(row) {
    $('hoursId').value = row && row.id ? row.id : '';
    $('hoursLabel').value = row ? row.day_label || '' : '';
    setTimeInput($('hoursOpen'), row ? row.opens_at : '');
    setTimeInput($('hoursClose'), row ? row.closes_at : '');
    $('hoursClosed').checked = row ? !!row.is_closed : false;
    $('hoursSort').value = row && row.id ? row.sort_order : nextSort(state.hours);
    openDrawer({
      title: row && row.id ? 'Nyitvatartás szerkesztése' : 'Új sor',
      kicker: 'Nyitvatartás',
      panel: 'hours',
      formId: 'hoursForm',
      deletable: !!(row && row.id)
    });
  }

  function openExtra(row) {
    $('extraId').value = row && row.id ? row.id : '';
    $('extraName').value = row ? row.name || '' : '';
    $('extraVisible').checked = row ? !!row.is_visible : true;
    $('extraSort').value = row && row.id ? row.sort_order : nextSort(state.extras);
    openDrawer({
      title: row && row.id ? 'Finomság szerkesztése' : 'Új finomság',
      kicker: 'Aktuális finomságok',
      panel: 'extra',
      formId: 'extraForm',
      deletable: !!(row && row.id)
    });
  }

  async function loadHours() {
    const first = $('hoursContent').hidden;
    if (first) {
      $('hoursState').hidden = false;
      $('hoursState').replaceChildren(loadingNodes('Nyitvatartás betöltése…'));
    }
    try {
      const [hoursRes, settingsRes] = await Promise.all([
        client().from('opening_hours').select('*').order('sort_order'),
        client().from('order_settings').select('opening_notice').eq('id', 1).single()
      ]);
      if (hoursRes.error || settingsRes.error) throw hoursRes.error || settingsRes.error;
      state.hours = hoursRes.data || [];
      if (document.activeElement !== $('openingNotice')) {
        $('openingNotice').value = settingsRes.data.opening_notice || '';
      }
      renderHours();
      $('hoursState').hidden = true;
      $('hoursContent').hidden = false;
    } catch (error) {
      if ($('hoursContent').hidden) {
        $('hoursState').hidden = false;
        $('hoursState').replaceChildren(messageCard('Nem sikerült betölteni a nyitvatartást.', 'Próbáld újra.', loadHours));
      } else toastLoadError(error);
    }
  }

  async function loadExtras() {
    if (!state.extrasLoaded) {
      $('extrasList').hidden = true;
      $('extrasState').hidden = false;
      $('extrasState').replaceChildren(loadingNodes('Finomságok betöltése…'));
    }
    try {
      const { data, error } = await client().from('homepage_extras').select('*').order('sort_order');
      if (error) throw error;
      state.extras = data || [];
      state.extrasLoaded = true;
      renderExtras();
      $('extrasState').hidden = true;
      $('extrasList').hidden = false;
    } catch (error) {
      if (!state.extrasLoaded) {
        $('extrasState').hidden = false;
        $('extrasState').replaceChildren(messageCard('Nem sikerült betölteni a finomságokat.', 'Próbáld újra.', loadExtras));
      } else toastLoadError(error);
    }
  }

  async function saveHours() {
    const id = $('hoursId').value;
    const payload = {
      day_label: $('hoursLabel').value.trim(),
      opens_at: readTimeInput($('hoursOpen')),
      closes_at: readTimeInput($('hoursClose')),
      is_closed: $('hoursClosed').checked,
      sort_order: Number($('hoursSort').value) || 0
    };
    const result = id
      ? await client().from('opening_hours').update(payload).eq('id', id)
      : await client().from('opening_hours').insert(payload);
    if (result.error) { toastError(result.error); return; }
    closeDrawer();
    toastOk('Nyitvatartás mentve');
    await loadHours();
  }

  async function deleteHours() {
    const id = $('hoursId').value;
    const label = $('hoursLabel').value.trim() || 'sor';
    if (!id) return;
    const ok = await confirmAction(
      'Biztosan törlöd a „' + label + '” sort?',
      'Ez a művelet nem vonható vissza.'
    );
    if (!ok) return;
    await withBusy($('drawerDelete'), async () => {
      const { error } = await client().from('opening_hours').delete().eq('id', id);
      if (error) { toastError(error); return; }
      closeDrawer();
      toastOk('Sor törölve');
      await loadHours();
    });
  }

  async function saveExtra() {
    const id = $('extraId').value;
    const payload = {
      name: $('extraName').value.trim(),
      sort_order: Number($('extraSort').value) || 0,
      is_visible: $('extraVisible').checked
    };
    const result = id
      ? await client().from('homepage_extras').update(payload).eq('id', id)
      : await client().from('homepage_extras').insert(payload);
    if (result.error) { toastError(result.error); return; }
    closeDrawer();
    toastOk('Finomság mentve');
    await loadExtras();
  }

  async function deleteExtra() {
    const id = $('extraId').value;
    const name = $('extraName').value.trim() || 'finomság';
    if (!id) return;
    const ok = await confirmAction(
      'Biztosan törlöd a „' + name + '” finomságot?',
      'Ez a művelet nem vonható vissza.'
    );
    if (!ok) return;
    await withBusy($('drawerDelete'), async () => {
      const { error } = await client().from('homepage_extras').delete().eq('id', id);
      if (error) { toastError(error); return; }
      closeDrawer();
      toastOk('Finomság törölve');
      await loadExtras();
    });
  }

  async function moveRow(table, list, id, direction, reload) {
    if (state.moving) return;
    const index = list.findIndex((row) => row.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    const current = list[index];
    const other = list[target];
    let currentOrder = Number(current.sort_order) || 0;
    let otherOrder = Number(other.sort_order) || 0;
    if (currentOrder === otherOrder) {
      currentOrder = index;
      otherOrder = target;
    }
    state.moving = true;
    try {
      const first = await client().from(table).update({ sort_order: otherOrder }).eq('id', current.id);
      if (first.error) { toastError(first.error); return; }
      const second = await client().from(table).update({ sort_order: currentOrder }).eq('id', other.id);
      if (second.error) { toastError(second.error); await reload(); return; }
      toastOk('Sorrend mentve');
      await reload();
    } finally {
      state.moving = false;
    }
  }

  function handleMove(event, table, list, reload) {
    const button = event.target.closest('[data-move]');
    if (!button || button.disabled) return;
    moveRow(table, list, button.getAttribute('data-id'), button.getAttribute('data-move') === 'up' ? -1 : 1, reload);
  }

  function fillWeekdays() {
    $('slotWeekday').replaceChildren();
    WEEKDAYS.forEach((name, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = name;
      $('slotWeekday').append(option);
    });
  }

  function syncRushHelper() {
    $('rushHelper').hidden = $('setChargeRush').checked;
  }

  function renderSlots() {
    const list = $('slotsList');
    list.replaceChildren();
    if (!state.slots.length) {
      list.append(h('p', { class: 'hint', text: 'Még nincs átvételi idősáv.' }));
      return;
    }
    let last = null;
    state.slots.forEach((slot) => {
      if (slot.weekday !== last) {
        list.append(h('h3', { class: 'entity-meta', text: WEEKDAYS[slot.weekday] || 'Nap' }));
        last = slot.weekday;
      }
      list.append(h('div', { class: 'slot-row' },
        h('span', { class: 'entity-main', text: slot.label }),
        h('button', { class: 'btn btn-ghost', type: 'button', text: 'Törlés', 'data-delete-slot': slot.id })
      ));
    });
  }

  function renderBlackouts() {
    const list = $('blackoutList');
    list.replaceChildren();
    if (!state.blackouts.length) {
      list.append(h('p', { class: 'hint', text: 'Nincs zárolt időszak.' }));
      return;
    }
    state.blackouts.forEach((range) => {
      const main = h('div', { class: 'entity-main' },
        h('div', { class: 'entity-title', text: formatDay(range.starts_on) + ' – ' + formatDay(range.ends_on) }),
        h('p', { class: 'entity-meta', text: range.blocks_cakes_only ? 'Csak torta' : 'Teljes zárás' })
      );
      if (range.message) main.append(h('p', { class: 'entity-meta', text: range.message }));
      list.append(h('div', { class: 'slot-row' },
        main,
        h('button', { class: 'btn btn-ghost', type: 'button', text: 'Törlés', 'data-delete-blackout': range.id })
      ));
    });
  }

  async function loadSettings() {
    const first = $('settingsContent').hidden;
    if (first) {
      $('settingsState').hidden = false;
      $('settingsState').replaceChildren(loadingNodes('Szabályok betöltése…'));
    }
    try {
      const [settingsRes, slotsRes, blackoutRes] = await Promise.all([
        client().from('order_settings').select('*').eq('id', 1).single(),
        client().from('pickup_slots').select('*').order('weekday').order('sort_order'),
        client().from('blackout_ranges').select('*').order('starts_on')
      ]);
      if (settingsRes.error || slotsRes.error || blackoutRes.error) {
        throw settingsRes.error || slotsRes.error || blackoutRes.error;
      }
      const settings = settingsRes.data;
      $('setLead').value = settings.min_lead_days;
      $('setRushDays').value = settings.rush_within_days;
      $('setRushFee').value = settings.rush_surcharge_huf ?? '';
      $('setChargeRush').checked = settings.charge_rush_surcharge;
      $('setMonday').checked = settings.block_cakes_on_monday;
      $('setCandle').value = settings.candle_unit_price_huf;
      $('setBox').value = settings.box_price_huf;
      $('setFirework').value = settings.firework_price_huf;
      $('setAllergy').value = settings.guest_notice_allergy || '';
      $('setRushNotice').value = settings.guest_notice_rush || '';
      $('setPickupHelp').value = settings.pickup_help_text || '';
      $('setRushWarning').value = settings.rush_warning_text || '';
      $('setRushSummary').value = settings.rush_summary_text || '';
      $('setMondayMsg').value = settings.monday_block_message || '';
      $('setPlaceholder').value = settings.placeholder_image_url || '';
      updatePlaceholderPreview();
      syncRushHelper();
      state.slots = slotsRes.data || [];
      state.blackouts = blackoutRes.data || [];
      renderSlots();
      renderBlackouts();
      $('settingsState').hidden = true;
      $('settingsContent').hidden = false;
    } catch (error) {
      if ($('settingsContent').hidden) {
        $('settingsState').hidden = false;
        $('settingsState').replaceChildren(messageCard('Nem sikerült betölteni a szabályokat.', 'Próbáld újra.', loadSettings));
      } else toastLoadError(error);
    }
  }

  async function loadSlotsAndBlackouts() {
    try {
      const [slotsRes, blackoutRes] = await Promise.all([
        client().from('pickup_slots').select('*').order('weekday').order('sort_order'),
        client().from('blackout_ranges').select('*').order('starts_on')
      ]);
      if (slotsRes.error || blackoutRes.error) throw slotsRes.error || blackoutRes.error;
      state.slots = slotsRes.data || [];
      state.blackouts = blackoutRes.data || [];
      renderSlots();
      renderBlackouts();
    } catch (error) {
      toastLoadError(error);
    }
  }

  async function saveSettings(payload, button) {
    await withBusy(button, async () => {
      const { error } = await client().from('order_settings').update(payload).eq('id', 1);
      if (error) toastError(error);
      else toastOk('Módosítások mentve');
    });
  }

  async function deleteSlot(slot) {
    const ok = await confirmAction(
      'Biztosan törlöd a „' + (WEEKDAYS[slot.weekday] || '') + ' · ' + slot.label + '” idősávot?',
      'Ez a művelet nem vonható vissza.'
    );
    if (!ok) return;
    const { error } = await client().from('pickup_slots').delete().eq('id', slot.id);
    if (error) toastError(error);
    else { toastOk('Idősáv törölve'); await loadSlotsAndBlackouts(); }
  }

  async function deleteBlackout(range) {
    const ok = await confirmAction(
      'Biztosan törlöd ezt a zárolt időszakot?',
      formatDay(range.starts_on) + ' – ' + formatDay(range.ends_on) + '. Ez a művelet nem vonható vissza.'
    );
    if (!ok) return;
    const { error } = await client().from('blackout_ranges').delete().eq('id', range.id);
    if (error) toastError(error);
    else { toastOk('Időszak törölve'); await loadSlotsAndBlackouts(); }
  }

  let updateProductPreview = function () {};
  let updatePogacsaPreview = function () {};
  let updatePlaceholderPreview = function () {};

  function bind() {
    updateProductPreview = bindPreview('productImage', 'productPreview', 'productPreviewEmpty');
    updatePogacsaPreview = bindPreview('pogacsaImage', 'pogacsaPreview', 'pogacsaPreviewEmpty');
    updatePlaceholderPreview = bindPreview('setPlaceholder', 'placeholderPreview', 'placeholderPreviewEmpty');

    document.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        setTab(button.getAttribute('data-tab'));
        if (window.matchMedia('(max-width: 768px)').matches) $('content').focus();
      });
    });

    $('menuBtn').addEventListener('click', () => {
      if ($('sidebar').classList.contains('is-open')) closeNav();
      else openNav();
    });
    $('navBackdrop').addEventListener('click', () => closeNav());
    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) closeNav(false);
      syncSidebarInert();
    });

    $('loginForm').addEventListener('submit', (event) => {
      event.preventDefault();
      withBusy($('loginSubmit'), async () => {
        setLoginError('');
        const { data, error } = await client().auth.signInWithPassword({
          email: $('loginEmail').value.trim(),
          password: $('loginPassword').value
        });
        if (error) { setLoginError('Sikertelen belépés.'); return; }
        try {
          state.userEmail = data.session && data.session.user ? data.session.user.email || '' : '';
          await requireAdmin();
          showApp();
          await loadAll();
        } catch (err) {
          showLogin(err.message);
        }
      });
    });

    $('logoutBtn').addEventListener('click', async () => {
      if (confirmResolver) finishConfirm(false);
      $('drawerRoot').hidden = true;
      $('appView').inert = false;
      $('appView').removeAttribute('aria-hidden');
      state.drawerPanel = '';
      state.returnFocus = null;
      syncScrollLock();
      await client().auth.signOut();
      $('loginPassword').value = '';
      closeNav(false);
      showLogin('');
    });

    ['searchBox', 'statusFilter', 'dateFilter', 'paidFilter'].forEach((id) => {
      $(id).addEventListener('input', applyFilters);
      $(id).addEventListener('change', applyFilters);
    });
    $('sortSelect').addEventListener('change', () => {
      const parts = $('sortSelect').value.split(':');
      state.sortKey = parts[0];
      state.sortDir = parts[1] || 'asc';
      applyFilters();
    });
    $('clearFilters').addEventListener('click', () => {
      $('searchBox').value = '';
      $('statusFilter').value = '';
      $('dateFilter').value = '';
      $('paidFilter').value = '';
      applyFilters();
      $('searchBox').focus();
    });
    document.querySelector('.orders-table thead').addEventListener('click', (event) => {
      const button = event.target.closest('[data-sort]');
      if (!button) return;
      const key = button.getAttribute('data-sort');
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = key; state.sortDir = 'asc'; }
      applyFilters();
    });
    $('ordersBody').addEventListener('click', openOrderFrom);
    $('ordersCards').addEventListener('click', openOrderFrom);
    $('ordersBody').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('tr[data-open-order]');
      if (!row || event.target !== row) return;
      event.preventDefault();
      openOrderFrom(event);
    });

    $('editItems').addEventListener('input', (event) => {
      const index = Number(event.target.getAttribute('data-index'));
      const field = event.target.getAttribute('data-item');
      if (!field || !state.editingItems[index]) return;
      state.editingItems[index][field] = event.target.value;
    });
    $('editStatus').addEventListener('change', () => {
      const select = $('editStatus');
      const id = $('editId').value;
      const previous = select.dataset.prev || select.value;
      if (!id || select.value === previous) return;
      patchOrder(id, { status: select.value }, select, previous, 'Státusz frissítve');
    });
    $('editPaid').addEventListener('change', () => {
      const select = $('editPaid');
      const id = $('editId').value;
      const previous = select.dataset.prev || select.value;
      if (!id || select.value === previous) return;
      patchOrder(id, { paid: select.value === 'true' }, select, previous, 'Fizetés státusz frissítve');
    });
    $('editRush').addEventListener('change', refreshOrderMeta);
    $('orderForm').addEventListener('submit', (event) => {
      event.preventDefault();
      withBusy(event.submitter || $('drawerSave'), saveOrder);
    });

    $('productAdd').addEventListener('click', () => openProduct(null));
    $('productList').addEventListener('click', (event) => {
      handleMove(event, 'products', state.products, loadProducts);
      const edit = event.target.closest('[data-edit-product]');
      if (!edit) return;
      const product = state.products.find((item) => item.id === edit.getAttribute('data-edit-product'));
      if (product) openProduct(product);
    });
    $('productForm').addEventListener('submit', (event) => {
      event.preventDefault();
      withBusy(event.submitter || $('drawerSave'), saveProduct);
    });

    $('pogacsaAdd').addEventListener('click', () => openPogacsa(null));
    $('pogacsaList').addEventListener('click', (event) => {
      handleMove(event, 'pogacsa_products', state.pogacsa, loadPogacsa);
      const edit = event.target.closest('[data-edit-pogacsa]');
      if (!edit) return;
      const row = state.pogacsa.find((item) => item.id === edit.getAttribute('data-edit-pogacsa'));
      if (row) openPogacsa(row);
    });
    $('pogacsaForm').addEventListener('submit', (event) => {
      event.preventDefault();
      withBusy(event.submitter || $('drawerSave'), savePogacsa);
    });

    $('hoursAdd').addEventListener('click', () => openHours(null));
    $('hoursList').addEventListener('click', (event) => {
      handleMove(event, 'opening_hours', state.hours, loadHours);
      const edit = event.target.closest('[data-edit-hours]');
      if (!edit) return;
      const row = state.hours.find((item) => item.id === edit.getAttribute('data-edit-hours'));
      if (row) openHours(row);
    });
    $('hoursForm').addEventListener('submit', (event) => {
      event.preventDefault();
      withBusy(event.submitter || $('drawerSave'), saveHours);
    });
    $('openingNoticeSave').addEventListener('click', () => {
      saveSettings({ opening_notice: $('openingNotice').value }, $('openingNoticeSave'));
    });

    $('extrasAdd').addEventListener('click', () => openExtra(null));
    $('extrasList').addEventListener('click', (event) => {
      handleMove(event, 'homepage_extras', state.extras, loadExtras);
      const edit = event.target.closest('[data-edit-extra]');
      if (!edit) return;
      const row = state.extras.find((item) => item.id === edit.getAttribute('data-edit-extra'));
      if (row) openExtra(row);
    });
    $('extraForm').addEventListener('submit', (event) => {
      event.preventDefault();
      withBusy(event.submitter || $('drawerSave'), saveExtra);
    });

    $('drawerDelete').addEventListener('click', () => {
      if (state.drawerPanel === 'product') deleteProduct();
      else if (state.drawerPanel === 'pogacsa') deletePogacsa();
      else if (state.drawerPanel === 'hours') deleteHours();
      else if (state.drawerPanel === 'extra') deleteExtra();
    });

    document.addEventListener('click', (event) => {
      if (!$('confirmRoot').hidden) return;
      if (event.target.closest('[data-close-drawer]')) closeDrawer();
    });

    $('leadForm').addEventListener('submit', (event) => {
      event.preventDefault();
      saveSettings({
        min_lead_days: Number($('setLead').value),
        rush_within_days: Number($('setRushDays').value),
        block_cakes_on_monday: $('setMonday').checked
      }, event.submitter);
    });
    $('rushForm').addEventListener('submit', (event) => {
      event.preventDefault();
      saveSettings({
        rush_surcharge_huf: $('setRushFee').value === '' ? null : Number($('setRushFee').value),
        charge_rush_surcharge: $('setChargeRush').checked
      }, event.submitter);
    });
    $('setChargeRush').addEventListener('change', syncRushHelper);
    $('priceForm').addEventListener('submit', (event) => {
      event.preventDefault();
      saveSettings({
        candle_unit_price_huf: Number($('setCandle').value) || 0,
        box_price_huf: Number($('setBox').value) || 0,
        firework_price_huf: Number($('setFirework').value) || 0
      }, event.submitter);
    });
    $('placeholderForm').addEventListener('submit', (event) => {
      event.preventDefault();
      saveSettings({ placeholder_image_url: $('setPlaceholder').value.trim() }, event.submitter);
    });
    document.querySelectorAll('[data-save-setting]').forEach((button) => {
      button.addEventListener('click', () => {
        const column = button.getAttribute('data-save-setting');
        if (!TEXT_COLUMNS.has(column)) return;
        const payload = {};
        payload[column] = $(button.getAttribute('data-field')).value;
        saveSettings(payload, button);
      });
    });
    document.querySelectorAll('[data-accordion]').forEach((button) => {
      button.addEventListener('click', () => {
        const panel = document.getElementById(button.getAttribute('aria-controls'));
        const willOpen = button.getAttribute('aria-expanded') !== 'true';
        document.querySelectorAll('[data-accordion]').forEach((other) => {
          const otherPanel = document.getElementById(other.getAttribute('aria-controls'));
          other.setAttribute('aria-expanded', 'false');
          if (otherPanel) otherPanel.hidden = true;
        });
        if (willOpen && panel) {
          button.setAttribute('aria-expanded', 'true');
          panel.hidden = false;
          const area = panel.querySelector('textarea');
          if (area) area.focus();
        }
      });
    });

    $('slotAddOpen').addEventListener('click', () => {
      $('slotLabel').value = '';
      openDrawer({ title: 'Új idősáv', kicker: 'Átvétel', panel: 'slot', formId: 'slotForm', deletable: false });
    });
    $('slotForm').addEventListener('submit', (event) => {
      event.preventDefault();
      withBusy(event.submitter || $('drawerSave'), async () => {
        const label = $('slotLabel').value.trim();
        if (!label) return;
        const { error } = await client().from('pickup_slots').insert({
          weekday: Number($('slotWeekday').value),
          label: label,
          sort_order: 10
        });
        if (error) { toastError(error); return; }
        closeDrawer();
        toastOk('Idősáv mentve');
        await loadSlotsAndBlackouts();
      });
    });
    $('slotsList').addEventListener('click', (event) => {
      const button = event.target.closest('[data-delete-slot]');
      if (!button) return;
      const slot = state.slots.find((item) => item.id === button.getAttribute('data-delete-slot'));
      if (slot) deleteSlot(slot);
    });

    $('blackoutAddOpen').addEventListener('click', () => {
      $('blackoutStart').value = '';
      $('blackoutEnd').value = '';
      $('blackoutMessage').value = '';
      $('blackoutCakes').checked = true;
      openDrawer({ title: 'Új zárolt időszak', kicker: 'Átvétel', panel: 'blackout', formId: 'blackoutForm', deletable: false });
    });
    $('blackoutForm').addEventListener('submit', (event) => {
      event.preventDefault();
      withBusy(event.submitter || $('drawerSave'), async () => {
        const { error } = await client().from('blackout_ranges').insert({
          starts_on: $('blackoutStart').value,
          ends_on: $('blackoutEnd').value,
          blocks_cakes_only: $('blackoutCakes').checked,
          message: $('blackoutMessage').value.trim()
        });
        if (error) { toastError(error); return; }
        closeDrawer();
        toastOk('Időszak mentve');
        await loadSlotsAndBlackouts();
      });
    });
    $('blackoutList').addEventListener('click', (event) => {
      const button = event.target.closest('[data-delete-blackout]');
      if (!button) return;
      const range = state.blackouts.find((item) => item.id === button.getAttribute('data-delete-blackout'));
      if (range) deleteBlackout(range);
    });

    $('confirmCancel').addEventListener('click', () => finishConfirm(false));
    $('confirmOk').addEventListener('click', () => finishConfirm(true));
    $('confirmRoot').addEventListener('click', (event) => {
      if (event.target.closest('[data-confirm="cancel"]')) finishConfirm(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (!$('confirmRoot').hidden) { finishConfirm(false); return; }
        if (!$('drawerRoot').hidden) { closeDrawer(); return; }
        if ($('sidebar').classList.contains('is-open')) closeNav();
        return;
      }
      if (event.key !== 'Tab') return;
      if (!$('confirmRoot').hidden) trapFocus($('confirmRoot').querySelector('.modal'), event);
      else if (!$('drawerRoot').hidden) trapFocus($('drawer'), event);
      else if ($('sidebar').classList.contains('is-open') && window.matchMedia('(max-width: 768px)').matches) {
        trapFocus($('sidebar'), event);
      }
    });
  }

  async function loadAll() {
    fillWeekdays();
    await Promise.all([loadOrders(), loadProducts(), loadPogacsa(), loadExtras(), loadHours(), loadSettings()]);
  }

  async function boot() {
    bind();
    try {
      const { data, error } = await client().auth.getSession();
      if (error || !data.session) {
        showLogin('');
        return;
      }
      state.userEmail = data.session.user ? data.session.user.email || '' : '';
      await requireAdmin();
      showApp();
      await loadAll();
    } catch (error) {
      showLogin(error && error.message ? error.message : 'Sikertelen belépés.');
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
