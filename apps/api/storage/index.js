export function createStorageState() {
  return {
    backend: 'memory',
    persisted: false,
    is_mock: true,
    message: 'Storage directory is scaffolded; no durable storage is configured.'
  };
}
