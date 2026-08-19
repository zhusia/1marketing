"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SOURCE_CHARS = exports.FILE_CATEGORY_EXTENSIONS = void 0;
exports.categoryForExtension = categoryForExtension;
exports.isMediaCategory = isMediaCategory;
exports.normalizeFileTypes = normalizeFileTypes;
exports.normalizeWatchFolders = normalizeWatchFolders;
exports.scanWatchedFolders = scanWatchedFolders;
exports.humanizeFileName = humanizeFileName;
exports.readFolderSource = readFolderSource;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const userDataPath_1 = require("../../utils/userDataPath");
/** Extensions grouped the way the config UI presents them. */
exports.FILE_CATEGORY_EXTENSIONS = {
    markdown: ['.md', '.mdx', '.markdown'],
    text: ['.txt', '.csv', '.json'],
    image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.heic'],
    video: ['.mp4', '.mov', '.m4v', '.webm'],
};
const MIME_BY_EXTENSION = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.heic': 'image/heic',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
    '.webm': 'video/webm',
};
/** Folders that are never marketing source material. */
const IGNORED_DIRECTORIES = new Set([
    '.git',
    'node_modules',
    '.next',
    'dist',
    'build',
    'out',
    'coverage',
    '.venv',
    '__pycache__',
    '.cache',
    '.idea',
    '.vscode',
]);
const MAX_DEPTH = 6;
const MAX_FILES_PER_SCAN = 2_000;
/** Files touched in the last few seconds may still be copying — pick them up on the next poll. */
const SETTLE_MS = 30_000;
const MAX_TEXT_BYTES = 512 * 1024;
/** How much of a text file is handed to the writer. */
exports.MAX_SOURCE_CHARS = 12_000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
function categoryForExtension(extension) {
    for (const [category, extensions] of Object.entries(exports.FILE_CATEGORY_EXTENSIONS)) {
        if (extensions.includes(extension))
            return category;
    }
    return 'other';
}
function isMediaCategory(category) {
    return category === 'image' || category === 'video';
}
/** Normalize user-entered file types to `.ext`, lower-case, de-duplicated. */
function normalizeFileTypes(values) {
    const list = Array.isArray(values) ? values : [];
    const normalized = [];
    for (const raw of list) {
        const value = String(raw ?? '').trim().toLowerCase().replace(/^\*/, '');
        if (!value)
            continue;
        const extension = value.startsWith('.') ? value : `.${value}`;
        if (!/^\.[a-z0-9]{1,12}$/.test(extension))
            continue;
        if (!normalized.includes(extension))
            normalized.push(extension);
    }
    return normalized;
}
function normalizeWatchFolders(values) {
    const list = Array.isArray(values) ? values : [];
    const folders = [];
    for (const raw of list) {
        if (!raw || typeof raw !== 'object')
            continue;
        const record = raw;
        const folderPath = typeof record.path === 'string' ? record.path.trim() : '';
        if (!folderPath || !path_1.default.isAbsolute(folderPath))
            continue;
        const resolved = path_1.default.resolve(folderPath);
        if (folders.some((folder) => folder.path === resolved))
            continue;
        folders.push({ path: resolved, recursive: record.recursive !== false });
    }
    return folders;
}
function fileSourceId(filePath) {
    return `file:${filePath}`;
}
/** One matched file, before the processed-state lookup. */
function toScannedFile(filePath, folder, stats) {
    const extension = path_1.default.extname(filePath).toLowerCase();
    return {
        id: fileSourceId(filePath),
        path: filePath,
        name: path_1.default.basename(filePath),
        extension,
        category: categoryForExtension(extension),
        sizeBytes: stats.size,
        modifiedAt: Math.round(stats.mtimeMs),
        folder,
        processed: false,
    };
}
function walkFolder(folder, extensions, into, options) {
    const stack = [{ dir: folder.path, depth: 0 }];
    while (stack.length) {
        const { dir, depth } = stack.pop();
        let entries;
        try {
            entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            // Unreadable subfolder (permissions, removed mid-scan) — skip it, keep scanning.
            continue;
        }
        for (const entry of entries) {
            if (into.length >= MAX_FILES_PER_SCAN)
                return;
            // Dotfiles are editor/OS bookkeeping, never source material.
            if (entry.name.startsWith('.'))
                continue;
            const entryPath = path_1.default.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!folder.recursive || depth >= MAX_DEPTH)
                    continue;
                if (IGNORED_DIRECTORIES.has(entry.name.toLowerCase()))
                    continue;
                stack.push({ dir: entryPath, depth: depth + 1 });
                continue;
            }
            if (!entry.isFile())
                continue;
            const extension = path_1.default.extname(entry.name).toLowerCase();
            if (!extensions.includes(extension))
                continue;
            let stats;
            try {
                stats = fs_1.default.statSync(entryPath);
            }
            catch {
                continue;
            }
            if (!stats.size)
                continue;
            into.push({
                file: toScannedFile(entryPath, folder.path, stats),
                // Still being written/copied — let it settle and pick it up on the next poll.
                settled: options.asOf - stats.mtimeMs >= SETTLE_MS,
            });
        }
    }
}
/**
 * Scan every watched folder and group the matches into sources (newest first).
 *
 * In `subfolder` mode each immediate subfolder of a watched folder becomes one source holding all
 * of its files (at any depth below it); files sitting loose in the watched folder itself stay one
 * source each. In `file` mode every file is its own source.
 */
