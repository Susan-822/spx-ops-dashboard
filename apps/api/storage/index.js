import { describeThetaSnapshotStore } from '../state/thetaSnapshotStore.js';
import { describeTvSnapshotStore } from '../state/tvSnapshotStore.js';

export async function createStorageState() {
  const tvSnapshotStore = await describeTvSnapshotStore();
  const thetaSnapshotStore = await describeThetaSnapshotStore();

  return {
    backend: tvSnapshotStore?.backend || 'memory',
    persisted: Boolean(tvSnapshotStore?.persisted),
    mode: tvSnapshotStore?.mode || 'memory',
    tv_snapshot_store: tvSnapshotStore,
    theta_snapshot_store: thetaSnapshotStore,
    is_mock: false,
    message: [
      tvSnapshotStore?.message || 'TradingView snapshot store metadata unavailable.',
      thetaSnapshotStore?.message || 'Theta snapshot store metadata unavailable.'
    ].join(' ')
  };
}
