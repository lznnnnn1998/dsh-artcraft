/**
 * Which release asset to install on this machine, and where the CLI sits inside it.
 *
 * Each craft publishes its CLI in a different wrapper per platform — a dedicated
 * `-cli-` zip on macOS, but the full application archive on Windows and Linux.
 * Everything below was measured against the real release assets:
 *
 *   macOS   <craft>-cli-<v>-macos-universal.zip        → <craft>-cli
 *   Windows <craft>-<v>-windows-x64-portable.zip       → <craft>-cli.exe
 *   Linux   <craft>-<v>-linux-x86_64.tar.gz            → bin/<craft>-cli
 *
 * The tables are data, not logic, so adding a craft or a platform is a one-line
 * change and `scripts/install-craft.mjs --list` can print what would be fetched.
 * @module @dsh-artcraft/craft-kit/platform
 */

import { arch as nodeArch, platform as nodePlatform } from 'node:process'

/** A supported operating system, as Node names it. */
export type NodePlatformName = 'darwin' | 'win32' | 'linux'

/** CPU families the crafts publish builds for. */
export type NodeArchName = 'x64' | 'arm64'

/** One downloadable archive plus how to get the CLI out of it. */
export interface ReleaseTarget {
  /** Human label, e.g. `macOS (universal)`. */
  readonly label: string
  /** Returns the asset filename for a craft and version, or `undefined` when unpublished. */
  readonly asset: (craft: string, version: string) => string | undefined
  /** Predicate matching the CLI entry inside the archive. */
  readonly match: (craft: string, path: string) => boolean
  /** Archive container, which selects the extractor. */
  readonly container: 'zip' | 'tar.gz'
}

/** Written version marker beside each installed binary. */
export const VERSION_MARKER = '.version.json'

/** Target for a craft `id` (product) on `platform`/`arch`, or `undefined` when unsupported. */
export function releaseTarget(
  id: string,
  platform: NodePlatformName = nodePlatform as NodePlatformName,
  arch: NodeArchName = nodeArch as NodeArchName,
): ReleaseTarget | undefined {
  if (platform === 'darwin') {
    // One universal build covers Intel and Apple silicon.
    return {
      label: 'macOS (universal)',
      asset: (craft, version) => `${craft}-cli-${version}-macos-universal.zip`,
      // Release archives wrap everything in a versioned directory, so match on
      // the final segment rather than the whole path.
      match: (craft, path) => path === `${craft}-cli` || path.endsWith(`/${craft}-cli`),
      container: 'zip',
    }
  }
  if (platform === 'win32') {
    if (arch !== 'x64' && arch !== 'arm64') return undefined
    return {
      label: `Windows ${arch} (portable)`,
      asset: (craft, version) => `${craft}-${version}-windows-${arch}-portable.zip`,
      match: (craft, path) => path.endsWith(`${craft}-cli.exe`),
      container: 'zip',
    }
  }
  if (platform === 'linux') {
    if (arch !== 'x64' && arch !== 'arm64') return undefined
    return {
      label: `Linux ${arch} (tarball)`,
      // riscv64 builds exist for some crafts but are not a Node platform here.
      asset: (craft, version) => `${craft}-${version}-linux-${arch === 'x64' ? 'x86_64' : 'aarch64'}.tar.gz`,
      match: (craft, path) => path === `bin/${craft}-cli` || path.endsWith(`/${craft}-cli`),
      container: 'tar.gz',
    }
  }
  return undefined
}

/** The executable name a craft's CLI has on this platform. */
export function binaryName(craft: string, platform: NodePlatformName = nodePlatform as NodePlatformName): string {
  return platform === 'win32' ? `${craft}-cli.exe` : `${craft}-cli`
}
