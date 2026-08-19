"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commentService = exports.CommentService = void 0;
const AppRepository_1 = require("./AppRepository");
const ConnectorService_1 = require("./ConnectorService");
const registry_1 = require("./publishers/registry");
const OAuthService_1 = require("./oauth/OAuthService");
const connectorScope_1 = require("./publishers/connectorScope");
const repository_1 = require("./distribution-performance/repository");
const artifacts_1 = require("./distribution-performance/artifacts");
/** Delays at or under this run on an in-process timer so "30 seconds" means 30 seconds (§9.2). */
const TIMER_THRESHOLD_MS = 5 * 60 * 1000;
/** Backoff for a failed comment attempt, then give up. */
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
const MAX_ATTEMPTS = 4;
const UNIT_MS = {
    second: 1000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
};
function durationMs(duration, unit) {
    return Math.max(0, duration) * UNIT_MS[unit];
}
/** Terminal states never re-enter the sweep. */
function isFinished(status) {
    return status === 'published' || status === 'skipped' || status === 'expired' || status === 'unsupported';
}
class CommentService {
    /** Short-delay timers, keyed by comment id, so an edit or cancel can clear a pending fire. */
    timers = new Map();
    running = false;
    /**
     * Per-target lock. The sweep, a just-published target, and a fired timer can all reach the same
     * target at once; without this, two of them could read the same `armed` row and post it twice.
     * The remote-id idempotency check in fire() is not enough on its own — it is a read-then-write.
     */
    processing = new Set();
    /** Called from the scheduler sweep and on app start / power resume. */
    async runDueComments() {
        if (this.running)
            return;
        this.running = true;
        try {
            const asOf = Date.now();
            const due = AppRepository_1.repository.listActionableComments(asOf);
            if (!due.length)
                return;
            const byTarget = new Map();
            for (const comment of due) {
                const bucket = byTarget.get(comment.targetId) ?? [];
                bucket.push(comment);
                byTarget.set(comment.targetId, bucket);
            }
            for (const targetId of byTarget.keys()) {
                try {
                    await this.processTarget(targetId);
                }
                catch {
                    /* one bad target must not stall the rest of the sweep */
                }
            }
        }
        finally {
            this.running = false;
        }
    }
    /**
     * Called right after a target publishes. The publish path already holds the exact publish time, so
     * short delays don't wait to be rediscovered by a 2-minute sweep.
     */
    armAfterPublish(targetId) {
        void this.processTarget(targetId).catch(() => undefined);
    }
    /** Drop a scheduled fire — used when a comment is edited, cancelled, or the app shuts down. */
    clearTimer(commentId) {
        const timer = this.timers.get(commentId);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(commentId);
        }
    }
    shutdown() {
        for (const timer of this.timers.values())
            clearTimeout(timer);
        this.timers.clear();
    }
    scheduleTimer(commentId, delayMs) {
        this.clearTimer(commentId);
        const timer = setTimeout(() => {
            this.timers.delete(commentId);
            const comment = AppRepository_1.repository.getPostComment(commentId);
            if (!comment || isFinished(comment.status))
                return;
            void this.processTarget(comment.targetId).catch(() => undefined);
        }, Math.max(0, delayMs));
        // Never hold the event loop open for a pending comment — the sweep is the durable path.
        timer.unref?.();
        this.timers.set(commentId, timer);
    }
    async processTarget(targetId) {
        if (this.processing.has(targetId))
            return;
        this.processing.add(targetId);
        try {
            await this.processTargetLocked(targetId);
        }
        finally {
            this.processing.delete(targetId);
        }
    }
    async processTargetLocked(targetId) {
        const comments = AppRepository_1.repository.getTargetComments(targetId);
        if (!comments.length)
            return;
        const post = AppRepository_1.repository.getScheduledPost(comments[0].postId);
        if (!post)
            return;
        const target = post.targets.find((item) => item.id === targetId);
        if (!target)
            return;
        const publisher = (0, registry_1.getPublisher)(target.connectorName);
        const capability = publisher?.descriptor.comments;
        // A platform with no usable comment path (API, transport, or implementation) can never fire
        // these. Preserve the descriptor's exact reason instead of flattening every case to "no API".
        if (!publisher || !capability?.supported || typeof publisher.comment !== 'function') {
            const reason = capability?.unsupportedReason ??
                `${publisher?.descriptor.label ?? target.connectorName} does not support follow-up comments.`;
            for (const comment of comments) {
                if (isFinished(comment.status))
                    continue;
                AppRepository_1.repository.updatePostComment(comment.id, {
                    status: 'unsupported',
                    error: reason,
                });
            }
            return;
        }
        // OAuth comment scopes are deliberately optional so the parent post keeps working. If the user
        // did not grant (or later revoked) one, stop only these follow-ups with the capability's readable
        // explanation instead of retrying a provider 403 several times.
        const liveCapability = await this.capability(target.connectorName);
        if (liveCapability.permissionState !== 'granted' &&
            liveCapability.permissionState !== 'not_required') {
            for (const comment of comments) {
                if (isFinished(comment.status))
                    continue;
                AppRepository_1.repository.updatePostComment(comment.id, {
                    status: 'unsupported',
                    error: liveCapability.message,
                });
            }
            return;
        }
        // Nothing to attach to until the parent post is actually live.
        if (target.status !== 'published')
            return;
        const artifact = repository_1.distributionPerformanceRepository
            .artifactsForTarget(targetId)
            .find((item) => item.mappingStatus === 'resolved' && item.remotePostId);
        if (!artifact)
            return;
        const rootAnchor = {
            remoteId: artifact.remotePostId,
            remoteAccountId: artifact.remoteAccountId,
            url: artifact.remoteUrl,
            metadata: artifact.providerMetadata ?? {},
        };
        // Arm anything still pending. armedAt is the clock start for delays: an explicit value (a
        // retro-comment added today) wins over the post's original publish time (§7.2).
        for (const comment of comments) {
            if (comment.status !== 'pending')
                continue;
            AppRepository_1.repository.updatePostComment(comment.id, {
                status: 'armed',
                artifactId: artifact.id,
                armedAt: comment.armedAt ?? artifact.publishedAt,
            });
        }
        // Order is enforced: only the lowest unfinished position is ever eligible, so comment N always
        // lands after comment N-1 and relative delays stay well defined.
        const ordered = AppRepository_1.repository.getTargetComments(targetId).sort((a, b) => a.position - b.position);
        const next = ordered.find((comment) => !isFinished(comment.status) && comment.status !== 'publishing');
        if (!next)
            return;
        const previous = ordered.filter((item) => item.position < next.position).pop() ?? null;
        const decision = this.evaluate(next, previous, artifact.id, targetId, artifact.publishedAt);
        if (decision.kind === 'wait') {
            if (decision.inMs != null && decision.inMs <= TIMER_THRESHOLD_MS) {
                this.scheduleTimer(next.id, decision.inMs);
            }
            AppRepository_1.repository.updatePostComment(next.id, {
                nextCheckAt: decision.inMs != null ? Date.now() + decision.inMs : null,
            });
            return;
        }
        if (decision.kind === 'expire') {
            AppRepository_1.repository.updatePostComment(next.id, { status: 'expired', error: 'Condition was not met in time.' });
            AppRepository_1.repository.createDistributionEvent({
                productId: post.productId,
                connectorName: target.connectorName,
                eventType: 'follow_up_comment',
                status: 'skipped',
                postId: post.id,
                targetId,
                message: `Follow-up comment expired — ${decision.reason}`,
                metadata: { commentId: next.id, position: next.position },
            });
            return;
        }
        await this.fire(next, previous, post, target, publisher, rootAnchor, capability.chain);
    }
    /** Pure decision: fire now, wait (optionally with a known delay), or give up. */
    evaluate(comment, previous, artifactId, targetId, postPublishedAt) {
        const trigger = comment.trigger ?? { kind: 'immediate' };
        const now = Date.now();
        if (trigger.kind === 'immediate')
            return { kind: 'fire' };
        if (trigger.kind === 'delay') {
            // Relative to the PREVIOUS item — the post for position 0, the prior comment after that — so
            // "30 seconds each" survives reordering instead of becoming hand-computed offsets.
            const base = previous?.publishedAt ?? comment.armedAt ?? postPublishedAt;
            const dueAt = base + durationMs(trigger.duration, trigger.unit);
            return now >= dueAt ? { kind: 'fire' } : { kind: 'wait', inMs: dueAt - now };
        }
        // Conditions are Phase 2 in the UI, but the evaluator is implemented so a saved condition can
        // never sit in an unhandled state.
        const armedAt = comment.armedAt ?? postPublishedAt;
        if (trigger.expiresAfter) {
            const expiresAt = armedAt + durationMs(trigger.expiresAfter.duration, trigger.expiresAfter.unit);
            if (now >= expiresAt) {
                return trigger.onExpiry === 'post'
                    ? { kind: 'fire' }
                    : { kind: 'expire', reason: 'the condition never became true' };
            }
        }
        const metric = repository_1.distributionPerformanceRepository.latestMetric(artifactId);
        // Our own published follow-ups inflate the platform's comment count, so subtract them —
        // otherwise a thread satisfies its own "wait for N comments" trigger (§8.2).
        const ourComments = AppRepository_1.repository.countPublishedComments(targetId);
        const satisfied = (clause) => {
            if (clause.kind === 'age') {
                return now >= postPublishedAt + durationMs(clause.duration, clause.unit);
            }
            const raw = clause.metric === 'comments'
                ? metric?.comments != null
                    ? Math.max(0, metric.comments - ourComments)
                    : null
                : (metric?.[clause.metric] ?? null);
            // A missing metric is never "satisfied" — an absent number must not trigger a public post.
            if (raw == null)
                return false;
            return clause.comparison === 'gt' ? raw > clause.value : raw < clause.value;
        };
        const results = trigger.clauses.map(satisfied);
        const met = trigger.relation === 'OR' ? results.some(Boolean) : results.length > 0 && results.every(Boolean);
        return met ? { kind: 'fire' } : { kind: 'wait', inMs: null };
    }
    async fire(comment, previous, post, target, publisher, root, chain) {
        // Idempotency: a comment that already has a remote id is live, whatever the row says. Double
        // posting is a visible, public failure, so this guard runs before every attempt.
        if (comment.remoteCommentId)
            return;
        const connector = AppRepository_1.repository.getConnector(target.connectorName);
        if (!connector)
            return;
        const config = (0, connectorScope_1.connectorConfigForProject)(connector.config, post.productId);
        // A thread replies to the comment before it; a flat platform always attaches to the root post.
        const parent = chain === 'thread' && previous?.remoteCommentId
            ? {
                remoteId: previous.remoteCommentId,
                remoteAccountId: root.remoteAccountId,
                url: previous.publishedUrl,
                metadata: previous.providerMetadata ?? {},
            }
            : root;
        AppRepository_1.repository.updatePostComment(comment.id, { status: 'publishing', nextCheckAt: null });
        let secret = null;
        try {
            secret = await ConnectorService_1.connectorService.getSecret(target.connectorName, post.productId);
            const kind = publisher.descriptor.authKind;
            if (kind === 'oauth2' || kind === 'oauth2_relay') {
                const accessToken = await OAuthService_1.oauthService.ensureFreshToken(target.connectorName);
                secret = { ...(secret ?? {}), accessToken };
            }
        }
        catch (error) {
            this.recordFailure(comment, post, target, error instanceof Error ? error.message : 'Auth failed.');
            return;
        }
        try {
            const outcome = await publisher.comment({ body: comment.body, media: comment.media, root, parent }, secret, config);
            if (!outcome.ok) {
                this.recordFailure(comment, post, target, outcome.error ?? 'Comment failed.');
                return;
            }
            const artifact = outcome.artifacts?.[0];
            AppRepository_1.repository.updatePostComment(comment.id, {
                status: 'published',
                publishedUrl: outcome.url,
                publishedAt: Date.now(),
                remoteCommentId: artifact?.remotePostId ?? null,
                remoteParentId: parent.remoteId,
                providerMetadata: artifact?.providerMetadata ?? {},
                error: null,
                nextCheckAt: null,
            });
            // Register the comment as its own artifact so a threaded reply gets metrics like any other post.
            if (outcome.artifacts?.length) {
                repository_1.distributionPerformanceRepository.upsertPublishedArtifacts({
                    targetId: target.id,
                    scheduledPostId: post.id,
                    contentId: post.contentId ?? null,
                    productId: post.productId,
                    connectorName: target.connectorName,
                    accountRef: target.accountRef,
                    artifacts: (0, artifacts_1.normalizePublishedArtifacts)(target.connectorName, outcome),
                });
            }
            AppRepository_1.repository.createDistributionEvent({
                productId: post.productId,
                connectorName: target.connectorName,
                eventType: 'follow_up_comment',
                status: 'success',
                postId: post.id,
                targetId: target.id,
                message: `Follow-up comment ${comment.position + 1} posted to ${publisher.descriptor.label}.`,
                publishedUrl: outcome.url,
                metadata: { commentId: comment.id, position: comment.position, origin: comment.origin },
            });
            // Chain straight into the next one so a thread's spacing is measured from this publish time.
            // Calls the locked body directly: we already hold this target's lock and are continuing the
            // same logical pass, so going through processTarget() would no-op on its own lock.
            await this.processTargetLocked(target.id);
        }
        catch (error) {
            this.recordFailure(comment, post, target, error instanceof Error ? error.message : 'Comment failed.');
        }
    }
    recordFailure(comment, post, target, error) {
        const attempts = comment.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        const backoff = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)];
        AppRepository_1.repository.updatePostComment(comment.id, {
            status: giveUp ? 'failed' : 'armed',
            attempts,
            error,
            nextCheckAt: giveUp ? null : Date.now() + backoff,
        });
        AppRepository_1.repository.createDistributionEvent({
            productId: post.productId,
            connectorName: target.connectorName,
            eventType: 'follow_up_comment',
            status: 'failed',
            postId: post.id,
            targetId: target.id,
            message: giveUp
                ? `Follow-up comment failed after ${attempts} attempts.`
                : `Follow-up comment failed — retrying (attempt ${attempts} of ${MAX_ATTEMPTS}).`,
            error,
            metadata: { commentId: comment.id, position: comment.position },
        });
    }
    /**
     * Whether this connector can post comments right now. Mirrors the Distribution Performance scope
     * diff rather than inventing a second permission model (§10.5).
     */
    async capability(connectorName) {
        const publisher = (0, registry_1.getPublisher)(connectorName);
        const descriptor = publisher?.descriptor;
        const comments = descriptor?.comments;
        const label = descriptor?.label ?? connectorName;
        if (!comments?.supported || typeof publisher?.comment !== 'function') {
            const reason = comments?.unsupportedReason ?? `${label} does not support follow-up comments.`;
            return {
                connectorName,
                label,
                supported: false,
                chain: comments?.chain ?? 'none',
                permissionState: 'not_required',
                requiredScopes: [],
                missingScopes: [],
                needsAppReview: false,
                message: reason,
            };
        }
        const requiredScopes = comments.requiredScopes ?? [];
        if (!requiredScopes.length) {
            return {
                connectorName,
                label,
                supported: true,
                chain: comments.chain,
                permissionState: 'granted',
                requiredScopes: [],
                missingScopes: [],
                needsAppReview: false,
                message: `${label} can post follow-up comments.`,
            };
        }
        let granted = new Set();
        try {
            const status = await OAuthService_1.oauthService.status(connectorName);
            granted = new Set(String(status.scope ?? '').split(/[\s,]+/).filter(Boolean));
        }
        catch {
            granted = new Set();
        }
        const missingScopes = requiredScopes.filter((scope) => !granted.has(scope));
        if (!missingScopes.length) {
            return {
                connectorName,
                label,
                supported: true,
                chain: comments.chain,
                permissionState: 'granted',
                requiredScopes,
                missingScopes: [],
                needsAppReview: false,
                message: `${label} can post follow-up comments.`,
            };
        }
        const stored = AppRepository_1.repository.getSetting(declinedKey(connectorName))?.value;
        const declined = Array.isArray(stored) ? stored : [];
        const allDeclined = missingScopes.every((scope) => declined.includes(scope));
        return {
            connectorName,
            label,
            supported: true,
            chain: comments.chain,
            permissionState: allDeclined ? 'declined' : 'prompt',
            requiredScopes,
            missingScopes,
            needsAppReview: comments.needsAppReview ?? false,
            message: `${label} needs one more permission before it can post follow-up comments.`,
        };
    }
    /** Record "not now" so the badge stops prompting, without touching the analytics decision store. */
    declinePermission(connectorName, scopes) {
        AppRepository_1.repository.setSetting(declinedKey(connectorName), scopes);
    }
    clearPermissionDecision(connectorName) {
        AppRepository_1.repository.setSetting(declinedKey(connectorName), []);
    }
}
exports.CommentService = CommentService;
/**
 * Keyed by connector AND feature. The Distribution Performance decision store is keyed by connector
 * alone, so sharing it would let a declined comment permission overwrite a declined analytics one.
 */
function declinedKey(connectorName) {
    return `commentPermissionDeclined:${connectorName}`;
}
exports.commentService = new CommentService();
//# sourceMappingURL=CommentService.js.map