"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcpClient = void 0;
class AcpClient {
    child;
    handlers;
    nextId = 1;
    pending = new Map();
    buffer = '';
    closed = false;
    constructor(child, handlers = {}) {
        this.child = child;
        this.handlers = handlers;
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk) => this.onData(chunk));
        child.stderr?.on('data', (chunk) => this.handlers.onStderr?.(chunk));
        child.on('close', (code, signal) => {
            this.closed = true;
            this.rejectAll(new Error(`Agent process exited (${code ?? signal ?? 'unknown'}) before responding.`));
            this.handlers.onClose?.({ code, signal });
        });
        child.on('error', (err) => {
            this.closed = true;
            this.rejectAll(err);
        });
    }
    request(method, params, timeoutMs = 30_000) {
        if (this.closed)
            return Promise.reject(new Error('Agent process is not running.'));
        const id = this.nextId;
        this.nextId += 1;
        return new Promise((resolve, reject) => {
            const timer = timeoutMs > 0
                ? setTimeout(() => {
                    this.pending.delete(id);
                    reject(new Error(`ACP request "${method}" timed out after ${Math.round(timeoutMs / 1000)}s.`));
                }, timeoutMs)
                : null;
            this.pending.set(id, {
                resolve: (value) => resolve(value),
                reject,
                timer,
            });
            this.write({ jsonrpc: '2.0', id, method, params });
        });
    }
    notify(method, params) {
        if (this.closed)
            return;
        this.write({ jsonrpc: '2.0', method, params });
    }
    dispose() {
        this.closed = true;
        this.rejectAll(new Error('ACP client disposed.'));
    }
    write(message) {
        try {
            this.child.stdin?.write(`${JSON.stringify(message)}\n`);
        }
        catch {
            // stdin already closed; the close handler rejects pending requests.
        }
    }
    onData(chunk) {
        this.buffer += chunk;
        let index = this.buffer.indexOf('\n');
        while (index >= 0) {
            const line = this.buffer.slice(0, index).trim();
            this.buffer = this.buffer.slice(index + 1);
            if (line)
                this.onLine(line);
            index = this.buffer.indexOf('\n');
        }
    }
    onLine(line) {
        let message;
        try {
            message = JSON.parse(line);
        }
        catch {
            return;
        }
        if (message.id != null && message.method == null) {
            const pending = this.pending.get(Number(message.id));
            if (!pending)
                return;
            this.pending.delete(Number(message.id));
            if (pending.timer)
                clearTimeout(pending.timer);
            if (message.error) {
                const error = new Error(message.error.message || `ACP error ${message.error.code}`);
                error.code = message.error.code;
                error.data = message.error.data;
                pending.reject(error);
            }
            else {
                pending.resolve(message.result);
            }
            return;
        }
        if (message.method != null && message.id != null) {
            void this.handleIncomingRequest(message.id, message.method, (message.params ?? {}));
            return;
        }
        if (message.method === 'session/update') {
            this.handlers.onSessionUpdate?.((message.params ?? {}));
        }
    }
    async handleIncomingRequest(id, method, params) {
        if (!this.handlers.onRequest) {
            this.write({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not supported: ${method}` } });
            return;
        }
        try {
            const result = await this.handlers.onRequest(method, params);
            this.write({ jsonrpc: '2.0', id, result: result ?? {} });
        }
        catch (err) {
            this.write({
                jsonrpc: '2.0',
                id,
                error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
            });
        }
    }
    rejectAll(error) {
        for (const pending of this.pending.values()) {
            if (pending.timer)
                clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
    }
}
exports.AcpClient = AcpClient;
//# sourceMappingURL=acp-client.js.map