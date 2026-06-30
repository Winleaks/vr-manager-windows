import { ipcMain } from 'electron'
import * as repo from '../repositories/rawMaterialRepo'

export function registerRawMaterialHandlers() {
  ipcMain.handle('get-raw-materials', () => {
    return repo.getAllRawMaterials()
  })

  ipcMain.handle('add-raw-material', (event, rm) => {
    return repo.addRawMaterial(rm)
  })

  ipcMain.handle('update-raw-material', (event, id, rm) => {
    return repo.updateRawMaterial(id, rm)
  })

  ipcMain.handle('get-categories', (event, type) => {
    return repo.getCategories(type)
  })
}
