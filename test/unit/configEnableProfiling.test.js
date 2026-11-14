/**
 * `enableProfiling` in avenx.config.json (issue #1751).
 *
 * The configuration reference documents `enableProfiling` as a top-level
 * option, but the loader rejected it as unknown — and printed that warning
 * twice per build, because the CLI and the compiler each load the
 * configuration. This tests all three parts of the fix:
 *
 * 1. `enableProfiling` is accepted by the loader (and defaults to false, and
 *    must be a boolean), with no unknown-option warning.
 * 2. An unknown option is warned about exactly once per key, however many
 *    times the same unchanged configuration is loaded.
 * 3. A build with `enableProfiling: true` carries the option into the bundle:
 *    the generated entry prelude sets `window.__avenx_enable_profiling`, the
 *    flag the profiler already reads — so profiling is enabled project-wide
 *    without passing the option to `new AvenxApp()` by hand.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Set env to test so that loadConfig throws validation errors instead of process.exit
process.env.NODE_ENV = 'test';

import loadConfig from '../../lib/config.js';
import AvenxCompiler from '../../lib/compiler.js';
import { profilingConfigModule } from '../../lib/compiler/modules.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

try {
  console.log('🧪 Testing enableProfiling config option (#1751)...');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-1751-'));
  const configPath = path.join(tmpRoot, 'avenx.config.json');
  const srcDir = path.join(tmpRoot, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(
    path.join(srcDir, 'main.app.js'),
    "import { AvenxApp } from 'avenx-core/runtime';\nconst app = new AvenxApp({ target: '#app' });\n",
    'utf8',
  );

  function writeConfig(obj) {
    fs.writeFileSync(configPath, JSON.stringify(obj), 'utf8');
  }

  const warnings = [];
  const originalWarn = logger.warn;
  logger.warn = (...args) => {
    warnings.push(args.join(' '));
  };

  try {
    // 1. The documented option is accepted: no warning, value kept.
    writeConfig({ enableProfiling: true });
    const enabled = loadConfig(tmpRoot);
    assert.strictEqual(enabled.enableProfiling, true, 'enableProfiling: true must be kept');
    assert.ok(
      !warnings.some((w) => w.includes('enableProfiling')),
      `enableProfiling must not warn: ${warnings.join(' | ')}`,
    );
    warnings.length = 0;

    // Default is off, and a non-boolean is rejected like the other booleans.
    writeConfig({});
    const defaults = loadConfig(tmpRoot);
    assert.strictEqual(defaults.enableProfiling, false, 'enableProfiling must default to false');
    writeConfig({ enableProfiling: 'yes' });
    assert.throws(() => loadConfig(tmpRoot), /enableProfiling must be a boolean/);
    warnings.length = 0;

    // 2. One unknown key warns exactly once, however many times the same
    // unchanged configuration is loaded (the CLI and the compiler each load
    // it once per build — that used to print the warning twice).
    writeConfig({ enableProfilingg: true });
    loadConfig(tmpRoot);
    loadConfig(tmpRoot);
    loadConfig(tmpRoot);
    const unknownWarnings = warnings.filter((w) => w.includes('"enableProfilingg"'));
    assert.strictEqual(
      unknownWarnings.length,
      1,
      `one unknown key must warn exactly once across repeated loads, got ${unknownWarnings.length}: ${warnings.join(' | ')}`,
    );
    warnings.length = 0;

    // ... and a different unknown key still warns once, on its own.
    writeConfig({ enableProfilingg: true, bogusOption: 1 });
    loadConfig(tmpRoot);
    loadConfig(tmpRoot);
    assert.strictEqual(
      warnings.filter((w) => w.includes('"enableProfilingg"')).length,
      1,
      'the first unknown key must still warn once after the file changes',
    );
    assert.strictEqual(
      warnings.filter((w) => w.includes('"bogusOption"')).length,
      1,
      'a second unknown key must warn once too',
    );
    warnings.length = 0;

    // 3. The option reaches the bundle: the generated prelude sets the flag
    // the profiler reads, and only when the option is on.
    const moduleSource = profilingConfigModule();
    assert.ok(
      moduleSource.includes('window.__avenx_enable_profiling = true'),
      'the profiling module must set the runtime flag',
    );

    writeConfig({ enableProfiling: true });
    const compilerOn = new AvenxCompiler({
      rootDir: tmpRoot,
      srcDir: 'src',
      distDir: 'dist',
      logging: { silent: true },
    });
    const modulesOn = new Map();
    compilerOn.buildEntryModule(modulesOn, []);
    const profilingId = [...modulesOn.keys()].find((id) => id.endsWith('__avenx_profiling__.js'));
    assert.ok(profilingId, 'an enabled build must generate the profiling prelude module');
    assert.ok(
      modulesOn.get(profilingId).includes('window.__avenx_enable_profiling = true'),
      'the generated profiling module must set the runtime flag',
    );

    writeConfig({});
    const compilerOff = new AvenxCompiler({
      rootDir: tmpRoot,
      srcDir: 'src',
      distDir: 'dist',
      logging: { silent: true },
    });
    const modulesOff = new Map();
    compilerOff.buildEntryModule(modulesOff, []);
    assert.ok(
      ![...modulesOff.keys()].some((id) => id.endsWith('__avenx_profiling__.js')),
      'a build without enableProfiling must not add a profiling module',
    );
  } finally {
    logger.warn = originalWarn;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log('  ✅ enableProfiling config tests passed!');
} catch (error) {
  console.error('❌ enableProfiling config tests failed!');
  console.error(error);
  process.exit(1);
}
