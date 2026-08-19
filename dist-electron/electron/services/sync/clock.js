"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HybridLogicalClock = void 0;
exports.compareClocks = compareClocks;
exports.clocksEqual = clocksEqual;
function compareClocks(left, right) {
    if (left.wall !== right.wall)
        return left.wall < right.wall ? -1 : 1;
    if (left.counter !== right.counter)
        return left.counter < right.counter ? -1 : 1;
    return left.deviceId.localeCompare(right.deviceId);
}
function clocksEqual(left, right) {
    if (!left || !right)
        return left === right;
    return left.wall === right.wall && left.counter === right.counter && left.deviceId === right.deviceId;
}
class HybridLogicalClock {
    wall;
    counter;
    deviceId;
    constructor(wall, counter, deviceId) {
        this.wall = wall;
        this.counter = counter;
        this.deviceId = deviceId;
    }
    next(candidateWall = Date.now()) {
        const normalizedWall = Math.max(0, Math.floor(candidateWall));
        if (normalizedWall > this.wall) {
            this.wall = normalizedWall;
            this.counter = 0;
        }
        else {
            this.counter += 1;
        }
        return { wall: this.wall, counter: this.counter, deviceId: this.deviceId };
    }
    observe(clock) {
        if (clock.wall > this.wall) {
            this.wall = clock.wall;
            this.counter = clock.counter;
        }
        else if (clock.wall === this.wall && clock.counter > this.counter) {
            this.counter = clock.counter;
        }
    }
    snapshot() {
        return { wall: this.wall, counter: this.counter };
    }
}
exports.HybridLogicalClock = HybridLogicalClock;
//# sourceMappingURL=clock.js.map