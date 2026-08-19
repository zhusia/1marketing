"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readConnectorProjectIds = readConnectorProjectIds;
exports.readConnectorProfiles = readConnectorProfiles;
exports.rootConnectorServesProject = rootConnectorServesProject;
exports.profileServesProject = profileServesProject;
exports.connectorConfigForProject = connectorConfigForProject;
/**
 * Resolving "which config does this connector use for this project?" — shared by the publish path
 * and the follow-up comment path. It lives here rather than in PublisherService so CommentService
 * can use it without the two services importing each other.
 *
 * A connector's root config serves a project unless it is explicitly scoped to a different set; when
 * it isn't a match, the first per-project profile that claims the project wins.
 */
const CHANNEL_PROFILES_KEY = 'projectProfiles';
function readConnectorProjectIds(config) {
    const ids = Array.isArray(config.projectIds) ? config.projectIds : [];
    return ids.filter((value) => typeof value === 'string' && value.length > 0);
}
function readConnectorProfiles(config) {
    const raw = config[CHANNEL_PROFILES_KEY];
    if (!Array.isArray(raw))
        return [];
    return raw
        .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item))
            return null;
        const record = item;
        const id = typeof record.id === 'string' && record.id ? record.id : '';
        const profileConfig = record.config && typeof record.config === 'object' && !Array.isArray(record.config)
            ? record.config
            : {};
        const projectScope = record.projectScope === 'all' ? 'all' : 'selected';
        const projectIds = Array.isArray(record.projectIds)
            ? record.projectIds.filter((value) => typeof value === 'string' && value.length > 0)
            : [];
        return id ? { id, config: profileConfig, projectScope, projectIds } : null;
    })
        .filter((profile) => Boolean(profile));
}
function rootConnectorServesProject(config, productId) {
    const ids = readConnectorProjectIds(config);
    const selectedScope = config.projectScope === 'selected' || (config.projectScope !== 'all' && ids.length > 0);
    if (!selectedScope)
        return true;
    return productId != null && ids.includes(productId);
}
function profileServesProject(profile, productId) {
    if (profile.projectScope === 'all')
        return true;
    return productId != null && profile.projectIds.includes(productId);
}
function connectorConfigForProject(config, productId) {
    if (rootConnectorServesProject(config, productId))
        return config;
    const profile = readConnectorProfiles(config).find((item) => profileServesProject(item, productId));
    return profile?.config ?? {};
}
//# sourceMappingURL=connectorScope.js.map