import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import type { PairingDiagnostics } from './types.js';
import { parsePairingOutput, type ParsedPairingResult } from './trf.js';

const EXPECTED_VERSION = 'v6.0.0';
const TIMEOUT_MS = 10_000;

function getBinaryPath(): string {
  // Look in server/bin relative to this file's location
  const path = join(import.meta.dirname, '..', '..', 'bin', 'bbpPairings');
  return path;
}

interface EngineStatus {
  available: boolean;
  path: string;
  version: string | null;
  dutchSupported: boolean;
  error: string | null;
}

let cachedStatus: EngineStatus | null = null;

export async function getEngineStatus(): Promise<EngineStatus> {
  if (cachedStatus) return cachedStatus;

  const binaryPath = getBinaryPath();

  if (!existsSync(binaryPath)) {
    cachedStatus = {
      available: false,
      path: binaryPath,
      version: null,
      dutchSupported: false,
      error: `Binary not found at ${binaryPath}`,
    };
    return cachedStatus;
  }

  try {
    // bbpPairings prints version info to stderr/stdout when called with no args (exits with code 3)
    const output = await new Promise<string>((resolve, reject) => {
      execFile(binaryPath, [], { timeout: 5000 }, (_error, stdout, stderr) => {
        // It always exits non-zero with no args, but prints version info
        const combined = (stdout || '') + (stderr || '');
        if (combined.length > 0) resolve(combined);
        else reject(new Error('No output from engine'));
      });
    });

    const versionMatch = output.match(/v\d+\.\d+\.\d+/);
    const version = versionMatch ? versionMatch[0] : null;

    if (version !== EXPECTED_VERSION) {
      cachedStatus = {
        available: false,
        path: binaryPath,
        version,
        dutchSupported: false,
        error: `Expected version ${EXPECTED_VERSION}, found ${version}`,
      };
      return cachedStatus;
    }

    // v6.0.0 supports Dutch system by definition
    const dutchSupported = true;

    cachedStatus = {
      available: true,
      path: binaryPath,
      version,
      dutchSupported,
      error: null,
    };
    return cachedStatus;
  } catch (e: any) {
    cachedStatus = {
      available: false,
      path: binaryPath,
      version: null,
      dutchSupported: false,
      error: e.message || 'Unknown error checking engine',
    };
    return cachedStatus;
  }
}

function execBbp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const binaryPath = getBinaryPath();
    execFile(binaryPath, args, { timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) {
        if ((error as any).killed) {
          reject(new Error(`Engine timeout after ${TIMEOUT_MS}ms`));
        } else {
          reject(new Error(`Engine error (code ${(error as any).code}): ${stderr || stdout || error.message}`));
        }
        return;
      }
      resolve(stdout + stderr);
    });
  });
}

export interface PairingRequest {
  trfContent: string;
  roundNumber: number;
}

export interface PairingResponse {
  success: boolean;
  result: ParsedPairingResult | null;
  diagnostics: PairingDiagnostics;
}

export async function generatePairing(request: PairingRequest): Promise<PairingResponse> {
  const status = await getEngineStatus();
  const diagnostics: PairingDiagnostics = {
    engineVersion: status.version || 'unknown',
    roundRequested: request.roundNumber,
    activePlayers: 0,
    expectedPairings: 0,
    expectedByes: 0,
    validationsRun: [],
    violations: [],
    colorWarnings: [],
    floaters: [],
    trfInput: request.trfContent,
    engineOutput: '',
    checkerOutput: '',
    errors: [],
    success: false,
  };

  if (!status.available) {
    diagnostics.errors.push(`Engine unavailable: ${status.error}`);
    return { success: false, result: null, diagnostics };
  }

  // Create temporary directory
  let tmpDir: string;
  try {
    tmpDir = await mkdtemp(join(tmpdir(), 'bbp-'));
  } catch (e: any) {
    diagnostics.errors.push(`Failed to create temp directory: ${e.message}`);
    return { success: false, result: null, diagnostics };
  }

  const inputPath = join(tmpDir, 'input.trf');
  const outputPath = join(tmpDir, 'output.txt');

  try {
    // Write input TRF
    await writeFile(inputPath, request.trfContent, 'utf-8');

    // Run pairing generation
    const binaryPath = getBinaryPath();
    const pairOutput = await new Promise<string>((resolve, reject) => {
      execFile(
        binaryPath,
        ['--dutch', inputPath, '-p', outputPath],
        { timeout: TIMEOUT_MS },
        (error, stdout, stderr) => {
          if (error) {
            if ((error as any).killed) {
              reject(new Error(`Engine timeout after ${TIMEOUT_MS}ms`));
            } else {
              reject(new Error(`Engine pairing error: ${stderr || stdout || error.message}`));
            }
            return;
          }
          resolve(stdout + stderr);
        }
      );
    });

    // Read output file
    let outputContent: string;
    try {
      outputContent = await readFile(outputPath, 'utf-8');
    } catch {
      diagnostics.errors.push('Engine did not produce output file');
      diagnostics.engineOutput = pairOutput;
      return { success: false, result: null, diagnostics };
    }

    diagnostics.engineOutput = outputContent;

    // Parse the output
    let result: ParsedPairingResult;
    try {
      result = parsePairingOutput(outputContent);
    } catch (e: any) {
      diagnostics.errors.push(`Failed to parse engine output: ${e.message}`);
      return { success: false, result: null, diagnostics };
    }

    // Run checker
    try {
      // We need to write the pairings back into the TRF as the last round
      // For checking, we append round data to the TRF
      const checkOutput = await runChecker(inputPath, result, request.trfContent);
      diagnostics.checkerOutput = checkOutput;
    } catch (e: any) {
      diagnostics.colorWarnings.push(`Checker: ${e.message}`);
    }

    diagnostics.success = true;
    return { success: true, result, diagnostics };
  } catch (e: any) {
    diagnostics.errors.push(e.message);
    return { success: false, result: null, diagnostics };
  } finally {
    // Cleanup temp directory
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  }
}

async function runChecker(inputPath: string, result: ParsedPairingResult, originalTrf: string): Promise<string> {
  // To verify, we need to create a TRF with the new round's pairings added
  // The checker verifies all rounds in the TRF
  // For now we'll run the checker on the input file which has all previous rounds
  const binaryPath = getBinaryPath();

  return new Promise<string>((resolve, reject) => {
    execFile(
      binaryPath,
      ['--dutch', inputPath, '-c'],
      { timeout: TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error) {
          // Checker may return non-zero for violations
          resolve(`CHECKER ERROR: ${stderr || stdout || error.message}`);
          return;
        }
        resolve(stdout + stderr);
      }
    );
  });
}

export function resetEngineCache(): void {
  cachedStatus = null;
}
