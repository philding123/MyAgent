'use strict';
// F35 native menu minimal surface (design/31-menu.md). wb counterpart:
// main/menu-builder.js (buildAndSetApplicationMenu, dynamic per-user items).
// Actions are delegated to the renderer over the existing rpc:event envelope.

const { Menu } = require('electron');

function buildMenu({ sendToMain }) {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          id: 'new-session',
          label: '新建任务',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToMain({ topic: 'menu:action', payload: { action: 'new-session' } }),
        },
        {
          id: 'open-settings',
          label: '打开设置',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendToMain({ topic: 'menu:action', payload: { action: 'open-settings' } }),
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    { role: 'editMenu', label: '编辑' },
    { role: 'viewMenu', label: '视图' },
    {
      label: '帮助',
      submenu: [
        {
          id: 'open-search',
          label: '全局搜索',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => sendToMain({ topic: 'menu:action', payload: { action: 'open-search' } }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
