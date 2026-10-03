import type { HttpService } from '@nestjs/axios'
import type { AxiosRequestConfig } from 'axios'

import type { Logger } from '../../core/logger/logger.service.js'

import { firstValueFrom } from 'rxjs'

/** A GitHub release, as far as the release notes use it */
export interface GitHubRelease {
  tag_name?: string
  body?: string
}

/**
 * Release notes and changelogs from GitHub. Every lookup is best effort: a
 * failed request (a missing tag, branch or file, rate limiting, no network)
 * is logged at debug level and reads as "not found".
 */
export class GitHubReleaseClient {
  constructor(
    private readonly httpService: HttpService,
    private readonly logger: Logger,
  ) {}

  /**
   * The release with exactly this tag
   */
  async releaseByTag(owner: string, repo: string, tag: string): Promise<GitHubRelease | null> {
    return this.get<GitHubRelease>(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, `the ${owner}/${repo} release ${tag}`)
  }

  /**
   * The release for a version, tagged either `v1.2.3` or `1.2.3`
   */
  async releaseByVersion(owner: string, repo: string, version: string): Promise<GitHubRelease | null> {
    for (const tag of [`v${version}`, version]) {
      const release = await this.releaseByTag(owner, repo, tag)
      if (release) {
        return release
      }
    }
    return null
  }

  /**
   * The last listed branch whose name contains `keyword` (e.g. "beta"), where
   * a prerelease's changelog usually lives
   */
  async prereleaseBranch(owner: string, repo: string, keyword: string): Promise<string | null> {
    const branches = await this.get<{ name: string }[]>(`https://api.github.com/repos/${owner}/${repo}/branches`, `the ${owner}/${repo} branches`, {
      params: { per_page: 100 },
    })
    try {
      const matched = branches?.filter(b => b.name.includes(keyword)) ?? []
      return matched.length > 0 ? matched.at(-1).name : null
    } catch (e) {
      this.logger.debug(`GitHub: unexpected branch list for ${owner}/${repo} (${e.message}).`)
      return null
    }
  }

  /**
   * The changelog at a git ref: the first of `filenames` (under `path`) that
   * can be fetched, or null
   */
  async changelog(owner: string, repo: string, ref: string, options: { path?: string, filenames?: string[] } = {}): Promise<string | null> {
    const { path = '', filenames = ['CHANGELOG.md'] } = options
    for (const filename of filenames) {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}${filename}`
      const changelog = await this.request<string>(url, `${path}${filename} at ${owner}/${repo} ${ref}`)
      if (changelog.ok) {
        return changelog.data
      }
    }
    return null
  }

  /**
   * The first non-empty changelog among `refs`, tried in order
   */
  async firstChangelog(owner: string, repo: string, refs: string[], options: { path?: string, filenames?: string[] } = {}): Promise<string | null> {
    for (const ref of refs) {
      const changelog = await this.changelog(owner, repo, ref, options)
      if (changelog) {
        return changelog
      }
    }
    return null
  }

  private async get<T>(url: string, what: string, config?: AxiosRequestConfig): Promise<T | null> {
    const response = await this.request<T>(url, what, config)
    return response.ok ? response.data : null
  }

  private async request<T>(url: string, what: string, config?: AxiosRequestConfig): Promise<{ ok: true, data: T } | { ok: false }> {
    try {
      const response = await firstValueFrom(config ? this.httpService.get<T>(url, config) : this.httpService.get<T>(url))
      return { ok: true, data: response.data }
    } catch (e) {
      this.logger.debug(`GitHub: could not fetch ${what} (${e?.message ?? e}).`)
      return { ok: false }
    }
  }
}
