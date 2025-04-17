import network from 'network'
import sudo from 'sudo-prompt'

import { userLogger } from 'src/main/shared/logger'
import { ServerType } from '../../../shared/interfaces/server.interface'
import { store } from '../../store/store'
import { Platform } from '../platform'
import { Interface } from './interfaces/interface'

export class WindowsPlatform extends Platform {
	async clearDns(): Promise<void> {
		try {
			let networkInterface = store.get('settings').network_interface
			if (networkInterface === 'Auto')
				networkInterface = (await this.getValidateInterface()).name

			await this.execCmd('netsh dns show encryption')
				.then(async () => {
					await this.execCmd('netsh dns set encryption mode=none')
				})
				.catch(() => {
					userLogger.error('DoH commands not supported on this Windows version')
				})

			return new Promise((resolve, reject) => {
				sudo.exec(
					`netsh interface ip set dns "${networkInterface}" dhcp`,
					{
						name: 'DnsChanger',
					},
					(error) => {
						if (error) {
							reject(error)
							return
						}
						resolve()
					},
				)
			})
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
			let networkInterface = store.get('settings').network_interface
			if (networkInterface === 'Auto')
				networkInterface = (await this.getValidateInterface()).name

			// Get the DNS servers from the network interface
			const cmd = `netsh interface ip show dns "${networkInterface}"`
			const text = (await this.execCmd(cmd)) as string
			const servers = this.extractDns(text)

			// Check if DoH is active
			try {
				// First get the current active DNS servers to match with DoH settings
				const activeDnsServers = servers.length ? servers : []
				if (!activeDnsServers.length) {
					// If we couldn't get servers from the interface command, try using ipconfig
					const ipconfigText = (await this.execCmd('ipconfig /all')) as string
					const dnsMatches = ipconfigText.match(
						/DNS Servers[^\n]+:\s*((?:\d{1,3}\.){3}\d{1,3})/gi,
					)
					if (dnsMatches) {
						for (const match of dnsMatches) {
							const ipMatch = match.match(
								/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/,
							)
							if (ipMatch) activeDnsServers.push(ipMatch[1])
						}
					}
				}

				// Now get the full DoH configuration
				const dohText = (await this.execCmd(
					'netsh dns show encryption',
				)) as string

				// Check if we have any active DNS servers that match entries in the DoH configuration
				if (activeDnsServers.length > 0) {
					for (const server of activeDnsServers) {
						// Look for this server in the DoH output
						const serverPattern = new RegExp(
							`Encryption settings for ${server}[\\s\\S]*?DNS-over-HTTPS template\\s*:\\s*([^\\s\\n]+)`,
							'i',
						)
						const match = serverPattern.exec(dohText)
						if (match?.[1]) {
							// We found a DoH setting for one of our active DNS servers
							return {
								servers: activeDnsServers,
								type: 'doh',
								dohUrl: match[1].trim(),
							}
						}
					}
				}

				// Check if global DoH mode is enabled
				// First look for Mode: auto or Mode: always
				const modeMatch = /Mode\s*:\s*(auto|always)/i.exec(dohText)
				if (modeMatch) {
					// DoH is enabled globally, find a template URL
					const templateMatch =
						/DNS-over-HTTPS template\s*:\s*([^\s\n]+)/i.exec(dohText)
					if (templateMatch?.[1]) {
						return {
							servers: servers,
							type: 'doh',
							dohUrl: templateMatch[1].trim(),
						}
					}
				}
			} catch (error) {
				userLogger.error('DoH check failed:', error)
			}

			// If we reach here, it's regular DNS
			return {
				servers,
				type: 'dns',
			}
		} catch (e) {
			throw e
		}
	}

	getInterfacesList(): Promise<Interface[]> {
		return new Promise((resolve, reject) => {
			network.get_interfaces_list((err: unknown, obj: unknown) => {
				if (err) reject(err)
				else resolve(obj as Interface[])
			})
		})
	}

	async setDns(nameServers: Array<string>): Promise<void> {
		try {
			let networkInterface = store.get('settings').network_interface
			if (networkInterface === 'Auto')
				networkInterface = (await this.getValidateInterface()).name
			const cmdServer1 = `netsh interface ip set dns "${networkInterface}" static ${nameServers[0]}`

			await this.execCmd(cmdServer1)

			if (nameServers[1]) {
				const cmdServer2 = `netsh interface ip add dns "${networkInterface}" ${nameServers[1]} index=2`
				await this.execCmd(cmdServer2)
			}

			try {
				await this.execCmd('netsh dns set encryption mode=none')
			} catch {}
		} catch (e) {
			throw e
		}
	}

