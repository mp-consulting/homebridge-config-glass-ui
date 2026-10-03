import process from 'node:process'

import { Command } from 'commander'

export type Action = 'install' | 'uninstall' | 'start' | 'stop' | 'restart' | 'rebuild' | 'run' | 'add' | 'remove' | 'logs' | 'view' | 'update-node' | 'update-homebridge' | 'before-start' | 'status'

/**
 * The hb-service settings the command line sets
 */
export interface CliTarget {
  action: Action
  storagePath: string
  usingCustomStoragePath: boolean
  serviceName: string
  uiPort: number
  asUser: string
  addGroup: string
  stdout: boolean
  allowRunRoot: boolean
  docker: boolean
  uid: number
  gid: number
  /** Extra flags for the Homebridge process, in command line order */
  homebridgeOpts: string[]
}

/**
 * Parse the hb-service command line into `target`. Returns the positional
 * arguments (`[action, ...rest]`) and the commander help printer. Unknown
 * options and extra arguments are allowed. `onVersion` handles `-v`.
 */
export function parseCommandLine(
  target: CliTarget,
  argv: string[],
  onVersion: () => void,
): { args: string[], outputHelp: () => void } {
  const program = new Command()
  program
    .allowUnknownOption()
    .allowExcessArguments()
    .storeOptionsAsProperties(true)
    .arguments('[install|uninstall|start|stop|restart|rebuild|run|logs|view|add|remove]')
    .option('-P, --plugin-path <path>', '', (p) => {
      process.env.UIX_CUSTOM_PLUGIN_PATH = p
      target.homebridgeOpts.push('-P', p)
    })
    .option('-U, --user-storage-path <path>', '', (p) => {
      target.storagePath = p
      target.usingCustomStoragePath = true
    })
    .option('-S, --service-name <service name>', 'The name of the homebridge service to install or control', p => target.serviceName = p)
    .option('-T, --no-timestamp', '', () => target.homebridgeOpts.push('-T'))
    .option('--strict-plugin-resolution', '', () => {
      process.env.UIX_STRICT_PLUGIN_RESOLUTION = '1'
    })
    .option('--port <port>', 'The port to set to the Homebridge Glass UI when installing as a service', p => target.uiPort = Number.parseInt(p, 10))
    .option('--user <user>', 'The user account the Homebridge service will be installed as (Linux, FreeBSD, macOS only)', p => target.asUser = p)
    .option('--group <group>', 'The group the Homebridge service will be added to (Linux, FreeBSD, macOS only)', p => target.addGroup = p)
    .option('--stdout', '', () => target.stdout = true)
    .option('--allow-root', '', () => target.allowRunRoot = true)
    .option('--docker', '', () => target.docker = true)
    .option('--uid <number>', '', i => target.uid = Number.parseInt(i, 10))
    .option('--gid <number>', '', i => target.gid = Number.parseInt(i, 10))
    .option('-v, --version', 'output the version number', onVersion)
    .action((cmd) => {
      target.action = cmd
    })
    .parse(argv)

  return { args: program.args, outputHelp: () => program.outputHelp() }
}

/**
 * Print the usage (shown for a missing or unknown command)
 */
export function printUsage(outputHelp: () => void, enablePluginManagement: boolean) {
  outputHelp()

  console.log('\nThe hb-service command is provided by @mp-consulting/homebridge-config-glass-ui\n')
  console.log('Please provide a command:')
  console.log('    install                          install homebridge as a service')
  console.log('    uninstall                        remove the homebridge service')
  console.log('    start                            start the homebridge service')
  console.log('    stop                             stop the homebridge service')
  console.log('    restart                          restart the homebridge service')
  if (enablePluginManagement) {
    console.log('    add <plugin>@<version>           install a plugin')
    console.log('    remove <plugin>@<version>        remove a plugin')
  }
  console.log('    rebuild                          rebuild ui')
  console.log('    rebuild --all                    rebuild all npm modules (use after updating Node.js)')
  console.log('    run                              run homebridge daemon')
  console.log('    logs                             tails the homebridge service logs')
  console.log('    view                             views the homebridge service logs for 30 seconds')
  console.log('    update-node [version]            update Node.js')
  console.log('    update-homebridge                update Homebridge apt package')
  console.log('\nSee the wiki for help with hb-service: https://homebridge.io/w/JTtHK \n')
}
