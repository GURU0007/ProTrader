/**
 * deploy.js - ProTrader GitHub Pages Deployment Script
 * 
 * Creates a clean temporary directory with only frontend files
 * and force-pushes to the gh-pages branch.
 * 
 * Usage: node deploy.js
 *   or:  npm run deploy
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_URL = 'https://github.com/GURU0007/ProTrader.git';
const FILES_TO_DEPLOY = ['index.html', 'app.js', 'styles.css'];

const rootDir = __dirname;
const tempDir = path.join(os.tmpdir(), `protrader-deploy-${Date.now()}`);

function run(cmd, cwd = tempDir) {
    console.log(`  > ${cmd}`);
    execSync(cmd, { cwd, stdio: 'inherit' });
}

try {
    console.log('\n🚀 ProTrader GitHub Pages Deployment\n');

    // 1. Commit any pending changes in main repo
    console.log('📦 Committing any pending changes...');
    try {
        execSync('git add -A', { cwd: rootDir, stdio: 'inherit' });
        execSync('git diff --cached --quiet', { cwd: rootDir });
        console.log('  Nothing to commit.\n');
    } catch {
        execSync('git commit -m "chore: pre-deploy commit"', { cwd: rootDir, stdio: 'inherit' });
        execSync('git push origin main', { cwd: rootDir, stdio: 'inherit' });
        console.log('  Committed and pushed to main.\n');
    }

    // 2. Create temp dir with only frontend files
    console.log('📁 Preparing deployment files...');
    fs.mkdirSync(tempDir, { recursive: true });

    for (const file of FILES_TO_DEPLOY) {
        const src = path.join(rootDir, file);
        const dest = path.join(tempDir, file);
        fs.copyFileSync(src, dest);
        console.log(`  Copied: ${file}`);
    }

    // Create .nojekyll (prevents GitHub from ignoring underscore files)
    fs.writeFileSync(path.join(tempDir, '.nojekyll'), '');
    console.log('  Created: .nojekyll\n');

    // 3. Initialize git and push to gh-pages
    console.log('🌐 Pushing to gh-pages branch...');
    run('git init');
    run('git checkout -b gh-pages');
    run('git add .');
    run('git commit -m "deploy: ProTrader serverless build"');
    run(`git remote add origin ${REPO_URL}`);
    run('git push -f origin gh-pages');

    // 4. Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });

    console.log('\n✅ Deployment successful!');
    console.log('🔗 Live at: https://guru0007.github.io/ProTrader/');
    console.log('\n⏱️  GitHub Pages usually takes ~30-60 seconds to update.\n');

} catch (err) {
    console.error('\n❌ Deployment failed:', err.message);
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    process.exit(1);
}
