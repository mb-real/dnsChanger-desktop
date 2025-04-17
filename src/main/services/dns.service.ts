import { ServerType } from '../../shared/interfaces/server.interface'
import { Platform } from '../platforms/platform'

export class DnsService {
	constructor(private platform: Platform) {}

	async setDns(nameServers: Array<string>) {
		return this.platform.setDns(nameServers)
	}

	async setDohDns(dohUrl: string) {
		return this.platform.setDohDns(dohUrl)
	}

	async getActiveDns() {
		return this.platform.getActiveDns()
	}

	async clearDns() {
		return this.platform.clearDns()
	}

	async getInterfacesList() {
		return this.platform.getInterfacesList()
	}

	async flushDns() {
		return this.platform.flushDns()
	}
}
