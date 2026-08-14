import * as repo from '../repositories/rawMaterialRepo'
import { handleTrustedIpc } from './trustedHandler'

export function registerRawMaterialHandlers() {
  handleTrustedIpc('get-raw-materials', () => {
    return repo.getAllRawMaterials()
  })

  handleTrustedIpc('add-raw-material', (event, rm) => {
    return repo.addRawMaterial(rm)
  })

  handleTrustedIpc('update-raw-material', (event, id, rm) => {
    return repo.updateRawMaterial(id, rm)
  })

  handleTrustedIpc('get-categories', (event, type) => {
    return repo.getCategories(type)
  })

  handleTrustedIpc('add-category', (event, name, type) => {
    return repo.addCategory(name, type)
  })

  handleTrustedIpc('update-category', (event, id, name) => {
    return repo.updateCategory(id, name)
  })

  handleTrustedIpc('delete-category', (event, id) => {
    return repo.deleteCategory(id)
  })
}
