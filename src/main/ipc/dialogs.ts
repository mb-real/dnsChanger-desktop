import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import _ from 'lodash'
import pingLib from 'ping'
import { v4 as uuid } from 'uuid'

import LN from '../../i18n/i18n-node'
import { Locales } from '../../i18n/i18n-types'
import { EventsKeys } from '../../shared/constants/eventsKeys.constant'
import {
	Server,
	ServerStore,
	ServerType,
} from '../../shared/interfaces/server.interface'
import { isValidDnsAddress } from '../../shared/validators/dns.validator'
import { dnsService } from '../config'
import { WindowsPlatform } from '../platforms/windows/windows.platform'
import { getOverlayIcon } from '../shared/file'
import { LogId, getLoggerPathFile, userLogger } from '../shared/logger'
import { updateOverlayIcon } from '../shared/overlayIcon'
import { isWindows } from '../shared/platform'
import { store } from '../store/store'

ipcMain.handle(EventsKeys.SET_DNS, async (event, server: Server) => {
	try {
		if (isWindows()) {
			const winPlatform = new WindowsPlatform()
			const isAvailableWmic = await winPlatform.isWmicAvailable()
			if (!isAvailableWmic) {
				return {
					server,
					success: false,
					message: 'wmic_not_available',
				}
			}
		}

		if (server.type === 'doh' && server.dohUrl) {
			await dnsService.setDohDns(server.dohUrl)
		} else {
			await dnsService.setDns(server.servers)
		}

		const currentLng = LN[getCurrentLng()]
		const win = BrowserWindow.getAllWindows()[0]
		const filepath = await getOverlayIcon(server)
		updateOverlayIcon(win, filepath, 'connected')

		return {
			server,
			success: true,
			message: currentLng.pages.home.connected({
				currentActive: server.name,
			}),
		}
	} catch (e) {
		userLogger.error(e.stack, e.message)
		return {
			server,
			success: false,
			message: 'Unknown error while connecting',
		}
	}
})

ipcMain.handle(EventsKeys.SET_DOH_DNS, async (event, server: Server) => {
	try {
		if (isWindows()) {
			const winPlatform = new WindowsPlatform()
			const isAvailableWmic = await winPlatform.isWmicAvailable()
			if (!isAvailableWmic) {
				return {
					server,
					success: false,
					message: 'wmic_not_available',
				}
			}
		}

		if (!server.dohUrl) {
			return {
				server,
				success: false,
				message: 'DoH URL is required',
			}
		}

		await dnsService.setDohDns(server.dohUrl)
		const currentLng = LN[getCurrentLng()]
		const win = BrowserWindow.getAllWindows()[0]
		const filepath = await getOverlayIcon(server)
		updateOverlayIcon(win, filepath, 'connected')

		return {
			server,
			success: true,
			message: currentLng.pages.home.connected({
				currentActive: server.name,
			}),
		}
	} catch (e) {
		userLogger.error(e.stack, e.message)
		return {
			server,
			success: false,
			message: e.message || 'Unknown error while connecting to DoH server',
		}
	}
})

ipcMain.handle(EventsKeys.CLEAR_DNS, async (event, server: Server) => {
	try {
		if (isWindows()) {
			const winPlatform = new WindowsPlatform()
			const isAvailableWmic = await winPlatform.isWmicAvailable()
			if (!isAvailableWmic) {
				return {
					server,
					success: false,
					message: 'wmic_not_available',
				}
			}
		}

		await dnsService.clearDns()

		const currentLng = LN[getCurrentLng()]
		const win = BrowserWindow.getAllWindows()[0]

		updateOverlayIcon(win, null, 'disconnect')
		const defaultServer = store.get('defaultServer')

		if (defaultServer) {
			const servers = defaultServer.servers
			dnsService.setDns(servers).catch((err) => {
				userLogger.error(err.stack, err.message)
			})
		}

		return {
			server,
			success: true,
			message: currentLng.pages.home.disconnected(),
		}
	} catch (e) {
		userLogger.error(e.stack, e.message)
		return { server, success: false, message: 'Unknown error while clear DNS' }
	}
})

