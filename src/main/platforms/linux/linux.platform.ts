import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'
import { userLogger } from 'src/main/shared/logger'
import { ServerType } from '../../../shared/interfaces/server.interface'
import { Platform } from '../platform'

export class LinuxPlatform extends Platform {
	private dohConfigPath: string
	private isDoHActive = false
	private currentDohUrl?: string
	private dohConfigFilePath: string

	constructor() {
		super()
		this.dohConfigPath = path.join(
			app.getPath('userData'),
			'linux_doh_config.json',
		)
		this.dohConfigFilePath = '/etc/systemd/resolved.conf.d/dnsChanger-doh.conf'
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
			console.error('Failed to load DoH config:', error)
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
			// Clear DoH configuration
			this.isDoHActive = false
			this.currentDohUrl = undefined
			this.saveDohConfig()

			try {
				await this.execCmd(`rm -f ${this.dohConfigFilePath}`)
			} catch {}

			try {
				await this.execCmd('systemctl restart systemd-resolved')
			} catch {}

			await this.setDns(['1.1.1.1', '8.8.8.8', '192.168.1.1', '127.0.0.1'])
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
			const cmd = "grep nameserver /etc/resolv.conf | awk '{print $2}'"
			const text = (await this.execCmd(cmd)) as string

			const regex = /(?<=nameserver\s)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g
			const servers = text.trim().match(regex) || []

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

	async setDns(nameServers: Array<string>): Promise<void> {
		try {
			this.isDoHActive = false
			this.currentDohUrl = undefined
			this.saveDohConfig()

			try {
				await this.execCmd(`rm -f ${this.dohConfigFilePath}`)
				await this.execCmd('systemctl restart systemd-resolved')
			} catch {}

			let lines = ''

			for (let i = 0; i < nameServers.length; i++) {
				lines += `nameserver ${nameServers[i]}\n`
			}

			const cmd = `echo '${lines.trim()}' > /etc/resolv.conf`
			await this.execCmd(cmd)

			const cmdRestart = 'systemctl restart systemd-networkd'
			await this.execCmd(cmdRestart)
		} catch (e) {
			throw e
		}
	}

	async setDohDns(dohUrl: string): Promise<void> {
		try {
			try {
				await this.execCmd('systemctl status systemd-resolved')
			} catch {
				throw new Error('systemd-resolved is not available on this system')
			}

			const dohDomain = this.extractDohDomain(dohUrl)
			if (!dohDomain) {
				throw new Error('Invalid DoH URL format')
			}

			await this.execCmd('mkdir -p /etc/systemd/resolved.conf.d/')

			const dohConfigContent = `[Resolve]\nDNS=${dohDomain}\nDNSOverTLS=yes\n`
			await this.execCmd(
				`echo '${dohConfigContent}' > ${this.dohConfigFilePath}`,
			)

			await this.execCmd('systemctl restart systemd-resolved')

			// Save DoH configuration state
			this.isDoHActive = true
			this.currentDohUrl = dohUrl
			this.saveDohConfig()

			userLogger.log('DoH server configured using systemd-resolved')
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

	public async flushDns(): Promise<void> {
		try {
			await this.execCmd('systemd-resolve --flush-caches')
		} catch {
			try {
				await this.execCmd('resolvectl flush-caches')
			} catch {
				userLogger.log('Could not flush DNS caches')
			}
		}
	}
}
