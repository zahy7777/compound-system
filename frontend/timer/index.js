export function createTimer(call) {
  let snapshots = new Map()
  let revision = 0
  const remember = values => {for (const value of values) if (value) snapshots.set(value.key, {...value, receivedAt: performance.now()}); return values}
  return {
    read: async keys => {const current = ++revision, values = await call('/readtimer', keys); if (current === revision) {snapshots = new Map(); remember(values)} return values},
    write: async (key, state) => {const value = await call('/writetimer', {key, state}); revision++; remember([value]); return value},
    snapshot: key => snapshots.get(key),
    elapsed: key => {const value = snapshots.get(key); return value ? value.elapsed_ms + (value.state === 'running' ? performance.now() - value.receivedAt : 0) : 0},
    format: ms => {const seconds = Math.floor(ms / 1000); return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':')},
  }
}
