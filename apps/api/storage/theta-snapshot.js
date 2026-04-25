import {
  clearThetaSnapshot,
  describeThetaSnapshotStore,
  readThetaSnapshot,
  resetThetaSnapshotStoreForTests,
  writeThetaSnapshot
} from '../state/thetaSnapshotStore.js';

export { writeThetaSnapshot };
export { describeThetaSnapshotStore, resetThetaSnapshotStoreForTests };
export { clearThetaSnapshot };

export async function updateThetaSnapshot(payload) {
  return writeThetaSnapshot(payload);
}

export async function getThetaSnapshot() {
  return readThetaSnapshot();
}

export async function clearStoredThetaSnapshot() {
  await clearThetaSnapshot();
}
