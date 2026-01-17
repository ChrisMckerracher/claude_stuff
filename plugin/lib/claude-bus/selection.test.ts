import { selectWorker, Worker, WorkerStatus } from './selection'

describe('selectWorker', () => {
  function createWorker(
    name: string,
    status: WorkerStatus,
    lastActivity: number = Date.now()
  ): Worker {
    return {
      name,
      status,
      registered_at: lastActivity - 10000,  // Registered 10s before last activity
      last_activity: lastActivity,
      current_task: (status === 'executing' || status === 'pending') ? 'bd-test' : null,
      task_started_at: status === 'executing' ? lastActivity : null
    }
  }

  it('returns null when no workers', () => {
    const workers = new Map<string, Worker>()
    expect(selectWorker(workers)).toBeNull()
  })

  it('returns null when all workers executing', () => {
    const workers = new Map<string, Worker>([
      ['z.ai1', createWorker('z.ai1', 'executing')],
      ['z.ai2', createWorker('z.ai2', 'executing')]
    ])
    expect(selectWorker(workers)).toBeNull()
  })

  it('returns oldest idle worker when multiple idle', () => {
    const now = Date.now()
    const workers = new Map<string, Worker>([
      ['z.ai1', createWorker('z.ai1', 'idle', now - 1000)],  // 1 second ago
      ['z.ai2', createWorker('z.ai2', 'idle', now - 5000)],  // 5 seconds ago (oldest)
      ['z.ai3', createWorker('z.ai3', 'idle', now - 2000)]   // 2 seconds ago
    ])

    const selected = selectWorker(workers)
    expect(selected).not.toBeNull()
    expect(selected!.name).toBe('z.ai2')
  })

  it('prefers polling workers over idle workers', () => {
    const now = Date.now()
    const workers = new Map<string, Worker>([
      ['z.ai1', createWorker('z.ai1', 'idle', now - 5000)],     // idle, older
      ['z.ai2', createWorker('z.ai2', 'polling', now - 1000)]   // polling, more recent
    ])

    const selected = selectWorker(workers)
    expect(selected).not.toBeNull()
    expect(selected!.name).toBe('z.ai2')  // Polling is preferred over idle
  })

  it('handles single idle worker among executing workers', () => {
    const now = Date.now()
    const workers = new Map<string, Worker>([
      ['z.ai1', createWorker('z.ai1', 'executing')],
      ['z.ai2', createWorker('z.ai2', 'idle', now - 1000)],
      ['z.ai3', createWorker('z.ai3', 'executing')]
    ])

    const selected = selectWorker(workers)
    expect(selected).not.toBeNull()
    expect(selected!.name).toBe('z.ai2')
  })

  it('ignores executing and pending workers when selecting', () => {
    const now = Date.now()
    const workers = new Map<string, Worker>([
      ['z.ai1', createWorker('z.ai1', 'executing')],  // executing, should be ignored
      ['z.ai2', createWorker('z.ai2', 'pending')],    // pending, should be ignored
      ['z.ai3', createWorker('z.ai3', 'idle', now)]   // idle, should be selected
    ])

    const selected = selectWorker(workers)
    expect(selected).not.toBeNull()
    expect(selected!.name).toBe('z.ai3')
    expect(selected!.status).toBe('idle')
  })

  it('handles workers with same last_activity (deterministic)', () => {
    const timestamp = 1000000
    const workers = new Map<string, Worker>([
      ['z.ai1', createWorker('z.ai1', 'idle', timestamp)],
      ['z.ai2', createWorker('z.ai2', 'idle', timestamp)]
    ])

    // Should consistently return one of them (Map iteration order is insertion order)
    const selected = selectWorker(workers)
    expect(selected).not.toBeNull()
    expect(['z.ai1', 'z.ai2']).toContain(selected!.name)
  })
})
