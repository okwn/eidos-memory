import fs from 'fs';
import path from 'path';
import { getProjectRoot, resetDbInstance, closeDb } from '../../store/db.js';

export async function clearCommand(): Promise<void> {
  const projectRoot = getProjectRoot();
  const eidosDir = path.join(projectRoot, '.eidos');

  if (!fs.existsSync(eidosDir)) {
    console.log(`[eidos] No .eidos directory found in ${projectRoot}. Nothing to clear.`);
    return;
  }

  // Close any open DB connection first
  closeDb();
  resetDbInstance();

  // Remove the .eidos directory
  fs.rmSync(eidosDir, { recursive: true, force: true });
  console.log(`[eidos] Memory cleared for ${projectRoot}`);
  console.log(`[eidos] Next run will auto-index the project.`);
}
