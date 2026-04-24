export function createSchedulerState() {
  return {
    enabled: false,
    jobs: [],
    is_mock: true,
    message: 'Scheduler directory is scaffolded; no recurring jobs are running.'
  };
}
