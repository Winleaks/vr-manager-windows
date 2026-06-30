import { ipcMain } from 'electron';
import { recipeRepo } from '../database/repositories/recipeRepo';

export function registerRecipeHandlers() {
  ipcMain.handle('get-recipe', (_, productId: number) => {
    return recipeRepo.getByProductId(productId);
  });

  ipcMain.handle('save-recipe', (_, productId: number, batchSize: number, notes: string, items: any[]) => {
    return recipeRepo.saveRecipe(productId, batchSize, notes, items);
  });
}