ipcMain.handle(EventsKeys.ADD_DNS, async (event, data: Partial<Server>) => {
	if (data.name === 'default') {
		const defaultServer = store.get('defaultServer')
		const server: Server = {
			key: 'default',
			servers: data.servers,
			name: 'default',
			tags: [],
			avatar: '',
			rate: 0,
			type: data.type || 'dns',
		}

		if (!defaultServer) {
			store.set('defaultServer', server)
		} else {
			defaultServer.servers = data.servers
			defaultServer.type = data.type || 'dns'
			if (data.type === 'doh') {
				defaultServer.dohUrl = data.dohUrl
			}
			store.set('defaultServer', defaultServer)
		}

		return { success: true, server: server }
	}

	// Handle DoH server
	if (data.type === 'doh') {
		if (!data.dohUrl) {
			return { success: false, message: 'DoH URL is required' }
		}

		const list: Server[] = store.get('dnsList') || []

		const newServer: ServerStore = {
			key: data.key || uuid(),
			name: data.name,
			avatar: data.avatar || 'def.png',
			servers: data.servers || [],
			rate: data.rate || 0,
			tags: data.tags || ['DoH'],
			isPin: false,
			type: 'doh',
			dohUrl: data.dohUrl,
		}

		const isDupKey = list.find((s) => s.key === newServer.key)
		if (isDupKey) newServer.key = uuid()

		list.push(newServer)

		store.set('dnsList', list)
		return { success: true, server: newServer, servers: list }
	}

	// Regular DNS server handling
	const nameServer1 = data.servers[0]
	const nameServer2 = data.servers[1]
	if (!nameServer1) return { success: false, message: 'DNS1 is required' }

	const currentLng = LN[getCurrentLng()]

	if (!isValidDnsAddress(nameServer1))
		return { success: false, message: currentLng.validator.invalid_dns1 }

	if (nameServer2 && !isValidDnsAddress(nameServer2))
		return { success: false, message: currentLng.validator.invalid_dns2 }

	if (nameServer1.toString() === nameServer2.toString())
		return {
			success: false,
			message: currentLng.validator.dns1_dns2_duplicates,
		}

	const list: Server[] = store.get('dnsList') || []

	const newServer: ServerStore = {
		key: data.key || uuid(),
		name: data.name,
		avatar: data.avatar || 'def.png',
		servers: data.servers,
		rate: data.rate || 0,
		tags: data.tags || [],
		isPin: false,
		type: 'dns',
	}

	const isDupKey = list.find((s) => s.key === newServer.key)
	if (isDupKey) newServer.key = uuid()

	list.push(newServer)

	store.set('dnsList', list)
	return { success: true, server: newServer, servers: list }
})

ipcMain.handle(EventsKeys.DELETE_DNS, (ev, server: Server) => {
	const dnsList = store.get('dnsList')

	_.remove(dnsList, (dns) => dns.key === server.key)

	store.set('dnsList', dnsList)

	return {
		success: true,
		servers: dnsList,
	}
})

ipcMain.handle(
	EventsKeys.RELOAD_SERVER_LIST,
	async (event, servers: Server[]) => {
		store.set('dnsList', servers)
		return { success: true }
	},
)

ipcMain.handle(EventsKeys.FETCH_DNS_LIST, () => {
	const servers = store.get('dnsList') || []
	return { success: true, servers: servers }
})

ipcMain.on(EventsKeys.GET_CURRENT_ACTIVE, getCurrentActive)

ipcMain.handle(EventsKeys.GET_CURRENT_ACTIVE, getCurrentActive)

ipcMain.on(EventsKeys.OPEN_BROWSER, (ev, url) => {
	shell.openExternal(url)
})

ipcMain.on(EventsKeys.OPEN_DEV_TOOLS, () => {
	try {
		const win = BrowserWindow.getAllWindows()[0]
		win.webContents.openDevTools()
	} catch (e) {}
})

// open log file
ipcMain.on(EventsKeys.OPEN_LOG_FILE, () => {
	const logPathFile = getLoggerPathFile(LogId.USER)
	shell.openPath(logPathFile).catch((e) => {
		userLogger.error(e.stack, e.message)
	})
})

ipcMain.on(EventsKeys.DIALOG_ERROR, (ev, title: string, message: string) => {
	dialog.showErrorBox(title, message)
})

