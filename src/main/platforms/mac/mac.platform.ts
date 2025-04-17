import { exec } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { ServerType } from '../../../shared/interfaces/server.interface'
import { userLogger } from '../../shared/logger'
import { Platform } from '../platform'

const execPromise = promisify(exec)

export class MacPlatform extends Platform {
	private dohConfigPath: string
	private isDoHActive = false
	private currentDohUrl?: string

	constructor() {
		super()
		this.dohConfigPath = path.join(app.getPath('userData'), 'doh_config.json')
		this.loadDohConfig()
	}

	private loadDohConfig() {
		try {
			if (fs.existsSync(this.dohConfigPath)) {
				const config = JSON.parse(fs.readFileSync(this.dohConfigPath, 'utf8'))
				this.isDoHActive = config.isActive || false
				this.currentDohUrl = config.dohUrl
			}
		} catch (error) {
			userLogger.error('Failed to load DoH config:', error)
			this.isDoHActive = false
			this.currentDohUrl = undefined
		}
	}

	private saveDohConfig() {
		try {
			fs.writeFileSync(
				this.dohConfigPath,
				JSON.stringify({
					isActive: this.isDoHActive,
					dohUrl: this.currentDohUrl,
				}),
				'utf8',
			)
		} catch (error) {
			console.error('Failed to save DoH config:', error)
		}
	}

	async clearDns(): Promise<void> {
		try {
			this.isDoHActive = false
			this.currentDohUrl = undefined
			this.saveDohConfig()

			await this.setDns(['8.8.8.8', '8.8.4.4'])
		} catch (e) {
			throw e
		}
	}

	async getActiveDns(): Promise<{
		servers: string[]
		type: ServerType
		dohUrl?: string
	}> {
		try {
			const { stdout } = await execPromise(
				"scutil --dns | awk '/nameserver/ { print $3 }'",
			)

			const servers = stdout.trim().split('\n')

			// Check if DoH is active
			if (this.isDoHActive && this.currentDohUrl) {
				return {
					servers,
					type: 'doh',
					dohUrl: this.currentDohUrl,
				}
			}

			return {
				servers,
				type: 'dns',
			}
		} catch (e) {
			throw e
		}
	}

	async getInterfacesList(): Promise<any> {
		return []
	}

	async setDns(nameServers: string[]): Promise<void> {
		try {
			this.isDoHActive = false
			this.currentDohUrl = undefined
			this.saveDohConfig()

			const dnsServers = nameServers.join(' ')

			await execPromise(`networksetup -setdnsservers Wi-Fi ${dnsServers}`)

			try {
				await execPromise(`networksetup -setdnsservers Ethernet ${dnsServers}`)
			} catch (e) {}
		} catch (e) {
			throw e
		}
	}

	async setDohDns(dohUrl: string): Promise<void> {
		try {
			const dohDomain = this.extractDohDomain(dohUrl)
			if (!dohDomain) {
				throw new Error('Invalid DoH URL format')
			}

			const dohIp = await this.resolveDohServerIp(dohDomain)
			if (!dohIp) {
				throw new Error('Could not resolve DoH server IP')
			}

			const dnsServers = [dohIp]
			await this.setDns(dnsServers)

			this.isDoHActive = true
			this.currentDohUrl = dohUrl
			this.saveDohConfig()

			// Note: On macOS, full DoH support requires a Network Extension
			// This implementation saves the DoH configuration but users may need
			// to install additional software for complete DoH functionality

			userLogger.log(
				'DoH server configured. Note: Full DoH functionality may require additional system configuration.',
			)
		} catch (e) {
			throw e
		}
	}

	private extractDohDomain(dohUrl: string): string | null {
		try {
			const url = new URL(dohUrl)
			return url.hostname
		} catch {
			return null
		}
	}

	private async resolveDohServerIp(domain: string): Promise<string | null> {
		try {
			const { stdout } = await execPromise(`dig +short ${domain} | head -n 1`)
			return stdout.trim() || null
		} catch {
			return null
		}
	}

	public async flushDns(): Promise<void> {
		try {
			await execPromise('sudo killall -HUP mDNSResponder')
		} catch (e) {
			throw e
		}
	}
}
