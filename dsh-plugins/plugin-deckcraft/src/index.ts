/**
 * DeckCraft as a DSH plugin.
 *
 * Registers model-callable tools that drive the `deckcraft-cli` binary this machine
 * already has — both its generic `--cmd` surface and its own MCP server. The
 * DeckCraft source tree is never touched: the CLI is an external process, located
 * at call time so installing it mid-session works.
 *
 * The kernel under `./kit/` is generated from `dsh-plugins/craft-kit/src` by
 * `scripts/build-kit.mjs` and inlined so this package installs standalone.
 * @module dsh-artcraft-plugin-deckcraft
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { applyCraftPlugin, profileOf } from './kit/index.js'
import type { CraftPluginConfig } from './kit/index.js'
import { PLUGIN_ROOT } from './root.ts'
import { readFileSync } from 'node:fs'

export const name = 'dsh-artcraft-deckcraft'
export const inject = ['tools', 'systemPrompt']

/** The craft this plugin exposes. */
export const craft = profileOf('deckcraft')

/** Configuration is the shared craft config. */
export type Config = CraftPluginConfig

/**
 * Commit a rendered preview so the transcript shows the document after the call.
 * The attachment service is optional: without it the path stays in the text.
 */
const attachImage = async (ctx: Context, path: string): Promise<unknown> => {
  const attachments = ctx.get('attachments') as
    | { saveImage?: (input: { data: Buffer; mediaType: string; name?: string }) => Promise<unknown> }
    | undefined
  if (attachments?.saveImage === undefined) return undefined
  try {
    const ref = await attachments.saveImage({
      data: readFileSync(path),
      mediaType: 'image/png',
      name: path.split(/[\\/]/).pop(),
    })
    return { type: 'image', attachment: ref }
  } catch {
    return undefined
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  if (craft === undefined) throw new Error('dsh-artcraft-deckcraft: profile "deckcraft" is missing from the inlined kernel')
  // `ctx.effect` ties the registration and the MCP server to this plugin's fiber.
  ctx.effect(() => applyCraftPlugin(ctx, {
    profile: craft,
    packageRoot: PLUGIN_ROOT,
    config,
    defineTool: defineTool as never,
    attachImage: (path: string) => attachImage(ctx, path),
  }))
}
