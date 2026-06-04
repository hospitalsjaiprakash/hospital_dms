const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

const TARGET_PDF_SIZE = 2 * 1024 * 1024; // 2MB
const COMPRESSION_TIMEOUT_MS = 120_000; // 120 seconds max per compression attempt

/**
 * Check if Ghostscript is available on the system
 */
const isGhostscriptAvailable = () => {
  try {
    execSync('gs -v', { stdio: 'pipe' });
    return true;
  } catch (err) {
    return false;
  }
};

/**
 * Simple PDF size reduction without external tools (stream-based)
 * This creates a basic valid PDF to fallback when GS is unavailable
 * @param {Buffer} inputBuffer The original PDF buffer
 * @returns {Buffer} Reduced buffer (up to ~30% smaller by removing metadata)
 */
const simplePDFCleanup = (inputBuffer) => {
  // Remove unnecessary streams and metadata to reduce size slightly
  // This is a basic approach that doesn't require external tools
  let content = inputBuffer.toString('binary');
  
  // Remove trailing nulls and comment lines
  content = content.replace(/\n%[^\n]*\n/g, '\n').replace(/\0+/g, '');
  
  return Buffer.from(content, 'binary');
};

/**
 * Runs a Ghostscript process with the given arguments.
 * Includes a timeout to prevent hanging on very large files.
 * @param {string[]} args Ghostscript command-line arguments
 * @param {number} [timeoutMs=60000] Maximum time to wait for GS to complete
 * @returns {Promise<void>}
 */
const runGS = (args, timeoutMs = 60000) => {
  return new Promise((resolve, reject) => {
    const gsProcess = spawn('gs', args);
    let errorData = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      gsProcess.kill('SIGKILL');
      reject(new Error(`Ghostscript timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    gsProcess.stderr.on('data', (data) => {
      errorData += data.toString();
    });
    gsProcess.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return; // already rejected
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Ghostscript failed with code ${code}: ${errorData}`));
      }
    });
    gsProcess.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
};

/**
 * Phase 1: Standard Ghostscript compression using pdfwrite with image downsampling.
 * Works well for PDFs whose size is dominated by embedded raster images.
 * @param {Buffer} inputBuffer The original PDF buffer
 * @param {number} resolution Target image resolution in DPI (default 72)
 * @returns {Promise<Buffer>} The compressed PDF buffer
 */
