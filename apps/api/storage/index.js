import { describeTvSnapshotStore } from '../state/tvSnapshotStore.js';

export async function createStorageState() {
  const tvSnapshotStore = await describeTvSnapshotStore();

  return {
    backend: tvSnapshotStore?.backend || 'memory',
    persisted: Boolean(tvSnapshotStore?.persisted),
    mode: tvSnapshotStore?.mode || 'memory',
    tv_snapshot_store: tvSnapshotStore,
    is_mock: false,
    message: tvSnapshotStore?.message || 'TradingView snapshot store metadata unavailable.'
  };
}
