import type { desktopApi } from '../../electron/preload'

type DesktopApi = typeof desktopApi

export const api: DesktopApi = window.desktopApi

declare global {
  interface Window {
    desktopApi: DesktopApi
  }
}
