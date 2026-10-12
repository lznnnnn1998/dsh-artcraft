/**
 * WordCraft as a DSH plugin.
 *
 * Registers model-callable tools that drive the `wordcraft-cli` binary this machine
 * already has — both its generic `--cmd` surface and its own MCP server. The
 * WordCraft source tree is never touched: the CLI is an external process,
 * located at call time so installing it mid-session works.
 * @module @dsh-artcraft/plugin-wordcraft
 */

import type { Context } from '@deepseek-ai/cordis'
import { applyCraftPlugin, profileOf } from '@dsh-artcraft/craft-kit'
import type { CraftPluginConfig } from '@dsh-artcraft/craft-kit'
import { PLUGIN_ROOT } from './root.ts'

export const name = 'dsh-artcraft-wordcraft'
export const inject = ['tools', 'systemPrompt']

/** The craft this plugin exposes. */
export const craft = profileOf('wordcraft')

/** Configuration is the shared craft config. */
export type Config = CraftPluginConfig

export function apply(ctx: Context, config: Config = {}): void {
  if (craft === undefined) throw new Error('dsh-artcraft-wordcraft: profile "wordcraft" is missing from craft-kit')
  ctx.effect(() => applyCraftPlugin(ctx, { profile: craft, packageRoot: PLUGIN_ROOT, config }))
}
