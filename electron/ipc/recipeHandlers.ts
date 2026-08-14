import { recipeRepo } from '../database/repositories/recipeRepo';
import { handleTrustedIpc } from './trustedHandler';

export function registerRecipeHandlers() {
  handleTrustedIpc('get-recipe', (_, productId: number) => {
    return recipeRepo.getByProductId(productId);
  });

  handleTrustedIpc('save-recipe', (_, productId: number, batchSize: number, notes: string, items: any[]) => {
    return recipeRepo.saveRecipe(productId, batchSize, notes, items);
  });
}
