"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.videoRepository = exports.VideoRepository = void 0;
const db_1 = require("../../db");
const id_1 = require("../../utils/id");
const json_1 = require("../../utils/json");
function mapStoryboard(row) {
    return {
        id: row.id,
        productId: row.product_id,
        pipelineId: row.pipeline_id,
        format: row.format,
        storyboard: (0, json_1.safeParseJson)(row.storyboard_json, {
            version: 1,
            pipelineId: row.pipeline_id,
            format: row.format,
            fps: 30,
            totalDurationMs: 0,
            scenes: [],
        }),
        review: (0, json_1.safeParseJson)(row.review_json, null),
        assetId: row.asset_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function defaultContext() {
    return {
        prompt: '',
        agentId: null,
        style: null,
        referenceImagePath: null,
        useReferenceAsBackground: false,
        sourceImageAssetIds: [],
        autoRun: false,
        wantsAudio: false,
        wantsCaptions: false,
    };
}
class VideoRepository {
    get db() {
        return (0, db_1.getDb)();
    }
    create(input) {
        const storyboardId = (0, id_1.createId)();
        const runId = (0, id_1.createId)();
        const timestamp = Date.now();
        const storyboardJson = (0, json_1.safeStringify)(input.storyboard);
        const tx = this.db.transaction(() => {
            this.db.prepare(`
        INSERT INTO video_storyboards (
          id, product_id, pipeline_id, format, storyboard_json, review_json, asset_id, created_at, updated_at
        ) VALUES (@id, @productId, @pipelineId, @format, @storyboardJson, NULL, NULL, @timestamp, @timestamp)
      `).run({
                id: storyboardId,
                productId: input.productId,
                pipelineId: input.storyboard.pipelineId,
                format: input.storyboard.format,
                storyboardJson,
                timestamp,
            });
            this.db.prepare(`
        INSERT INTO video_runs (
          id, storyboard_id, stage, pending_gate, revision, context_json, provider_selection_json, error, created_at, updated_at
        ) VALUES (@id, @storyboardId, 'author', NULL, 0, @contextJson, @providerJson, NULL, @timestamp, @timestamp)
      `).run({
                id: runId,
                storyboardId,
                contextJson: (0, json_1.safeStringify)(input.context),
                providerJson: input.providerSelection ? (0, json_1.safeStringify)(input.providerSelection) : null,
                timestamp,
            });
            this.db.prepare(`
        INSERT INTO video_storyboard_revisions (storyboard_id, revision, storyboard_json, created_at)
        VALUES (@storyboardId, 0, @storyboardJson, @timestamp)
      `).run({ storyboardId, storyboardJson, timestamp });
        });
        tx();
        return this.getRun(runId);
    }
    getStoryboard(id) {
        const row = this.db.prepare(`SELECT * FROM video_storyboards WHERE id = ?`).get(id);
        return row ? mapStoryboard(row) : null;
    }
    getRun(id) {
        const row = this.db.prepare(`SELECT * FROM video_runs WHERE id = ?`).get(id);
        if (!row)
            return null;
        const storyboard = this.getStoryboard(row.storyboard_id);
        if (!storyboard)
            return null;
        return {
            id: row.id,
            storyboardId: row.storyboard_id,
            stage: row.stage,
            pendingGate: row.pending_gate,
            revision: row.revision,
            context: { ...defaultContext(), ...(0, json_1.safeParseJson)(row.context_json, {}) },
            providerSelection: (0, json_1.safeParseJson)(row.provider_selection_json, null),
            error: row.error,
            storyboard,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    getRunForStoryboard(storyboardId) {
        const row = this.db.prepare(`
      SELECT id FROM video_runs WHERE storyboard_id = ? ORDER BY updated_at DESC LIMIT 1
    `).get(storyboardId);
        return row ? this.getRun(row.id) : null;
    }
    listRuns(productId) {
        const rows = productId
            ? this.db.prepare(`
          SELECT vr.id
          FROM video_runs vr
          JOIN video_storyboards vs ON vs.id = vr.storyboard_id
          WHERE vs.product_id = ?
          ORDER BY vr.updated_at DESC
        `).all(productId)
            : this.db.prepare(`SELECT id FROM video_runs ORDER BY updated_at DESC`).all();
        return rows.map((row) => this.getRun(row.id)).filter((run) => Boolean(run));
    }
    recoverInterruptedRuns() {
        const rows = this.db.prepare(`
      SELECT vr.id, vr.storyboard_id, vr.revision, vr.stage, vs.storyboard_json
      FROM video_runs vr
      JOIN video_storyboards vs ON vs.id = vr.storyboard_id
      WHERE vr.pending_gate IS NULL AND vr.stage NOT IN ('done', 'failed')
    `).all();
        if (!rows.length)
            return 0;
        const timestamp = Date.now();
        const tx = this.db.transaction(() => {
            for (const row of rows) {
                const revision = row.revision + 1;
                const pendingGate = row.stage === 'author' || row.stage === 'scene-plan'
                    ? 'script'
                    : row.stage === 'assets'
                        ? 'scene-plan'
                        : 'assets';
                this.db.prepare(`
          UPDATE video_runs
          SET stage = 'failed', pending_gate = @pendingGate, revision = @revision,
              error = 'The app closed while this video stage was running. Retry the last approved gate.', updated_at = @timestamp
          WHERE id = @id
        `).run({ id: row.id, pendingGate, revision, timestamp });
                this.db.prepare(`
          INSERT INTO video_storyboard_revisions (storyboard_id, revision, storyboard_json, created_at)
          VALUES (@storyboardId, @revision, @storyboardJson, @timestamp)
        `).run({ storyboardId: row.storyboard_id, revision, storyboardJson: row.storyboard_json, timestamp });
            }
        });
        tx();
        return rows.length;
    }
    save(input) {
        const timestamp = Date.now();
        const tx = this.db.transaction(() => {
            const current = this.db.prepare(`SELECT * FROM video_runs WHERE id = ?`).get(input.runId);
            if (!current)
                throw new Error('Video run not found.');
            if (current.revision !== input.expectedRevision) {
                throw new Error(`Video changed in another editor. Reload revision ${current.revision} and try again.`);
            }
            const nextRevision = current.revision + 1;
            const currentStoryboard = this.getStoryboard(current.storyboard_id);
            if (!currentStoryboard)
                throw new Error('Video storyboard not found.');
            const storyboard = input.storyboard ?? currentStoryboard.storyboard;
            const storyboardJson = (0, json_1.safeStringify)(storyboard);
            this.db.prepare(`
        UPDATE video_storyboards SET
          pipeline_id = @pipelineId,
          format = @format,
          storyboard_json = @storyboardJson,
          review_json = @reviewJson,
          asset_id = @assetId,
          updated_at = @timestamp
        WHERE id = @storyboardId
      `).run({
                pipelineId: storyboard.pipelineId,
                format: storyboard.format,
                storyboardJson,
                reviewJson: input.review === undefined
                    ? (currentStoryboard.review ? (0, json_1.safeStringify)(currentStoryboard.review) : null)
                    : (input.review ? (0, json_1.safeStringify)(input.review) : null),
                assetId: input.assetId === undefined ? currentStoryboard.assetId : input.assetId,
                timestamp,
                storyboardId: current.storyboard_id,
            });
            this.db.prepare(`
        UPDATE video_runs SET
          stage = @stage,
          pending_gate = @pendingGate,
          revision = @revision,
          context_json = @contextJson,
          error = @error,
          updated_at = @timestamp
        WHERE id = @runId
      `).run({
                stage: input.stage ?? current.stage,
                pendingGate: input.pendingGate === undefined ? current.pending_gate : input.pendingGate,
                revision: nextRevision,
                contextJson: input.context ? (0, json_1.safeStringify)(input.context) : current.context_json,
                error: input.error === undefined ? current.error : input.error,
                timestamp,
                runId: input.runId,
            });
            this.db.prepare(`
        INSERT INTO video_storyboard_revisions (storyboard_id, revision, storyboard_json, created_at)
        VALUES (@storyboardId, @revision, @storyboardJson, @timestamp)
      `).run({ storyboardId: current.storyboard_id, revision: nextRevision, storyboardJson, timestamp });
            this.db.prepare(`
        DELETE FROM video_storyboard_revisions
        WHERE storyboard_id = @storyboardId AND revision < @oldest
      `).run({ storyboardId: current.storyboard_id, oldest: Math.max(0, nextRevision - 29) });
        });
        tx();
        return this.getRun(input.runId);
    }
    deleteRun(runId) {
        const run = this.db.prepare(`SELECT storyboard_id FROM video_runs WHERE id = ?`).get(runId);
        if (!run)
            return false;
        // Deleting the storyboard cascades to its run and stored revisions (ON DELETE CASCADE).
        const result = this.db.prepare(`DELETE FROM video_storyboards WHERE id = ?`).run(run.storyboard_id);
        return result.changes > 0;
    }
    restoreRevision(runId, expectedRevision, targetRevision) {
        const run = this.getRun(runId);
        if (!run)
            throw new Error('Video run not found.');
        const row = this.db.prepare(`
      SELECT storyboard_json FROM video_storyboard_revisions WHERE storyboard_id = ? AND revision = ?
    `).get(run.storyboardId, targetRevision);
        if (!row)
            throw new Error('That storyboard revision is no longer available.');
        const storyboard = (0, json_1.safeParseJson)(row.storyboard_json, null);
        if (!storyboard)
            throw new Error('The saved storyboard revision is invalid.');
        return this.save({
            runId,
            expectedRevision,
            storyboard,
            stage: 'author',
            pendingGate: 'script',
            review: null,
            assetId: null,
            error: null,
        });
    }
}
exports.VideoRepository = VideoRepository;
exports.videoRepository = new VideoRepository();
//# sourceMappingURL=VideoRepository.js.map