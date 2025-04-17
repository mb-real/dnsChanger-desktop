import sudo from 'sudo-prompt'
import { ServerType } from '../../shared/interfaces/server.interface'

export abstract class Platform {
	public abstract setDns(nameServers: string[]): Promise<void>

	public abstract setDohDns(dohUrl: string): Promise<void>

	public abstract getActiveDns(): Promise<{
		servers: string[]
		type: ServerType
		dohUrl?: string
	}>

	public abstract clearDns(): Promise<void>

	public abstract getInterfacesList(): Promise<any>

	public abstract flushDns(): Promise<void>

	protected execCmd(cmd: string): Promise<string | Buffer> {
		return new Promise((resolve, reject) => {
			sudo.exec(cmd, { name: 'dnsChanger' }, (error, stdout) => {
				if (error) {
					reject(error)
					return
				}
				resolve(stdout)
			})
		})
	}
}
