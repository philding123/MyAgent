'use strict';
// F35 native menu (design/31-menu.md), restructured in Phase 7 to the wb
// v5.8.2 band order (编辑/窗口/帮助/关于 — design/33). The in-DOM band labels
// pop these native sections; actions ride the rpc:event envelope.

const { Menu } = require('electron');
const pkg = require('../../package.json');

function buildMenu({ sendToMain, openManual }) {
  const act = (action) => () => sendToMain({ topic: 'menu:action', payload: { action } });
  const sections = {
    edit: {
      label: '编辑(E)',
      submenu: [
        { id: 'new-session', label: '新建任务', accelerator: 'CmdOrCtrl+N', click: act('new-session') },
        { id: 'open-settings', label: '打开设置', accelerator: 'CmdOrCtrl+,', click: act('open-settings') },
        { type: 'separator' },
        { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    window: {
      label: '窗口(W)',
      submenu: [
        { id: 'open-search', label: '全局搜索', accelerator: 'CmdOrCtrl+Shift+F', click: act('open-search') },
        { type: 'separator' },
        // role 'zoom' is macOS-only (no-op on Windows/Linux) — toggle maximize
        { role: 'minimize', label: '最小化' }, { id: 'toggle-maximize', label: '最大化/还原', click: (_i, w) => {
          if (w) { w.isMaximized() ? w.unmaximize() : w.maximize(); }
        } }, { role: 'close', label: '关闭' },
      ],
    },
    help: {
      label: '帮助(H)',
      submenu: [{ id: 'open-manual', label: '使用手册（README）', click: () => openManual && openManual() }],
    },
    about: {
      label: '关于(A)',
      submenu: [
        { label: 'MyAgent — WorkBuddy 个人复刻', enabled: false },
        { label: '版本 ' + pkg.version, enabled: false },
      ],
    },
  };
  const menu = Menu.buildFromTemplate(Object.values(sections));
  Menu.setApplicationMenu(menu);
  // band label → that section's items directly (not a one-entry menu whose
  // only item is the section again); returns the labels for the audit
  function popSection(name, win) {
    const s = sections[name];
    if (!s || !win || win.isDestroyed()) return null;
    const m = Menu.buildFromTemplate(s.submenu);
    if (!process.env.MYAGENT_TEST_SEAMS) m.popup({ window: win });
    return { section: name, items: m.items.filter((i) => i.type !== 'separator').map((i) => ({ id: i.id || i.role || null, label: i.label, enabled: i.enabled })) };
  }
  // test seam: fire a section item's click exactly as a user click would
  function clickItem(name, id, win) {
    const s = sections[name];
    const item = s && Menu.buildFromTemplate(s.submenu).getMenuItemById(id);
    if (!item) return false;
    item.click(undefined, win, undefined);
    return true;
  }
  return { menu, popSection, clickItem };
}

module.exports = { buildMenu };
