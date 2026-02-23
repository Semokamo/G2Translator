import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { appendEventLog } from '../_shared/log'
import { getState } from './api'
import { state, setBridge } from './state'
import { showDashboard } from './renderer'
import { onEvenHubEvent, setRefreshState } from './events'

export async function refreshState(): Promise<void> {
  try {
    state.vehicle = await getState()
    appendEventLog('State: refreshed')
  } catch (err) {
    console.error('[tesla] refreshState failed', err)
    appendEventLog(`State: refresh failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (state.screen === 'dashboard' || state.screen === 'confirmation') {
    await showDashboard()
  }
}

export async function initApp(appBridge: EvenAppBridge): Promise<void> {
  setBridge(appBridge)
  setRefreshState(refreshState)

  appBridge.onEvenHubEvent((event) => {
    onEvenHubEvent(event)
  })

  await refreshState()
  await showDashboard()

  setInterval(() => { void refreshState() }, 60_000)
}
