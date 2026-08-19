"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createId = void 0;
const crypto_1 = require("crypto");
const createId = () => (0, crypto_1.randomUUID)();
exports.createId = createId;
//# sourceMappingURL=id.js.map