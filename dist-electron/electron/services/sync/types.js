"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncError = exports.SYNC_PRODUCT_SCHEMA_VERSION = exports.SYNC_PRODUCT_ID = exports.SYNC_PROTOCOL_VERSION = exports.SYNC_FORMAT = void 0;
exports.SYNC_FORMAT = 'stoicsoft-sync';
exports.SYNC_PROTOCOL_VERSION = 1;
exports.SYNC_PRODUCT_ID = '1marketingtool';
exports.SYNC_PRODUCT_SCHEMA_VERSION = 1;
class SyncError extends Error {
    code;
    constructor(code, message) {
        super(message ?? code);
        this.name = 'SyncError';
        this.code = code;
    }
}
exports.SyncError = SyncError;
//# sourceMappingURL=types.js.map