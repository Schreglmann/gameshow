const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// Audio directories
const audioDirs = ['./audio', './audio-guess'];

// Recursively get all audio files from a directory
const getAudioFilesRecursive = (dir) => {
    let audioFiles = [];
    
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
            // Skip backup directories
            if (item === 'backup') {
                continue;
            }
            // Recursively scan subdirectories
            audioFiles = audioFiles.concat(getAudioFilesRecursive(fullPath));
        } else if (stat.isFile()) {
            const ext = path.extname(item).toLowerCase();
            // Skip temp files
            if (item.startsWith('temp_')) {
                continue;
            }
            if (['.m4a', '.mp3', '.opus'].includes(ext)) {
                audioFiles.push(fullPath);
            }
        }
    }
    
    return audioFiles;
};

// Clean up temp files recursively
const cleanupTempFiles = (dir) => {
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
            // Skip backup directories
            if (item === 'backup') {
                continue;
            }
            // Recursively clean subdirectories
            cleanupTempFiles(fullPath);
        } else if (stat.isFile() && item.startsWith('temp_')) {
            fs.unlinkSync(fullPath);
            console.log(`  Removed leftover temp file: ${fullPath}`);
        }
    }
};

// Normalize a single audio file
const normalizeAudio = (filePath) => {
    return new Promise((resolve, reject) => {
        const filename = path.basename(filePath);
        const fileDir = path.dirname(filePath);
        
        // Find the root audio directory (audio or audio-guess)
        // Normalize paths for comparison
        const normalizedPath = filePath.replace(/\\/g, '/');
        let rootDir = null;
        
        for (const dir of audioDirs) {
            const normalizedDir = dir.replace(/^\.\//, '').replace(/\\/g, '/');
            if (normalizedPath.startsWith(normalizedDir + '/') || normalizedPath.startsWith('./' + normalizedDir + '/')) {
                rootDir = dir;
                break;
            }
        }
        
        if (!rootDir) {
            console.error(`Could not determine root directory for ${filePath}`);
            reject(new Error('Root directory not found'));
            return;
        }
        
        // Calculate relative path from root directory
        const relativePath = path.relative(rootDir, filePath);
        const relativeDir = path.dirname(relativePath);
        
        // Create backup path in root/backup/relative-path
        const backupDir = path.join(rootDir, 'backup', relativeDir);
        const backupPath = path.join(backupDir, filename);
        
        // Skip if already normalized (backup exists)
        if (fs.existsSync(backupPath)) {
            console.log(`Skipping: ${filePath} (already normalized)\n`);
            resolve();
            return;
        }
        
        console.log(`Normalizing: ${filePath}`);
        
        // Create backup directory structure
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        // Backup original file
        fs.copyFileSync(filePath, backupPath);
        console.log(`  ✓ Backed up to ${backupPath}`);
        
        // Create temp file in the same directory as original
        // For .opus files, convert to .m4a format
        const isOpus = path.extname(filename).toLowerCase() === '.opus';
        const outputFilename = isOpus ? filename.replace(/\.opus$/i, '.m4a') : filename;
        const outputPath = isOpus ? path.join(fileDir, outputFilename) : filePath;
        const tempPath = path.join(fileDir, `temp_${outputFilename}`);
        
        // Normalize audio to -16 LUFS with loudnorm filter
        ffmpeg(filePath)
            .audioFilters('loudnorm=I=-16:LRA=11:TP=-1.5')
            .audioCodec('aac')
            .audioBitrate('192k')
            .on('end', () => {
                // Replace original with normalized version
                fs.renameSync(tempPath, outputPath);
                
                // If we converted opus to m4a, remove the original opus file
                if (isOpus && outputPath !== filePath) {
                    fs.unlinkSync(filePath);
                    console.log(`  ✓ Converted to .m4a and normalized successfully\n`);
                } else {
                    console.log(`  ✓ Normalized successfully\n`);
                }
                resolve();
            })
            .on('error', (err) => {
                console.error(`  ✗ Error normalizing ${filePath}:`, err.message);
                reject(err);
            })
            .save(tempPath);
    });
};

// Main function
const main = async () => {
    console.log('Starting audio normalization...\n');
    
    // Clean up any leftover temp files from previous failed runs
    console.log('Cleaning up temp files...');
    for (const dir of audioDirs) {
        if (fs.existsSync(dir)) {
            cleanupTempFiles(dir);
        }
    }
    console.log('');
    
    let allAudioFiles = [];
    let stats = {
        normalized: 0,
        skipped: 0,
        errors: 0
    };
    
    // Collect audio files from all directories
    for (const dir of audioDirs) {
        if (fs.existsSync(dir)) {
            const files = getAudioFilesRecursive(dir);
            allAudioFiles = allAudioFiles.concat(files);
            console.log(`Found ${files.length} audio files in ${dir}`);
        } else {
            console.log(`Directory ${dir} not found, skipping...`);
        }
    }
    
    if (allAudioFiles.length === 0) {
        console.log('\nNo audio files found in any directory.');
        return;
    }
    
    console.log(`\nTotal: ${allAudioFiles.length} audio files to process.\n`);
    
    for (const filePath of allAudioFiles) {
        try {
            // Check if already normalized before processing
            const filename = path.basename(filePath);
            const fileDir = path.dirname(filePath);
            const normalizedPath = filePath.replace(/\\/g, '/');
            let rootDir = null;
            
            for (const dir of audioDirs) {
                const normalizedDir = dir.replace(/^\.\//, '').replace(/\\/g, '/');
                if (normalizedPath.startsWith(normalizedDir + '/') || normalizedPath.startsWith('./' + normalizedDir + '/')) {
                    rootDir = dir;
                    break;
                }
            }
            
            if (rootDir) {
                const relativePath = path.relative(rootDir, filePath);
                const relativeDir = path.dirname(relativePath);
                const backupDir = path.join(rootDir, 'backup', relativeDir);
                const backupPath = path.join(backupDir, filename);
                
                if (fs.existsSync(backupPath)) {
                    stats.skipped++;
                } else {
                    await normalizeAudio(filePath);
                    stats.normalized++;
                }
            } else {
                await normalizeAudio(filePath);
                stats.normalized++;
            }
        } catch (err) {
            console.error(`Failed to normalize ${filePath}, continuing with next file...`);
            stats.errors++;
        }
    }
    
    console.log('Audio normalization complete!');
    console.log(`Original files backed up to respective backup/ folders in each audio directory\n`);
    console.log('📊 Summary:');
    console.log(`  ✓ Normalized: ${stats.normalized} files`);
    console.log(`  ⊘ Skipped: ${stats.skipped} files (already normalized)`);
    console.log(`  ✗ Errors: ${stats.errors} files\n`);
};

// Run the script
main().catch(console.error);
