import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'

import { AuthModule } from '../../core/auth/auth.module.js'
import { ConfigModule } from '../../core/config/config.module.js'
import { LoggerModule } from '../../core/logger/logger.module.js'
import { ConfigEditorModule } from '../config-editor/config-editor.module.js'
import { PluginsModule } from '../plugins/plugins.module.js'
import { createProvider, HomebridgeClient, runAgent } from './ai-kit.js'
import { AI_AGENT_RUNNER, AI_HOMEBRIDGE_CLIENT_FACTORY, AI_PROVIDER_FACTORY } from './ai.constants.js'
import { AiController } from './ai.controller.js'
import { AiGateway } from './ai.gateway.js'
import { AiService } from './ai.service.js'

/**
 * The Assistant: Log Doctor, Config Copilot, chat, update risk, organiser and
 * daily digest, on top of `@mp-consulting/homebridge-ai-kit`. Settings live in
 * the kit's `HomebridgeAiKit` platform block of config.json.
 */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    ConfigModule,
    LoggerModule,
    AuthModule,
    PluginsModule,
    ConfigEditorModule,
  ],
  providers: [
    { provide: AI_PROVIDER_FACTORY, useValue: createProvider },
    { provide: AI_AGENT_RUNNER, useValue: runAgent },
    { provide: AI_HOMEBRIDGE_CLIENT_FACTORY, useValue: (options: { url: string, getToken: () => Promise<string> }) => new HomebridgeClient(options) },
    AiService,
    AiGateway,
  ],
  controllers: [
    AiController,
  ],
})
export class AiModule {}
