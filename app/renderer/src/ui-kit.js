// F60 shared renderer UI primitives (design/44 §6). uiConfirm replaces the
// native window.confirm(): same yes/no contract, but an in-page dialog that
// follows the app theme. Enter confirms, Esc / backdrop click cancels.

/**
 * @param {{title:string, body?:string, okText?:string, cancelText?:string, danger?:boolean}} opts
 * @returns {Promise<boolean>}
 */
export function uiConfirm({ title, body = '', okText = '确定', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'ui-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'ui-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    const h = document.createElement('h3');
    h.textContent = title;
    dialog.appendChild(h);
    if (body) {
      const p = document.createElement('p');
      p.textContent = body;
      dialog.appendChild(p);
    }
    const actions = document.createElement('div');
    actions.className = 'ui-dialog-actions';
    const cancel = document.createElement('button');
    cancel.className = 'ui-dialog-cancel';
    cancel.textContent = cancelText;
    const ok = document.createElement('button');
    ok.className = 'ui-dialog-ok ' + (danger ? 'danger-primary' : 'primary');
    ok.textContent = okText;
    actions.append(cancel, ok);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);

    const prevFocus = document.activeElement;
    const done = (value) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
    };
    cancel.onclick = () => done(false);
    ok.onclick = () => done(true);
    backdrop.onclick = (e) => { if (e.target === backdrop) done(false); };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    (danger ? cancel : ok).focus();
  });
}
