"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assetService = exports.AssetService = exports.ASSET_EXTENSIONS = void 0;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const url_1 = require("url");
const yazl_1 = __importDefault(require("yazl"));
const AppRepository_1 = require("./AppRepository");
const id_1 = require("../utils/id");
const userDataPath_1 = require("../utils/userDataPath");
const KIND_BY_EXT = {
    // images
    '.apng': 'image', '.avif': 'image', '.gif': 'image', '.jpeg': 'image', '.jpg': 'image',
    '.png': 'image', '.svg': 'image', '.webp': 'image', '.bmp': 'image', '.ico': 'image',
    // video
    '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.m4v': 'video', '.avi': 'video', '.mkv': 'video',
    // audio
    '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.aac': 'audio', '.ogg': 'audio', '.flac': 'audio',
    // documents
    '.pdf': 'document', '.md': 'document', '.mdx': 'document', '.txt': 'document', '.csv': 'document',
    '.doc': 'document', '.docx': 'document', '.xls': 'document', '.xlsx': 'document',
    '.ppt': 'document', '.pptx': 'document', '.json': 'document', '.rtf': 'document',
};
const MIME_BY_EXT = {
    '.apng': 'image/apng', '.avif': 'image/avif', '.gif': 'image/gif', '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
    '.bmp': 'image/bmp', '.ico': 'image/x-icon',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
    '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.ogg': 'audio/ogg', '.flac': 'audio/flac',
    '.pdf': 'application/pdf', '.md': 'text/markdown', '.mdx': 'text/markdown', '.txt': 'text/plain',
    '.csv': 'text/csv', '.json': 'application/json', '.rtf': 'application/rtf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
/** All extensions the asset library understands, used to build the file picker filter. */
exports.ASSET_EXTENSIONS = Object.keys(KIND_BY_EXT).map((ext) => ext.slice(1));
function detectKind(ext) {
    return KIND_BY_EXT[ext.toLowerCase()] ?? 'other';
}
function detectMime(ext) {
    return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream';
}
const EXT_BY_MIME = Object.entries(MIME_BY_EXT).reduce((map, [ext, mime]) => {
    if (!map[mime])
        map[mime] = ext;
    return map;
}, {});
/** Derive a filename with a kind-detectable extension for a downloaded URL. */
function remoteAssetName(url, mimeType) {
    const mimeExt = EXT_BY_MIME[mimeType.split(';')[0].trim().toLowerCase()] ?? '';
    try {
        const base = path_1.default.basename(decodeURIComponent(new URL(url).pathname));
        if (base && KIND_BY_EXT[path_1.default.extname(base).toLowerCase()])
            return base;
        if (base)
            return `${base}${mimeExt || '.bin'}`;
    }
    catch {
        // fall through to a generic name
    }
    return `download${mimeExt || '.bin'}`;
}
function sanitizeName(name) {
    return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
}
function uniqueArchiveFileName(name, usedNames) {
    const safeName = path_1.default.basename(name);
    const extension = path_1.default.extname(safeName);
    const base = path_1.default.basename(safeName, extension) || 'media';
    let candidate = safeName;
    let suffix = 2;
    while (usedNames.has(candidate.toLowerCase())) {
        candidate = `${base}-${suffix}${extension}`;
        suffix += 1;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
}
function supportedExtension(name) {
    const extension = path_1.default.extname(name).toLowerCase();
    return KIND_BY_EXT[extension] ? extension : '';
}
function downloadFileName(asset) {
    const sourceName = asset.title?.trim() || asset.originalName || asset.id;
    const sourceExt = supportedExtension(sourceName);
    const mimeExt = EXT_BY_MIME[asset.mimeType.split(';')[0].trim().toLowerCase()] ?? '';
    const ext = sourceExt
        || supportedExtension(asset.originalName)
        || (asset.localPath ? supportedExtension(asset.localPath) : '')
        || mimeExt;
    const sourceBase = sourceExt ? path_1.default.basename(sourceName, path_1.default.extname(sourceName)) : sourceName;
    const base = sanitizeName(sourceBase).slice(0, 120).replace(/[.-]+$/g, '') || 'file';
    return `${base}${ext}`;
}
/** Resolve a renderer-supplied media reference (mt-local-file:// / file:// / absolute path) to an fs path. */
function resolveLocalFilePath(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    if (/^https?:\/\//i.test(trimmed))
        return null;
    if (/^mt-local-file:\/\//i.test(trimmed)) {
        return (0, url_1.fileURLToPath)(trimmed.replace(/^mt-local-file:\/\/(localhost)?/i, 'file://'));
    }
    if (/^file:\/\//i.test(trimmed))
        return (0, url_1.fileURLToPath)(trimmed);
    return trimmed;
}
function checksumFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto_1.default.createHash('sha256');
        const stream = fs_1.default.createReadStream(filePath);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}
class AssetService {
    /** Root folder for managed (copied-in) asset bytes, under the app data dir. */
    managedRoot() {
        const root = path_1.default.join((0, userDataPath_1.resolveUserDataPath)(), 'assets');
        fs_1.default.mkdirSync(root, { recursive: true });
        return root;
    }
    /** Import local files into the catalog. `managed` copies bytes into the library; otherwise links in place. */
    async importFiles(filePaths, options = {}) {
        const created = [];
        for (const sourcePath of filePaths) {
            const stats = await fs_1.default.promises.stat(sourcePath).catch(() => null);
            if (!stats || !stats.isFile())
                continue;
            const ext = path_1.default.extname(sourcePath);
            const originalName = path_1.default.basename(sourcePath);
            const kind = detectKind(ext);
            const mimeType = detectMime(ext);
            const checksum = await checksumFile(sourcePath).catch(() => null);
            let localPath = sourcePath;
            const managed = Boolean(options.managed);
            if (managed) {
                const scope = options.productId ?? 'shared';
                const folder = path_1.default.join(this.managedRoot(), scope, (0, id_1.createId)());
                fs_1.default.mkdirSync(folder, { recursive: true });
                const destination = path_1.default.join(folder, sanitizeName(originalName));
                await fs_1.default.promises.copyFile(sourcePath, destination);
                localPath = destination;
            }
            const asset = AppRepository_1.repository.createAsset({
                productId: options.productId ?? null,
                collectionId: options.collectionId ?? null,
                kind,
                mimeType,
                originalName,
                storage: 'local',
                managed,
                localPath,
                sizeBytes: stats.size,
                checksum,
                tags: options.tags ?? [],
            });
            created.push(asset);
        }
        return created;
    }
    /**
     * Persist raw bytes (a rendered design, a generated image) as a managed asset.
     * Always copies into the managed library; the caller owns naming and metadata.
     */
    async importBytes(data, options) {
        const ext = path_1.default.extname(options.originalName);
        const kind = detectKind(ext);
        const mimeType = options.mimeType ?? detectMime(ext);
        const checksum = crypto_1.default.createHash('sha256').update(data).digest('hex');
        const scope = options.productId ?? 'shared';
        const folder = path_1.default.join(this.managedRoot(), scope, (0, id_1.createId)());
        fs_1.default.mkdirSync(folder, { recursive: true });
        const destination = path_1.default.join(folder, sanitizeName(options.originalName));
        await fs_1.default.promises.writeFile(destination, data);
        return AppRepository_1.repository.createAsset({
            productId: options.productId ?? null,
            collectionId: options.collectionId ?? null,
            kind,
            mimeType,
            originalName: options.originalName,
            title: options.title ?? null,
            storage: 'local',
            managed: true,
            localPath: destination,
            sizeBytes: data.length,
            checksum,
            tags: options.tags ?? [],
            metadata: options.metadata ?? {},
        });
    }
    /** Read a managed/linked asset's bytes (for inlining into a render or re-uploading). */
    async readBytes(id) {
        const asset = AppRepository_1.repository.getAssetById(id);
        if (!asset?.localPath || !fs_1.default.existsSync(asset.localPath))
            return null;
        const data = await fs_1.default.promises.readFile(asset.localPath);
        return { data, mimeType: asset.mimeType };
    }
    async dataUrl(id) {
        const asset = AppRepository_1.repository.getAssetById(id);
        if (!asset?.localPath || !fs_1.default.existsSync(asset.localPath))
            return null;
        const data = await fs_1.default.promises.readFile(asset.localPath);
        return {
            dataUrl: `data:${asset.mimeType};base64,${data.toString('base64')}`,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes ?? data.length,
        };
    }
    downloadInfo(id) {
        const asset = AppRepository_1.repository.getAssetById(id);
        if (!asset) {
            throw new Error('Asset not found.');
        }
        if (!asset.localPath) {
            throw new Error('This asset is not available as a local file.');
        }
        const sourcePath = path_1.default.resolve(asset.localPath);
        if (!fs_1.default.existsSync(sourcePath)) {
            throw new Error('The asset file is missing from disk.');
        }
        return {
            sourcePath,
            defaultName: downloadFileName(asset),
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
        };
    }
    /**
     * Download info for a raw media reference (not catalogued as an Asset) — e.g. the postMedia path
     * attached to a campaign piece. Resolves the local path and derives a sensible default filename.
     */
    downloadInfoForPath(rawPath, fallbackName) {
        const resolved = resolveLocalFilePath(rawPath);
        if (!resolved) {
            throw new Error('This media is not available as a local file.');
        }
        const sourcePath = path_1.default.resolve(resolved);
        if (!fs_1.default.existsSync(sourcePath)) {
            throw new Error('The media file is missing from disk.');
        }
        const sourceExt = path_1.default.extname(sourcePath);
        const nameSource = fallbackName?.trim() || path_1.default.basename(sourcePath);
        const nameHasExt = Boolean(supportedExtension(nameSource));
        const base = sanitizeName(nameHasExt ? path_1.default.basename(nameSource, path_1.default.extname(nameSource)) : nameSource)
            .slice(0, 120)
            .replace(/[.-]+$/g, '') || 'download';
        const ext = nameHasExt ? path_1.default.extname(nameSource) : sourceExt;
        return {
            sourcePath,
            defaultName: `${base}${ext}`,
            mimeType: detectMime(sourceExt),
        };
    }
    prepareDownloadArchive(items) {
        if (!Array.isArray(items) || !items.length) {
            throw new Error('Add at least one media file to the archive.');
        }
        if (items.length > 100) {
            throw new Error('A media archive can contain at most 100 files.');
        }
        const entries = [];
        const usedNames = new Set();
        const usedPaths = new Set();
        for (const item of items) {
            if (!item || typeof item.path !== 'string' || !item.path.trim()) {
                throw new Error('The media archive contains an invalid file reference.');
            }
            const info = this.downloadInfoForPath(item.path, typeof item.defaultName === 'string' ? item.defaultName : undefined);
            const pathKey = process.platform === 'win32' ? info.sourcePath.toLowerCase() : info.sourcePath;
            if (usedPaths.has(pathKey))
                continue;
            usedPaths.add(pathKey);
            entries.push({
                sourcePath: info.sourcePath,
                archiveName: uniqueArchiveFileName(info.defaultName, usedNames),
            });
        }
        if (!entries.length) {
            throw new Error('No unique media files were available for the archive.');
        }
        return entries;
    }
    async writeDownloadArchive(entries, destinationPath) {
        const resolvedDestination = path_1.default.resolve(destinationPath);
        if (entries.some((entry) => path_1.default.resolve(entry.sourcePath) === resolvedDestination)) {
            throw new Error('Choose a different location for the ZIP archive.');
        }
        fs_1.default.mkdirSync(path_1.default.dirname(resolvedDestination), { recursive: true });
        const temporaryPath = path_1.default.join(path_1.default.dirname(resolvedDestination), `.${path_1.default.basename(resolvedDestination)}.${crypto_1.default.randomUUID()}.tmp`);
        const zip = new yazl_1.default.ZipFile();
        for (const entry of entries) {
            zip.addFile(entry.sourcePath, entry.archiveName);
        }
        zip.end();
        try {
            await new Promise((resolve, reject) => {
                const output = fs_1.default.createWriteStream(temporaryPath);
                let failure = null;
                zip.outputStream.once('error', (error) => {
                    failure ??= error;
                    output.destroy();
                });
                output.once('error', (error) => {
                    failure ??= error;
                    zip.outputStream.destroy();
                });
                output.on('close', () => {
                    if (failure)
                        reject(failure);
                    else
                        resolve();
                });
                zip.outputStream.pipe(output);
            });
            await fs_1.default.promises.rename(temporaryPath, resolvedDestination);
        }
        catch (error) {
            await fs_1.default.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
            throw error;
        }
        const stats = await fs_1.default.promises.stat(resolvedDestination).catch(() => null);
        return { filePath: resolvedDestination, sizeBytes: stats?.size ?? null };
    }
    async copyTo(id, destinationPath) {
        const info = this.downloadInfo(id);
        const resolvedDestination = path_1.default.resolve(destinationPath);
        fs_1.default.mkdirSync(path_1.default.dirname(resolvedDestination), { recursive: true });
        if (info.sourcePath !== resolvedDestination) {
            await fs_1.default.promises.copyFile(info.sourcePath, resolvedDestination);
        }
        const stats = await fs_1.default.promises.stat(resolvedDestination).catch(() => null);
        return { filePath: resolvedDestination, sizeBytes: stats?.size ?? info.sizeBytes };
    }
    /** Remove an asset from the catalog. When `removeBytes`, also delete the managed copy on disk. */
    async deleteAsset(id, removeBytes = false) {
        const asset = AppRepository_1.repository.getAssetById(id);
        if (!asset)
            return false;
        if (removeBytes && asset.managed && asset.localPath) {
            // Only delete bytes we own (the managed copy inside our library), never user-linked originals.
            const root = this.managedRoot();
            const resolved = path_1.default.resolve(asset.localPath);
            if (resolved.startsWith(path_1.default.resolve(root))) {
                await fs_1.default.promises.rm(path_1.default.dirname(resolved), { recursive: true, force: true }).catch(() => undefined);
            }
        }
        return AppRepository_1.repository.deleteAsset(id);
    }
    /** Resolve a renderer-usable preview URL: mt-local-file for local bytes, public URL for remote. */
    previewUrl(id) {
        const asset = AppRepository_1.repository.getAssetById(id);
        if (!asset)
            return { url: null };
        if (asset.localPath && fs_1.default.existsSync(asset.localPath)) {
            // Explicit `localhost` host: the standard mt-local-file scheme otherwise swallows
            // the first path segment as the host (file:///Users/... -> host "users"), which
            // breaks fileURLToPath in the protocol handler. See previewAssetUrl in helpers.ts.
            return { url: (0, url_1.pathToFileURL)(asset.localPath).toString().replace(/^file:\/\//i, 'mt-local-file://localhost') };
        }
        if (asset.publicUrl) {
            return { url: asset.publicUrl };
        }
        return { url: null };
    }
    /** Download a remote http(s) URL and store its bytes as a managed asset (e.g. a found source image/video). */
    async importFromUrl(url, options = {}) {
        if (!/^https?:\/\//i.test(url.trim())) {
            throw new Error('Only http(s) media can be saved to the library.');
        }
        const MAX_BYTES = 200 * 1024 * 1024;
        const response = await fetch(url, { headers: { Accept: 'image/*,video/*;q=0.9,*/*;q=0.5' } });
        if (!response.ok) {
            throw new Error(`Could not download the file (${response.status}).`);
        }
        const declaredLength = Number(response.headers.get('content-length') ?? '');
        if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
            throw new Error('That file is too large to save to the library.');
        }
        const data = Buffer.from(await response.arrayBuffer());
        if (!data.length)
            throw new Error('The downloaded file was empty.');
        if (data.length > MAX_BYTES)
            throw new Error('That file is too large to save to the library.');
        const headerMime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
        const originalName = remoteAssetName(url, headerMime);
        const mimeType = headerMime || detectMime(path_1.default.extname(originalName));
        return this.importBytes(data, {
            originalName,
            mimeType,
            productId: options.productId ?? null,
            collectionId: options.collectionId ?? null,
            title: options.title ?? null,
            tags: options.tags ?? [],
            metadata: { source: 'url-import', sourceUrl: url, ...(options.metadata ?? {}) },
        });
    }
}
exports.AssetService = AssetService;
exports.assetService = new AssetService();
//# sourceMappingURL=AssetService.js.map