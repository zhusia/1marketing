"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.imageGenService = exports.ImageGenService = void 0;
const MediaGenerationService_1 = require("./media-generation/MediaGenerationService");
/**
 * Compatibility facade for the existing Creative Builder. New generation pages
 * use durable media jobs directly; older design callers still receive raw bytes
 * and continue to own their existing asset-import behavior.
 */
class ImageGenService {
    isConfigured() {
        return MediaGenerationService_1.mediaGenerationService.hasImageProvider();
    }
    generate(prompt, options = { width: 1024, height: 1024 }) {
        return MediaGenerationService_1.mediaGenerationService.generateCompatibilityImage(prompt, options);
    }
}
exports.ImageGenService = ImageGenService;
exports.imageGenService = new ImageGenService();
//# sourceMappingURL=ImageGenService.js.map