	async setDohDns(dohUrl: string): Promise<void> {
		try {
			try {
				await this.execCmd('netsh dns show encryption')
			} catch (error) {
				throw new Error(
					'DoH is not supported on this Windows version. You need Windows 11 or Windows 10 with the latest updates.',
				)
			}

			const dohDomain = this.extractDohDomain(dohUrl)
			if (!dohDomain) {
				throw new Error('Invalid DoH URL format')
			}

			const dohIp = await this.resolveDohServerIp(dohDomain)
			if (!dohIp) {
				throw new Error(
					'Could not resolve DoH server IP address. Please check your internet connection and try again.',
				)
			}

			let networkInterface = store.get('settings').network_interface
			if (networkInterface === 'Auto') {
				networkInterface = (await this.getValidateInterface()).name
			}

			const encryptionStatus = (await this.execCmd(
				'netsh dns show encryption',
			)) as string
			const serverRegex = new RegExp(
				`Encryption settings for ${dohIp}[\\s\\S]*?DNS-over-HTTPS template\\s*:\\s*([^\\s\\n]+)`,
				'i',
			)
			const existingTemplate = serverRegex.exec(encryptionStatus)

			if (!existingTemplate || existingTemplate[1] !== dohUrl) {
				try {
					if (existingTemplate) {
						await this.execCmd(`netsh dns delete encryption server=${dohIp}`)
					}
					await this.execCmd(
						`netsh dns add encryption server=${dohIp} dohtemplate=${dohUrl}`,
					)
				} catch (error) {
					userLogger.error('Error configuring DoH template:', error)
				}
			}

			await this.execCmd(
				`netsh interface ip set dns "${networkInterface}" static ${dohIp} primary`,
			)

			await this.flushDns()

			const verifyStatus = (await this.execCmd(
				'netsh dns show encryption',
			)) as string
			const verifyRegex = new RegExp(
				`Encryption settings for ${dohIp}[\\s\\S]*?DNS-over-HTTPS template\\s*:\\s*${dohUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
				'i',
			)
			if (!verifyRegex.test(verifyStatus)) {
				throw new Error(
					'Failed to properly configure DoH. Please try again with a different provider.',
				)
			}
		} catch (error) {
			try {
				let networkInterface = store.get('settings').network_interface
				if (networkInterface === 'Auto') {
					networkInterface = (await this.getValidateInterface()).name
				}
				await this.execCmd(
					`netsh interface ip set dns "${networkInterface}" dhcp`,
				)
			} catch {}
			throw error
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
			const cmd = `nslookup ${domain}`
			const result = (await this.execCmd(cmd)) as string

			const ipMatch = /Address:\s+(\d+\.\d+\.\d+\.\d+)/i.exec(result)
			return ipMatch ? ipMatch[1] : null
		} catch {
			return null
		}
	}

	async isWmicAvailable(): Promise<boolean> {
		return new Promise((resolve) => {
			sudo.exec(
				'wmic os get caption',
				{
					name: 'DnsChanger',
				},
				(error, stdout, stderr) => {
					if (error || stderr) {
						userLogger.error('WMIC is not installed or not recognized')
						userLogger.error('Error:', error?.message || stderr)
						resolve(false)
						return
					}

					resolve(true)
				},
			)
		})
	}

	private async getValidateInterface() {
		try {
			const interfaces: Interface[] = await this.getInterfacesList()
			const activeInterface: Interface | null = interfaces.find(
				(inter: Interface) => inter.gateway_ip != null,
			)

			if (!activeInterface) throw new Error('CONNECTION_FAILED')
			return activeInterface
		} catch (error) {
			throw error
		}
	}

	private extractDns(input: string): Array<string> {
		// First try specific format (Statically Configured)
		const staticRegex =
			/Statically Configured DNS Servers:\s+([\d.]+)(?:\s+([\d.]+))?/i
		const staticMatches = staticRegex.exec(input)

		if (staticMatches && staticMatches.length > 1) {
			const servers = []
			servers.push(staticMatches[1].trim())
			if (staticMatches[2]) {
				servers.push(staticMatches[2].trim())
			}
			return servers
		}

		// Try more generic extraction of any IP addresses following DNS
		const genericRegex =
			/DNS (Servers|Server[^:]*:|Address[^:]*:)[^\d]*((?:\d{1,3}\.){3}\d{1,3})(?:[^\d]*((?:\d{1,3}\.){3}\d{1,3}))?/gi
		const match = genericRegex.exec(input)

		if (match) {
			const servers = []
			if (match[2]) servers.push(match[2].trim())
			if (match[3]) servers.push(match[3].trim())
			return servers
		}

		return []
	}

	public async flushDns(): Promise<void> {
		return new Promise((resolve, reject) => {
			sudo.exec(
				'ipconfig /flushdns',
				{
					name: 'DnsChanger',
				},
				(error) => {
					if (error) {
						reject(error)
						return
					}
					resolve()
				},
			)
		})
	}
}
