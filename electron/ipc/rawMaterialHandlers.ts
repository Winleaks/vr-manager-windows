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

  ipcMain.handle('add-category', (event, name, type) => {
    return repo.addCategory(name, type)
  })

  ipcMain.handle('update-category', (event, id, name) => {
    return repo.updateCategory(id, name)
  })

  ipcMain.handle('delete-category', (event, id) => {
    return repo.deleteCategory(id)
  })
}