function scanWatchedFolders(watchFolders, fileTypes, options) {
    const asOf = options?.asOf ?? Date.now();
    const groupMode = options?.groupMode === 'subfolder' ? 'subfolder' : 'file';
    const extensions = normalizeFileTypes(fileTypes);
    const entries = [];
    const folders = [];
    for (const folder of normalizeWatchFolders(watchFolders)) {
        let exists = false;
        let error = null;
        try {
            exists = fs_1.default.statSync(folder.path).isDirectory();
            if (!exists)
                error = 'Not a folder.';
        }
        catch {
            error = 'Folder not found — it may have been moved, renamed, or unmounted.';
        }
        if (exists && extensions.length)
            walkFolder(folder, extensions, entries, { asOf });
        folders.push({ path: folder.path, exists, matched: 0, error });
    }
    const sources = buildSources(entries, groupMode);
    sources.sort((a, b) => b.modifiedAt - a.modifiedAt);
    // Folder counts follow the same grouping so the preview matches what actually runs.
    let matchedFiles = 0;
    for (const source of sources)
        matchedFiles += source.files.length;
    for (const folder of folders) {
        folder.matched = folder.exists
            ? sources.reduce((total, source) => total + source.files.filter((file) => file.folder === folder.path).length, 0)
            : 0;
    }
    return { sources, matchedFiles, folders };
}
function fileSource(file) {
    return {
        id: file.id,
        kind: 'file',
        title: file.name,
        path: file.path,
        files: [file],
        fileCount: 1,
        sizeBytes: file.sizeBytes,
        modifiedAt: file.modifiedAt,
        processed: false,
    };
}
/** The immediate child folder of the watched root that owns this file, if any. */
function bundleRoot(file) {
    const relative = path_1.default.relative(file.folder, path_1.default.dirname(file.path));
    if (!relative || relative.startsWith('..'))
        return null;
    const [first] = relative.split(path_1.default.sep);
    return first ? path_1.default.join(file.folder, first) : null;
}
function buildSources(entries, groupMode) {
    if (groupMode !== 'subfolder') {
        const settled = dropConsumedSidecars(entries.filter((entry) => entry.settled).map((entry) => entry.file));
        return settled.map(fileSource);
    }
    const loose = [];
    const bundles = new Map();
    for (const entry of entries) {
        const root = bundleRoot(entry.file);
        if (!root) {
            loose.push(entry);
            continue;
        }
        const existing = bundles.get(root);
        if (existing)
            existing.push(entry);
        else
            bundles.set(root, [entry]);
    }
    const sources = dropConsumedSidecars(loose.filter((entry) => entry.settled).map((entry) => entry.file))
        .map(fileSource);
    for (const [root, group] of bundles) {
        // A bundle posts once, as a whole — so hold it back until every file in it has settled,
        // otherwise a folder still being copied would publish half of itself.
        if (group.some((entry) => !entry.settled))
            continue;
        const files = group.map((entry) => entry.file).sort((a, b) => a.path.localeCompare(b.path));
        sources.push({
            id: `group:${root}`,
            kind: 'subfolder',
            title: path_1.default.basename(root),
            path: root,
            files,
            fileCount: files.length,
            sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
            modifiedAt: files.reduce((newest, file) => Math.max(newest, file.modifiedAt), 0),
            processed: false,
        });
    }
    return sources;
}
/**
 * A `notes.txt` beside `notes.png` is that image's caption brief — it is read as part of the
 * image source, so it must not also generate a campaign of its own.
 */
