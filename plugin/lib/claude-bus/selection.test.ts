import { selectWorker, Worker } from './selection'

describe('selectWorker', () => {
  function createWorker(
    name: string,
    status: 'available' | 'busy',
    availableSince: number | null = null
  ): Worker {
    return {
      pane_id: `%${name.slice(-1)}`,
      pane_title: name,
      status,
      available_since: availableSince,
      busy_since: status === 'busy' ? Date.now() : null,
      current_task: status === 'busy' ? 'bd-test' : null
    }
  }

  it('returns null when no workers', () => {
    const workers = new Map<string, Worker>()
    expect(selectWorker(workers)).toBeNull()
  })

  it('returns null when all workers busy', () => {
    const workers = new Map<string, Worker>([
      ['z.ai1', createWorker('z.ai1', 'busy')],
      ['z.ai2', createWorker('z.ai2', 'busy')]
    ])
    expect(selectWorker(workers)).toBeNull()
  })

  it('returns oldest available worker when multiple available', () => {
    const now = Date.now()
    const workers = new Map<string, Worker>([
      ['z.ai1', createWorker('z.ai1', 'available', now - 1000)],  // 1 second ago
      ['z.ai2', createWorker('z.ai2', 'available', now - 5000)],  // 5 seconds ago (oldest)
      ['z.ai3', createWorker('z.ai3', 'available', now - 2000)]   // 2 seconds ago
    ])

    const selected = selectWorker(workers)
    expect(selected).not.toBeNull()
    expect(selected!.pane_title).toBe('z.ai2')
  })

  it('handles single available worker', () => {
    const now = Date.now()
    const workers = new Map<string, Worker>([
      ['z.ai1', createWorker('z.ai1', 'busy')],
      ['z.ai2', createWorker('z.ai2', 'available', now - 1000)],
      ['z.ai3', createWorker('z.ai3', 'busy')]
    ])

    const selected = selectWorker(workers)
    expect(selected).not.toBeNull()
    expect(selected!.pane_title).toBe('z.ai2')
  })

  it('ignores busy workers when selecting', () => {
    const now = Date.now()
    const workers = new Map<string, Worker>([
      ['z.ai1', createWorker('z.ai1', 'busy')],          // busy, should be ignored
      ['z.ai2', createWorker('z.ai2', 'available', now)] // available, should be selected
    ])

    const selected = selectWorker(workers)
    expect(selected).not.toBeNull()
    expect(selected!.pane_title).toBe('z.ai2')
    expect(selected!.status).toBe('available')
  })

  it('handles workers with same available_since (deterministic)', () => {
    const timestamp = 1000000
    const workers = new Map<string, Worker>([
      ['z.ai1', createWorker('z.ai1', 'available', timestamp)],
      ['z.ai2', createWorker('z.ai2', 'available', timestamp)]
    ])

    // Should consistently return one of them (Map iteration order is insertion order)
    const selected = selectWorker(workers)
    expect(selected).not.toBeNull()
    expect(['z.ai1', 'z.ai2']).toContain(selected!.pane_title)
  })
})
