import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { getDeviceRole } from '../device/deviceRole'
import { isChannelAllowedForRole } from '../device/viewerPolicy'
import { waitForDatabaseReady } from '../database/db'

type TrustedHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any

const trustedWebContentsIds = new Set<number>()

export function trustIpcSender(contents: WebContents) {
  trustedWebContentsIds.add(contents.id)
  contents.once('destroyed', () => trustedWebContentsIds.delete(contents.id))
}

export function assertTrustedIpcSender(event: IpcMainInvokeEvent) {
  const isTrustedWindow = trustedWebContentsIds.has(event.sender.id)
  const isMainFrame = event.senderFrame === event.sender.mainFrame

  if (!isTrustedWindow || !isMainFrame || event.sender.isDestroyed()) {
    throw new Error('Cerere IPC respinsă.')
  }
}

export function handleTrustedIpc(channel: string, handler: TrustedHandler) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedIpcSender(event)
    if (!isChannelAllowedForRole(getDeviceRole(), channel)) {
      throw new Error('Acest calculator este configurat doar pentru vizualizare.')
    }
    await waitForDatabaseReady()
    return handler(event, ...args)
  })
}
