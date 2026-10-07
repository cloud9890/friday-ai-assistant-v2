/* ==========================================================================
   F.R.I.D.A.Y. // SERVER LIB — SHARED PATH RESOLUTION (verbatim from vite-plugin-os.js)
   ========================================================================== */

import fs from 'fs';
import path from 'path';
import os from 'os';

export const homeDir = os.homedir();
// Support both standard Desktop and OneDrive Desktop paths
export let desktopDir = path.join(homeDir, 'Desktop');
if (!fs.existsSync(desktopDir) && fs.existsSync(path.join(homeDir, 'OneDrive', 'Desktop'))) {
  desktopDir = path.join(homeDir, 'OneDrive', 'Desktop');
}
export let documentsDir = path.join(homeDir, 'Documents');
if (!fs.existsSync(documentsDir) && fs.existsSync(path.join(homeDir, 'OneDrive', 'Documents'))) {
  documentsDir = path.join(homeDir, 'OneDrive', 'Documents');
}