function dropConsumedSidecars(files) {
    const mediaKeys = new Set(files
        .filter((file) => isMediaCategory(file.category))
        .map((file) => path_1.default.join(path_1.default.dirname(file.path), path_1.default.basename(file.path, file.extension))));
    if (!mediaKeys.size)
        return files;
    return files.filter((file) => {
        if (file.extension !== '.md' && file.extension !== '.txt')
            return true;
        return !mediaKeys.has(path_1.default.join(path_1.default.dirname(file.path), path_1.default.basename(file.path, file.extension)));
    });
}
function mediaFolder() {
    const folder = path_1.default.join((0, userDataPath_1.resolveUserDataPath)(), 'folder-pipeline-media');
    fs_1.default.mkdirSync(folder, { recursive: true });
    return folder;
}
/**
 * Copy a matched image/video into app storage so a scheduled post keeps its media even if
 * the user later moves or deletes the watched file.
 */
function importFileMedia(file) {
    const type = MIME_BY_EXTENSION[file.extension];
    if (!type)
        return null;
    const maxBytes = file.category === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (file.sizeBytes > maxBytes)
        return null;
    const name = `${crypto_1.default
        .createHash('sha1')
        .update(`${file.path}:${file.sizeBytes}:${file.modifiedAt}`)
        .digest('hex')
        .slice(0, 16)}${file.extension}`;
    const target = path_1.default.join(mediaFolder(), name);
    try {
        if (!fs_1.default.existsSync(target))
            fs_1.default.copyFileSync(file.path, target);
    }
    catch {
        return null;
    }
    return { path: target, type, alt: humanizeFileName(file.name) };
}
/** `2026-08-10_launch-screen.png` → `launch screen`. */
function humanizeFileName(name) {
    return path_1.default
        .basename(name, path_1.default.extname(name))
        .replace(/^\d{4}[-_.]\d{2}[-_.]\d{2}[-_. ]*/, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || path_1.default.basename(name);
}
function readTextFile(filePath) {
    const handle = fs_1.default.openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(MAX_TEXT_BYTES);
        const read = fs_1.default.readSync(handle, buffer, 0, MAX_TEXT_BYTES, 0);
        return buffer.subarray(0, read).toString('utf8');
    }
    finally {
        fs_1.default.closeSync(handle);
    }
}
/** Strip YAML frontmatter, returning its title/description when present. */
function splitFrontmatter(raw) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
    if (!match)
        return { title: null, body: raw };
    const titleMatch = /^\s*title\s*:\s*(.+)$/im.exec(match[1]);
    const title = titleMatch ? titleMatch[1].trim().replace(/^["']|["']$/g, '') : null;
    return { title, body: raw.slice(match[0].length) };
}
/** A same-basename `.md`/`.txt` next to an image/video is treated as its caption brief. */
function sidecarText(file) {
    if (!isMediaCategory(file.category))
        return '';
    const base = path_1.default.join(path_1.default.dirname(file.path), path_1.default.basename(file.path, file.extension));
    for (const extension of ['.md', '.txt']) {
        const candidate = `${base}${extension}`;
        try {
            if (fs_1.default.statSync(candidate).isFile())
                return readTextFile(candidate).trim().slice(0, 4_000);
        }
        catch {
            // No sidecar for this extension.
        }
    }
    return '';
}
function formatBytes(bytes) {
    if (bytes >= 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024)
        return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
}
/**
 * Turn a matched file into campaign source material.
 *
 * Text files are read directly. Images and videos cannot be read by the API providers, so the
 * brief is built from the file name, folder, operator notes, and any sidecar text — and the
 * absolute path is included because a local CLI agent route *can* open the file itself.
 */
function readFolderFileSource(file, options) {
    const contextNote = options?.contextNote?.trim() ?? '';
    const humanName = humanizeFileName(file.name);
    if (isMediaCategory(file.category)) {
        const media = importFileMedia(file);
        if (!media)
            return null;
        const sidecar = sidecarText(file);
        const lines = [
            `Source asset: ${file.name} (${file.category}, ${formatBytes(file.sizeBytes)})`,
            `Subject: ${humanName}`,
            `Dropped in folder: ${path_1.default.basename(path_1.default.dirname(file.path))}`,
            `Local path: ${file.path}`,
            contextNote ? `Operator notes about this folder: ${contextNote}` : '',
            sidecar ? `Notes filed next to the asset:\n${sidecar}` : '',
            `Write the post about this ${file.category}; it is attached to the post, so refer to what the reader can see.`,
            'If you have file-reading tools available, open the local path above to inspect the asset before writing.',
        ].filter(Boolean);
        return {
            title: humanName,
            text: lines.join('\n'),
            media: [media],
            detectedType: file.category === 'video' ? 'video asset' : 'image asset',
        };
    }
    let raw;
    try {
        raw = readTextFile(file.path);
    }
    catch {
        return null;
    }
    const { title: frontmatterTitle, body } = file.extension === '.json'
        ? { title: null, body: raw }
        : splitFrontmatter(raw);
    const text = body.replace(/\r\n/g, '\n').trim();
    if (!text)
        return null;
    const headingTitle = /^#{1,3}\s+(.+)$/m.exec(text)?.[1]?.trim() ?? null;
    const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
    const title = (frontmatterTitle || headingTitle || (firstLine.length <= 96 ? firstLine : '') || humanName).slice(0, 160);
    const header = contextNote ? `Operator notes about this folder: ${contextNote}\n\n` : '';
    return {
        title,
        text: `${header}${text}`.slice(0, exports.MAX_SOURCE_CHARS),
        media: [],
        detectedType: file.extension === '.json' ? 'structured notes' : 'written notes',
    };
}
/** How many attachments one bundled post carries; channels cap this further at publish time. */
const MAX_BUNDLE_MEDIA = 6;
/**
 * Turn a whole subfolder into one campaign: every text file becomes a labelled section of the
 * brief, every image/video is attached, and the file list is spelled out so the writer knows what
 * the reader will see.
 */
function readFolderBundleSource(source, options) {
    const contextNote = options?.contextNote?.trim() ?? '';
    const textFiles = source.files.filter((file) => !isMediaCategory(file.category));
    const mediaFiles = source.files.filter((file) => isMediaCategory(file.category));
    const media = [];
    for (const file of mediaFiles) {
        if (media.length >= MAX_BUNDLE_MEDIA)
            break;
        const imported = importFileMedia(file);
        if (imported)
            media.push(imported);
    }
    const sections = [];
    let derivedTitle = null;
    for (const file of textFiles) {
        let raw;
        try {
            raw = readTextFile(file.path);
        }
        catch {
            continue;
        }
        const { title: frontmatterTitle, body } = file.extension === '.json'
            ? { title: null, body: raw }
            : splitFrontmatter(raw);
        const text = body.replace(/\r\n/g, '\n').trim();
        if (!text)
            continue;
        if (!derivedTitle) {
            const headingTitle = /^#{1,3}\s+(.+)$/m.exec(text)?.[1]?.trim() ?? null;
            derivedTitle = frontmatterTitle || headingTitle || null;
        }
        sections.push(`--- ${file.name} ---\n${text}`);
    }
    if (!sections.length && !media.length)
        return null;
    const humanName = humanizeFileName(source.title);
    const manifest = source.files
        .map((file) => `- ${path_1.default.relative(source.path, file.path)} (${file.category}, ${formatBytes(file.sizeBytes)})`)
        .join('\n');
    const lines = [
        `Source folder: ${source.title} — ${source.fileCount} file${source.fileCount === 1 ? '' : 's'} that belong to one post.`,
        `Subject: ${humanName}`,
        `Local path: ${source.path}`,
        contextNote ? `Operator notes about this folder: ${contextNote}` : '',
        `Files in this folder:\n${manifest}`,
        media.length
            ? `${media.length} of them ${media.length === 1 ? 'is' : 'are'} attached to the post — write so the copy and the attachments fit together.`
            : '',
        sections.length ? `Written material in this folder:\n\n${sections.join('\n\n')}` : '',
        !sections.length
            ? 'If you have file-reading tools available, open the local paths above to inspect the assets before writing.'
            : '',
    ].filter(Boolean);
    return {
        title: (derivedTitle || humanName).slice(0, 160),
        text: lines.join('\n\n').slice(0, exports.MAX_SOURCE_CHARS),
        media,
        detectedType: 'file bundle',
    };
}
/** Read a scanned source — a single file, or a whole subfolder — as campaign material. */
function readFolderSource(source, options) {
    if (source.kind === 'subfolder')
        return readFolderBundleSource(source, options);
    const file = source.files[0];
    return file ? readFolderFileSource(file, options) : null;
}
//# sourceMappingURL=folderScan.js.map