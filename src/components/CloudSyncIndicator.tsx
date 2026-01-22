import { useMemo } from 'react'
import { useTournamentStore } from '../store/useTournamentStore'

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString()
  } catch {
    return iso
  }
}

export function CloudSyncIndicator() {
  const { state, cloud } = useTournamentStore()

  const view = useMemo(() => {
    if (!cloud.enabled) {
      return {
        label: 'Cloud: Off',
        detail: '',
        klass: 'border-slate-800 bg-slate-950/30 text-slate-300',
      }
    }

    if (!cloud.hydrated) {
      return {
        label: 'Cloud: Loading…',
        detail: '',
        klass: 'border-slate-700 bg-slate-900/40 text-slate-200',
      }
    }

    if (cloud.status === 'connecting') {
      return {
        label: 'Cloud: Connecting…',
        detail: '',
        klass: 'border-slate-700 bg-slate-900/40 text-slate-200',
      }
    }

    if (cloud.status === 'error') {
      return {
        label: 'Cloud: Error',
        detail: cloud.error ? 'Tap Setup to retry' : '',
        klass: 'border-red-900/60 bg-red-950/30 text-red-200',
      }
    }

    // connected
    const upToDate = cloud.inFlight === 0 && cloud.lastSyncedUpdatedAt === state.updatedAt && !cloud.error
    if (cloud.inFlight > 0 || !upToDate) {
      return {
        label: 'Cloud: Syncing…',
        detail: cloud.lastSyncedAt ? `Last ${fmtTime(cloud.lastSyncedAt)}` : '',
        klass: 'border-slate-700 bg-slate-900/40 text-slate-200',
      }
    }

    return {
      label: 'Cloud: Synced',
      detail: cloud.lastSyncedAt ? fmtTime(cloud.lastSyncedAt) : '',
      klass: 'border-emerald-900/50 bg-emerald-950/20 text-emerald-200',
    }
  }, [cloud, state.updatedAt])

  return (
    <div className={['rounded-full border px-3 py-1 text-xs font-semibold tabular-nums', view.klass].join(' ')}>
      <span>{view.label}</span>
      {view.detail ? <span className="ml-2 font-medium text-slate-300">{view.detail}</span> : null}
    </div>
  )
}

