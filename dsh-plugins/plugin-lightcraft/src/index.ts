/**
 * LightCraft as a DSH plugin.
 *
 * Registers model-callable tools that drive the `lightcraft-cli` binary this machine
 * already has — both its generic `--cmd` surface and its own MCP server. The
 * LightCraft source tree is never touched: the CLI is an external process,
 * located at call time so installing it mid-session works.
 * @module @dsh-artcraft/plugin-lightcraft
 */

import type { Context } from '@deepseek-ai/cordis'
import { applyCraftPlugin, profileOf } from '@dsh-artcraft/craft-kit'
import type { CraftPluginConfig } from '@dsh-artcraft/craft-kit'
import { PLUGIN_ROOT } from './root.ts'

export const name = 'dsh-artcraft-lightcraft'
export const inject = ['tools', 'systemPrompt']

/** The craft this plugin exposes. */
export const craft = profileOf('lightcraft')

/** Configuration is the shared craft config. */
export type Config = CraftPluginConfig

export function apply(ctx: Context, config: Config = {}): void {
  if (craft === undefined) throw new Error('dsh-artcraft-lightcraft: profile "lightcraft" is missing from craft-kit')
  ctx.effect(() => applyCraftPlugin(ctx, { profile: craft, packageRoot: PLUGIN_ROOT, config }))
}
