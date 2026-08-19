"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.daysAgo = exports.isoDay = exports.now = void 0;
const now = () => Date.now();
exports.now = now;
const isoDay = (date = new Date()) => {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
};
exports.isoDay = isoDay;
const daysAgo = (days) => {
    return Date.now() - days * 24 * 60 * 60 * 1000;
};
exports.daysAgo = daysAgo;
//# sourceMappingURL=time.js.map