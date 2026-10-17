import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export type ContentBuild = { schema: number; buildId: string; revision: string; native: string; support: string;
  webUrl: string; verified: boolean; builtAt: string; verifiedAt?: string; sourceCommit: string; engineCommit: string;
  browserHostCommit: string; browserFrontendCommit: string; verification?: { passed: boolean; targets: string[]; scope: string } };

/** The pointer is promoted only after native and browser acceptance pass. */
export function localContentBuild(webRoot: string): ContentBuild | null {
  const pointer = resolve(webRoot, '../RTSAI-Mod/.recovery/content-current.json');
  if (!existsSync(pointer)) return null;
  const ref = JSON.parse(readFileSync(pointer, 'utf8')) as { receipt: string; sha256: string };
  const bytes = readFileSync(ref.receipt);
  if (createHash('sha256').update(bytes).digest('hex') !== ref.sha256) throw Error('Local build receipt changed; rebuild before launching.');
  const build = JSON.parse(bytes.toString('utf8')) as ContentBuild;
  if (!build.verified || !build.verification?.passed || build.verification.targets.length !== 4) throw Error('All four content targets must pass before launch.');
  return build;
}

export function contentCodeCurrent(webRoot: string, build: ContentBuild) {
  try {
    for (const [repo, commit, paths] of [
      ['../RTSAI-Mod', build.sourceCommit, ['OpenRA.Mods.RA2', 'OpenRA.Mods.RTSAI', 'mods']],
      ['../OpenRA', build.engineCommit, []],
      ['../RTSAI-WebGame', build.browserHostCommit, ['sim/OpenRA.WebSim', 'sim/OpenRA.WebSim.Browser', 'sim/OpenRA.Mods.RA2', 'sim/OpenRA.Mods.RTSAI']],
    ] as [string, string, string[]][]) {
      execFileSync('git', ['diff', '--quiet', commit, 'HEAD', '--', ...paths], { cwd: resolve(webRoot, repo), windowsHide: true });
    }
    return true;
  } catch { return false; }
}

export function contentInterfaceCurrent(webRoot: string, build: ContentBuild) {
  try {
    execFileSync('git', ['diff', '--quiet', build.browserFrontendCommit, 'HEAD', '--', 'web', 'server'], { cwd: resolve(webRoot, '../RTSAI-WebGame'), windowsHide: true });
    return true;
  } catch { return false; }
}
