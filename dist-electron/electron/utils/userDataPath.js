"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveUserDataPath = resolveUserDataPath;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
// Keep in sync with build.productName in package.json.
const APP_DATA_DIR_NAME = '1MarketingTool';
function resolveUserDataPath() {
    const userDataArg = process.argv.find((value) => value.startsWith('--user-data-dir='));
    const override = process.env.ONE_MARKETING_TOOL_USER_DATA_DIR?.trim() ||
        userDataArg?.slice('--user-data-dir='.length).trim();
    // Resolve from appData rather than userData: appData does not depend on
    // app.setName()/ready timing or process.cwd(), so module-load-time callers
    // (AppRepository), dev, and packaged builds all get the same directory.
    const base = override ? path_1.default.resolve(override) : path_1.default.join(electron_1.app.getPath('appData'), APP_DATA_DIR_NAME);
    // Keep later service lookups aligned when the override arrived through the
    // command line before main.ts had a chance to mirror it into the environment.
    if (override)
        process.env.ONE_MARKETING_TOOL_USER_DATA_DIR = base;
    fs_1.default.mkdirSync(base, { recursive: true });
    return base;
}
//# sourceMappingURL=userDataPath.js.map