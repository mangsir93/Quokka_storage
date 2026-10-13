/* Presentation only: tabs, focus management and list sizing. No database access. */
(() => {
  'use strict';
  const today = document.getElementById('today');
  if (today) {
    today.textContent = new Intl.DateTimeFormat('ko-KR', {month:'numeric',day:'numeric',weekday:'short'}).format(new Date());
    today.dateTime = new Date().toISOString();
    if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', {scope:'./'}).catch(() => {}));
  }
  const tabs = [...document.querySelectorAll('.q-ops-tabs [role="tab"]')];
  const activate = tab => {
    tabs.forEach(button => {
      const active = button === tab;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(button.getAttribute('aria-controls'));
      if (panel) panel.hidden = !active;
    });
    requestAnimationFrame(fitLists);
  };
  tabs.forEach(tab => tab.addEventListener('click', () => activate(tab)));
  const tablist = document.querySelector('.q-ops-tabs');
  tablist?.addEventListener('keydown', event => {
    const index = tabs.indexOf(event.target);
    if (index < 0 || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    activate(tabs[next]); tabs[next].focus();
  });
  // Keep every record in the DOM; cap the visible list at five rows in dashboards.
  let frame = 0;
  function fitLists() {
    document.querySelectorAll('.q-operations .list, .q-member .members').forEach(list => {
      if (!list.getClientRects().length) return;
      const children = [...list.children].filter(el => !el.classList.contains('empty'));
      const count = list.classList.contains('members') ? 10 : 5;
      list.style.maxHeight = children.length > count
        ? Math.ceil(children[count-1].getBoundingClientRect().bottom - list.getBoundingClientRect().top + list.scrollTop) + 'px'
        : 'none';
    });
  }
  const scheduleFit = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fitLists); };
  const app = document.getElementById('app');
  if (app) new MutationObserver(scheduleFit).observe(app, {childList:true,subtree:true});
  window.addEventListener('resize', scheduleFit);
  document.addEventListener('toggle', scheduleFit, true);
  document.fonts?.ready.then(scheduleFit);
  // Focus never escapes a visible dialog; return focus when it closes.
  let currentModal = null, previousFocus = null;
  const modals = [...document.querySelectorAll('.modal')];
  function syncDialog() {
    const open = modals.find(modal => !modal.classList.contains('hide')) || null;
    if (open === currentModal) return;
    if (open) {
      if (!currentModal) previousFocus = document.activeElement;
      currentModal = open;
      const sheet = open.querySelector('.sheet');
      if (sheet) { sheet.tabIndex = -1; sheet.focus({preventScroll:true}); }
    } else {
      currentModal = null;

    }
    document.querySelectorAll('.wrap,.app-header,.bottom').forEach(el => { el.inert = !!open; });
    document.body.style.overflow = open ? 'hidden' : '';
    if (!open && previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
  }
  modals.forEach(modal => new MutationObserver(syncDialog).observe(modal, {attributes:true,attributeFilter:['class']}));
  document.addEventListener('keydown', event => {
    if (!currentModal) return;
    if (event.key === 'Escape') {
      event.preventDefault(); currentModal.classList.add('hide'); return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...currentModal.querySelectorAll('button:not(:disabled),input:not([type="hidden"]):not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')].filter(el => el.getClientRects().length);
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0], last = focusable[focusable.length-1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === currentModal.querySelector('.sheet'))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
})();
