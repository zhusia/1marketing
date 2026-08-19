"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApplicationMenu = createApplicationMenu;
const electron_1 = require("electron");
const channels_1 = require("./ipc/channels");
const zoom_1 = require("./zoom");
const isMac = process.platform === 'darwin';
// Mirrors SETTINGS_TABS in src/components/app/views/settings/SettingsTabs.tsx.
// Keep these ids/labels in sync with that list.
const SETTINGS_SECTIONS = [
    { id: 'about', label: 'About' },
    { id: 'mcp', label: 'MCP' },
    { id: 'api', label: 'API' },
    { id: 'google', label: 'Google Account' },
    { id: 'storage', label: 'Storage' },
    { id: 'backup', label: 'Backup' },
    { id: 'layout', label: 'Layout' },
    { id: 'tracking', label: 'Tracking' },
    { id: 'license', label: 'License' },
];
function sendToRenderer(channel, payload) {
    const target = electron_1.BrowserWindow.getFocusedWindow() ?? electron_1.BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    if (target && !target.isDestroyed()) {
        target.webContents.send(channel, payload);
    }
}
function openSettings(tab) {
    sendToRenderer(channels_1.CHANNELS.MENU_OPEN_SETTINGS, tab ? { tab } : undefined);
}
function checkForUpdates() {
    sendToRenderer(channels_1.CHANNELS.MENU_OPEN_UPDATES);
}
function settingsSectionsSubmenu() {
    return [
        { label: 'All Settings...', accelerator: 'CmdOrCtrl+,', click: () => openSettings() },
        { type: 'separator' },
        ...SETTINGS_SECTIONS.map((section) => ({
            label: `${section.label}...`,
            click: () => openSettings(section.id),
        })),
    ];
}
function createApplicationMenu() {
    const template = [
        // App menu (macOS only) — labels like "Hide 1MarketingTool" / "Quit 1MarketingTool"
        // are filled in by Electron from app.name.
        ...(isMac
            ? [
                {
                    label: electron_1.app.name,
                    submenu: [
                        { role: 'about' },
                        { type: 'separator' },
                        { label: 'Check for Updates...', click: () => checkForUpdates() },
                        { type: 'separator' },
                        { label: 'Settings...', accelerator: 'CmdOrCtrl+,', click: () => openSettings() },
                        { label: 'Settings Sections', submenu: settingsSectionsSubmenu() },
                        { type: 'separator' },
                        { role: 'services' },
                        { type: 'separator' },
                        { role: 'hide' },
                        { role: 'hideOthers' },
                        { role: 'unhide' },
                        { type: 'separator' },
                        { role: 'quit' },
                    ],
                },
            ]
            : []),
        {
            label: 'File',
            submenu: [
                ...(!isMac
                    ? [
                        { label: 'Settings...', accelerator: 'CmdOrCtrl+,', click: () => openSettings() },
                        { label: 'Settings Sections', submenu: settingsSectionsSubmenu() },
                        { label: 'Check for Updates...', click: () => checkForUpdates() },
                        { type: 'separator' },
                    ]
                    : []),
                isMac ? { role: 'close' } : { role: 'quit' },
            ],
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'delete' },
                { type: 'separator' },
                { role: 'selectAll' },
            ],
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                // Custom instead of the built-in zoom roles so the status-bar zoom control
                // hears about every change (see electron/zoom.ts).
                { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => (0, zoom_1.resetZoomFactor)() },
                { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => (0, zoom_1.stepZoomFactor)(1) },
                // Same command under the un-shifted key, which is what most people actually press.
                { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', visible: false, click: () => (0, zoom_1.stepZoomFactor)(1) },
                { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => (0, zoom_1.stepZoomFactor)(-1) },
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                ...(isMac
                    ? [{ type: 'separator' }, { role: 'front' }]
                    : [{ role: 'close' }]),
            ],
        },
        {
            role: 'help',
            submenu: [
                { label: 'Learn More', click: () => void electron_1.shell.openExternal('https://stoicsoft.com') },
                { label: 'Report an Issue', click: () => void electron_1.shell.openExternal('https://stoicsoft.userjot.com/') },
            ],
        },
    ];
    electron_1.Menu.setApplicationMenu(electron_1.Menu.buildFromTemplate(template));
}
//# sourceMappingURL=menu.js.map