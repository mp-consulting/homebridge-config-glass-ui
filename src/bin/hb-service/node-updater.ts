import type { TarOptionsWithAliases } from 'tar'

import type { BasePlatform } from '../base-platform.js'
import type { Logger } from '../logger.js'

import { createWriteStream } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import axios from 'axios'
import { pathExists, remove } from 'fs-extra/esm'
import ora from 'ora'
import { extract } from 'tar'

import { MIN_NODE_VERSION } from '../../core/node-version.constants.js'
import { fetchNodeReleases, pickNodeInstall } from '../../core/node-version/node-release.js'

/**
 * `hb-service update-node [version]`: install the requested Node.js version,
 * or the update pickNodeInstall() chooses, through the platform installer.
 */
export async function checkForNodejsUpdates(
  requestedVersion: string | null,
  { installer, logger }: { installer: BasePlatform, logger: Logger },
) {
  const releases = await fetchNodeReleases()

  // Check response is valid array
  if (!releases) {
    logger.error('Failed to check for Node.js updates.')
    return { update: false }
  }

  const plan = pickNodeInstall(releases, {
    current: process.version,
    currentModules: process.versions.modules,
    requested: requestedVersion,
  })

  switch (plan.action) {
    case 'too-old':
      logger.error(`Refusing to install Node.js version lower than v${MIN_NODE_VERSION}.`)
      return { update: false }
    case 'unknown-version':
      logger.log(`v${requestedVersion} is not a valid Node.js version.`)
      return { update: false }
    case 'up-to-date':
      logger.log(`Node.js ${process.version} already up-to-date.`)
      return { update: false }
    case 'install':
      logger.log(plan.reason === 'requested'
        ? `Installing Node.js ${plan.target} over ${process.version}...`
        : `Updating Node.js from ${process.version} to ${plan.target}...`)
      return installer.updateNodejs({ target: plan.target, rebuild: plan.rebuild })
  }
}

/**
 * Download the Node.js binary to a temp file
 */
export async function downloadNodejs(downloadUrl: string): Promise<string> {
  const spinner = ora(`Downloading ${downloadUrl}`).start()

  try {
    const tempDir = await mkdtemp(join(tmpdir(), 'node'))
    const tempFilePath = join(tempDir, 'node.tar.gz')
    const tempFile = createWriteStream(tempFilePath)

    await axios.get(downloadUrl, { responseType: 'stream' })
      .then((response) => {
        return new Promise((res, rej) => {
          response.data.pipe(tempFile).on('finish', () => {
            return res(tempFile)
          }).on('error', (err: Error) => {
            return rej(err)
          })
        })
      })

    spinner.succeed('Download complete.')
    return tempFilePath
  } catch (e) {
    spinner.fail(e.message)
    process.exit(1)
  }
}

/**
 * Extract the Node.js tarball
 */
export async function extractNodejs(targetVersion: string, extractConfig: TarOptionsWithAliases) {
  const spinner = ora(`Installing Node.js ${targetVersion}`).start()

  try {
    await extract(extractConfig)
    spinner.succeed(`Installed Node.js ${targetVersion}`)
  } catch (e) {
    spinner.fail(e.message)
    process.exit(1)
  }
}

/**
 * Remove npm package
 */
export async function removeNpmPackage(npmInstallPath: string) {
  if (!await pathExists(npmInstallPath)) {
    return
  }

  const spinner = ora(`Cleaning up npm at ${npmInstallPath}...`).start()

  try {
    await remove(npmInstallPath)
    spinner.succeed(`Cleaned up npm at ${npmInstallPath}`)
  } catch (e) {
    spinner.fail(e.message)
  }
}