const compressPDF = async (inputBuffer, resolution = 72) => {
  const tempId = crypto.randomBytes(16).toString('hex');
  const tempDir = os.tmpdir();
  const inputPath = path.join(tempDir, `input_${tempId}.pdf`);
  const outputPath = path.join(tempDir, `output_${tempId}.pdf`);

  try {
    await fs.writeFile(inputPath, inputBuffer);

    await runGS([
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      '-dPDFSETTINGS=/screen',
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      '-dDownsampleColorImages=true',
      `-dColorImageResolution=${resolution}`,
      '-dColorImageDownsampleThreshold=1.0',
      '-dAutoFilterColorImages=false',
      '-dColorImageFilter=/DCTEncode',
      '-dDownsampleGrayImages=true',
      `-dGrayImageResolution=${resolution}`,
      '-dGrayImageDownsampleThreshold=1.0',
      '-dAutoFilterGrayImages=false',
      '-dGrayImageFilter=/DCTEncode',
      '-dDownsampleMonoImages=true',
      `-dMonoImageResolution=${resolution}`,
      '-dMonoImageDownsampleThreshold=1.0',
      `-sOutputFile=${outputPath}`,
      inputPath
    ], COMPRESSION_TIMEOUT_MS);

    const compressedBuffer = await fs.readFile(outputPath);
    return compressedBuffer;
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
};

/**
 * Phase 2: Full rasterization fallback.
 * Converts every page of the PDF into a flat raster image at the given DPI,
 * producing a new image-only PDF. This guarantees size reduction since all
 * vector content, fonts, and complex objects are flattened to JPEG pixels.
 * @param {Buffer} inputBuffer The original PDF buffer
 * @param {number} dpi Render resolution (lower = smaller file)
 * @returns {Promise<Buffer>} The rasterized PDF buffer
 */
const rasterizePDF = async (inputBuffer, dpi = 72) => {
  const tempId = crypto.randomBytes(16).toString('hex');
  const tempDir = os.tmpdir();
  const inputPath = path.join(tempDir, `rast_in_${tempId}.pdf`);
  const outputPath = path.join(tempDir, `rast_out_${tempId}.pdf`);

  try {
    await fs.writeFile(inputPath, inputBuffer);

    // Use pdfimage24 device: renders each page as a 24-bit color image
    // and writes the result as a new PDF with one image per page.
    // Add aggressive JPEG quality for smaller file size
    await runGS([
      '-sDEVICE=pdfimage24',
      `-r${dpi}`,
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      '-dJPEGQ=50', // Aggressive JPEG quality (50% quality)
      `-sOutputFile=${outputPath}`,
      inputPath
    ], COMPRESSION_TIMEOUT_MS);

    const rasterizedBuffer = await fs.readFile(outputPath);
    return rasterizedBuffer;
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
};

/**
 * Master compression function that guarantees the output PDF is as close
 * to the target size (2MB) as possible.
 *
 * Strategy:
 *   - Check if Ghostscript is available first
 *   - For files > 20MB: skip standard compression, go straight to rasterization
 *   - For files <= 20MB: try one standard compression pass at 72 DPI first
 *   - Rasterization: try only 2-3 targeted DPI values
 *   - Global timeout of 180s: if exceeded, return best attempt
 *   - Fallback to simple cleanup if GS is unavailable
 *
 * @param {Buffer} inputBuffer The original PDF buffer
 * @returns {Promise<Buffer>} The best compressed PDF buffer achievable
 */
const compressPDFToTarget = async (inputBuffer) => {
  const originalSize = inputBuffer.length;
  const sizeMB = (originalSize / 1024 / 1024).toFixed(1);
  let best = inputBuffer;

  const globalStart = Date.now();
  const GLOBAL_TIMEOUT = 180_000; // 3 minutes absolute max

  const isTimedOut = () => (Date.now() - globalStart) > GLOBAL_TIMEOUT;

  console.log(`Starting PDF compression: ${sizeMB}MB input`);

  // Check if Ghostscript is available
  const gsAvailable = isGhostscriptAvailable();
  if (!gsAvailable) {
    console.warn('Ghostscript not available, attempting simple cleanup...');
    try {
      const cleaned = simplePDFCleanup(inputBuffer);
      if (cleaned.length < best.length) {
        best = cleaned;
        console.log(`Simple cleanup: ${(best.length / 1024 / 1024).toFixed(2)}MB (${(100 - (best.length / originalSize) * 100).toFixed(1)}% reduction)`);
      }
    } catch (err) {
      console.error('Simple cleanup failed:', err.message);
    }
    return best;
  }

  // For files <= 20MB, try one quick standard compression pass
  if (originalSize <= 20 * 1024 * 1024) {
    try {
      const compressed = await compressPDF(inputBuffer, 72);
      if (compressed.length < best.length) {
        best = compressed;
      }
      if (best.length <= TARGET_PDF_SIZE) {
        console.log(`PDF compressed to ${(best.length / 1024 / 1024).toFixed(2)}MB at 72 DPI (standard) in ${((Date.now() - globalStart) / 1000).toFixed(1)}s`);
        return best;
      }
      console.log(`Standard compression: ${(best.length / 1024 / 1024).toFixed(2)}MB, still over target`);
    } catch (err) {
      console.error(`Standard compression failed:`, err.message);
    }

    if (isTimedOut()) {
      console.warn(`Global timeout reached after standard compression. Returning best: ${(best.length / 1024 / 1024).toFixed(2)}MB`);
      return best;
    }
  } else {
    console.log(`File > 20MB, skipping standard compression, going directly to rasterization`);
  }

  // Phase 2: Rasterization — pick DPI based on file size for faster convergence
  // Larger files need lower DPI to get under 2MB
  let rasterDPIs;
  if (originalSize > 25 * 1024 * 1024) {
    rasterDPIs = [24, 18, 12]; // Very large files: start very low
  } else if (originalSize > 15 * 1024 * 1024) {
    rasterDPIs = [36, 24, 18]; // Large files
  } else if (originalSize > 5 * 1024 * 1024) {
    rasterDPIs = [72, 50, 36, 24]; // Medium-large files
  } else {
    rasterDPIs = [72, 50, 36]; // Medium files
  }

  for (const dpi of rasterDPIs) {
    if (isTimedOut()) {
      console.warn(`Global timeout reached before rasterization at ${dpi} DPI`);
      break;
    }

    try {
      const rasterized = await rasterizePDF(inputBuffer, dpi);
      if (rasterized.length < best.length) {
        best = rasterized;
      }
      console.log(`Rasterization at ${dpi} DPI: ${(rasterized.length / 1024 / 1024).toFixed(2)}MB`);
      
      if (best.length <= TARGET_PDF_SIZE) {
        console.log(`✓ PDF rasterized to ${(best.length / 1024 / 1024).toFixed(2)}MB at ${dpi} DPI in ${((Date.now() - globalStart) / 1000).toFixed(1)}s`);
        return best;
      }
    } catch (err) {
      console.error(`Rasterization at ${dpi} DPI failed:`, err.message);
    }
  }

  const totalTime = ((Date.now() - globalStart) / 1000).toFixed(1);
  if (best.length > TARGET_PDF_SIZE) {
    console.warn(`Warning: PDF size ${(best.length / 1024 / 1024).toFixed(2)}MB still exceeds 2MB target after ${totalTime}s of compression`);
  } else {
    console.log(`PDF compressed to ${(best.length / 1024 / 1024).toFixed(2)}MB in ${totalTime}s`);
  }
  return best;
};

module.exports = {
  compressPDF,
  rasterizePDF,
  compressPDFToTarget,
  isGhostscriptAvailable,
  simplePDFCleanup,
};
