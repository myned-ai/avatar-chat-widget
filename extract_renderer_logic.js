
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, 'node_modules', '@myned-ai', 'gsplat-flame-avatar-renderer', 'dist', 'gsplat-flame-avatar-renderer.esm.js');
const content = fs.readFileSync(filePath, 'utf8');

const searchString = 'Disallowed protocol';
const index = content.indexOf(searchString);

if (index === -1) {
    console.log('Error string NOT FOUND in renderer build.');
} else {
    // Extract 20 lines before and after
    const start = Math.max(0, index - 1000);
    const end = Math.min(content.length, index + 1000);
    const context = content.substring(start, end);
    fs.writeFileSync('renderer_debug.txt', context);
    console.log('Context written to renderer_debug.txt');
}