ipcMain.handle(EventsKeys.FLUSHDNS, async () => {
	try {
		await dnsService.flushDns()
		return { success: true }
	} catch (error) {
		userLogger.error(error.stack, error.message)
		return { success: false }
	}
})

ipcMain.handle(EventsKeys.PING, async (event, server: Server) => {
	try {
		let host: string

		if (server.type === 'doh' && server.dohUrl) {
			try {
				const url = new URL(server.dohUrl)
				host = url.hostname
			} catch (error) {
				host = server.servers[0] || 'dns.google.com'
			}
		} else {
			host = server.servers[0]
		}

		if (!host) {
			return {
				success: false,
				data: {
					alive: false,
					time: 0,
				},
			}
		}

		const result = await pingLib.promise.probe(host, {
			timeout: 10,
		})

		return {
			success: true,
			data: {
				alive: result.alive,
				time: result.time,
				host: host,
			},
		}
	} catch (error) {
		userLogger.error(error?.stack, error?.message || 'Unknown ping error')
		return {
			success: false,
			data: {
				alive: false,
				time: 0,
			},
		}
	}
})

ipcMain.handle(EventsKeys.TOGGLE_PIN, async (event, server: Server) => {
	const dnsList: ServerStore[] = store.get('dnsList')

	const serverStore = dnsList.find((ser) => ser.key === server.key)
	if (serverStore) {
		serverStore.isPin = !serverStore.isPin
		store.set('dnsList', dnsList)

		return {
			success: true,
			servers: dnsList,
		}
	}
})

ipcMain.handle(EventsKeys.GET_NETWORK_INTERFACE_LIST, async () => {
	if (isWindows()) {
		const winPlatform = new WindowsPlatform()
		const isAvailableWmic = await winPlatform.isWmicAvailable()
		if (!isAvailableWmic) {
			return {
				success: false,
				message: 'wmic_not_available',
			}
		}
	}

	return dnsService.getInterfacesList()
})

function getCurrentLng(): Locales {
	return store.get('settings').lng
}

async function getCurrentActive(): Promise<{
	success: boolean
	server?: Partial<ServerStore>
	isDefault?: boolean
	message?: string
}> {
	try {
		const dnsInfo = await dnsService.getActiveDns()
		const dns = dnsInfo.servers
		const dnsType = dnsInfo.type
		const dohUrl = dnsInfo.dohUrl

		if (!dns.length && dnsType !== 'doh')
			return { success: false, server: null }

		const servers = store.get('dnsList') || []
		let server: ServerStore | null = null

		if (dnsType === 'doh' && dohUrl) {
			// For DoH servers, match by URL
			server =
				servers.find((s) => s.type === 'doh' && s.dohUrl === dohUrl) || null
		} else {
			// For regular DNS servers, match by IP addresses
			server =
				servers.find((s) => s.servers.toString() === dns.toString()) || null
		}

		const defaultServer = store.get('defaultServer')
		if (defaultServer) {
			// if default server is connected, then return it as not connected
			if (
				(dnsType === 'doh' &&
					defaultServer.type === 'doh' &&
					defaultServer.dohUrl === dohUrl) ||
				(dnsType === 'dns' &&
					defaultServer.servers.toString() === dns.toString())
			) {
				return {
					success: false,
					server: null,
					isDefault: true,
				}
			}
		}

		if (!server) {
			// Create an unknown server entry
			const unknownServer: Partial<ServerStore> = {
				key: 'unknown',
				servers: dns,
				avatar: '',
				isPin: false,
			}

			if (dnsType === 'doh' && dohUrl) {
				unknownServer.type = 'doh'
				unknownServer.dohUrl = dohUrl
				unknownServer.name = `Unknown DoH (${new URL(dohUrl).hostname})`
			} else {
				unknownServer.type = 'dns'
				unknownServer.name = 'unknown'
			}

			return {
				success: true,
				server: unknownServer,
			}
		}

		const win = BrowserWindow.getAllWindows()[0]
		const filepath = await getOverlayIcon(server)
		updateOverlayIcon(win, filepath, 'connected')

		return { success: true, server }
	} catch (e) {
		userLogger.error(e.stack, e.message)
		return { success: false, message: 'Unknown error while getting active DNS' }
	}
}
