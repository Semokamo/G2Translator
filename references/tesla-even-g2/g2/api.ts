import type { VehicleState, ActionParams } from './state'

const SERVER_URL_KEY = 'tesla:server-url'
const TOKEN_KEY = 'tesla:tessie-token'

function getBaseUrl(): string {
  return localStorage.getItem(SERVER_URL_KEY) ?? ''
}

export function setBaseUrl(url: string): void {
  localStorage.setItem(SERVER_URL_KEY, url)
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { 'X-Tessie-Token': token } : {}
}

export async function getState(): Promise<VehicleState> {
  const res = await fetch(`${getBaseUrl()}/api/state`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`State fetch failed: ${res.status}`)
  const data = await res.json()

  const charge = data.charge_state ?? {}
  const climate = data.climate_state ?? {}
  const vehicle = data.vehicle_state ?? {}

  return {
    batteryLevel: charge.battery_level ?? 0,
    range: Math.round((charge.battery_range ?? 0) * 1.60934),
    climateOn: climate.is_climate_on ?? false,
    insideTemp: Math.round(climate.inside_temp ?? 0),
    outsideTemp: Math.round(climate.outside_temp ?? 0),
    locked: vehicle.locked ?? true,
    chargingState: charge.charging_state ?? 'Unknown',
    sentryMode: vehicle.sentry_mode ?? false,
    chargePortDoorOpen: charge.charge_port_door_open ?? false,
    chargeLimitSoc: charge.charge_limit_soc ?? 80,
    chargeAmps: charge.charge_current_request ?? 0,
    driverTempSetting: climate.driver_temp_setting ?? 20,
    defrostMode: climate.defrost_mode !== 0 && climate.defrost_mode !== undefined,
    seatHeaterLeft: climate.seat_heater_left ?? 0,
    seatHeaterRight: climate.seat_heater_right ?? 0,
    valetMode: vehicle.valet_mode ?? false,
    sunRoofPercentOpen: vehicle.sun_roof_percent_open ?? 0,
    homelinkNearby: vehicle.homelink_nearby ?? false,
  }
}

export async function sendCommand(cmd: string, params?: ActionParams): Promise<{ ok: boolean; error?: string }> {
  try {
    let url = `${getBaseUrl()}/api/command/${cmd}`
    if (params && Object.keys(params).length > 0) {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) {
        qs.set(k, String(v))
      }
      url += `?${qs.toString()}`
    }
    const res = await fetch(url, { method: 'POST', headers: authHeaders() })
    const data = await res.json()
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function getMap(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(`${getBaseUrl()}/api/map`, { headers: authHeaders() })
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}

export async function checkConnection(): Promise<boolean> {
  try {
    const res = await fetch(`${getBaseUrl()}/api/state`, { headers: authHeaders(), signal: AbortSignal.timeout(5000) })
    return res.ok
  } catch {
    return false
  }
}
