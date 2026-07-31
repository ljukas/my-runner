/**
 * A dynamic segment can't be empty, so a failed save routes with this sentinel instead of a run id
 * (run ids are UUIDs — no collision). The run screen renders it as the save-failure apology.
 */
export const UNSAVED_RUN_ID = 'unsaved';
